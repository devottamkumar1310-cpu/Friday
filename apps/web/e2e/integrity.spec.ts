import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { newLearner, onboard } from './support/learner';

/**
 * The three defects a security audit found, each pinned by the exact sequence
 * that produced it.
 *
 * All three were reachable by the learner against their own data, which is why
 * none of them showed up in the cross-tenant probes: authorisation was never the
 * problem. What was at stake is the integrity of the numbers the whole product
 * reasons from — a learner cannot be allowed to corrupt their own history any
 * more than someone else's, because the planner cannot tell the difference.
 */

test.describe.configure({ mode: 'serial' });
test.setTimeout(300_000);

let context: BrowserContext;
let page: Page;
let goalId: string;
let conceptId: string;

/** POST helper that returns status and body together. */
async function post(target: Page, path: string, body?: unknown) {
  return target.evaluate(
    async ([p, b]) => {
      const response = await fetch(p as string, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        ...(b === undefined ? {} : { body: JSON.stringify(b) }),
      });
      let parsed: unknown = null;
      try {
        parsed = await response.json();
      } catch {
        parsed = null;
      }
      return { status: response.status, body: parsed as Record<string, unknown> };
    },
    [path, body] as const,
  );
}

async function startSession(target: Page, goal: string): Promise<string> {
  const r = await post(target, '/api/v1/sessions', { goalId: goal, originatedFrom: 'manual' });
  return (r.body as { data: { id: string } }).data.id;
}

async function readSession(target: Page, id: string) {
  return target.evaluate(async (sessionId) => {
    const r = await fetch(`/api/v1/sessions/${sessionId}`, { credentials: 'include' });
    return (await r.json()) as { data: { status: string; activeMinutes: number } };
  }, id);
}

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await onboard(page, newLearner('integrity'));

  const ids = await page.evaluate(async () => {
    const goals = (await (await fetch('/api/v1/goals', { credentials: 'include' })).json()) as {
      data: { id: string }[];
    };
    const g = goals.data[0]!.id;
    const mastery = (await (
      await fetch(`/api/v1/memory/mastery?goalId=${g}`, { credentials: 'include' })
    ).json()) as { data: { conceptId: string }[] };
    return { goalId: g, conceptId: mastery.data[0]!.conceptId };
  });
  goalId = ids.goalId;
  conceptId = ids.conceptId;
});

test.afterAll(async () => {
  await context.close();
});

test.describe('a terminal session cannot be reopened', () => {
  test('complete then abandon is rejected, and the record is untouched', async () => {
    /**
     * The audit sequence, exactly. This returned 200 and rewrote a finished
     * session's status to `abandoned` — the minutes survived but every reader of
     * `status` (completion rate, band, trend, streak) then saw a session the
     * learner had actually finished as one they walked out on.
     */
    const id = await startSession(page, goalId);
    await post(page, `/api/v1/sessions/${id}/complete`, {
      activeMinutes: 5,
      ratings: [{ conceptId, rating: 'good' }],
    });

    const before = await readSession(page, id);
    expect(before.data.status).toBe('completed');

    const abandon = await post(page, `/api/v1/sessions/${id}/abandon`);
    expect(abandon.status, 'a completed session was abandonable').toBe(409);

    const after = await readSession(page, id);
    expect(after.data.status, 'a completed session was rewritten').toBe('completed');
    expect(after.data.activeMinutes).toBe(before.data.activeMinutes);
  });

  test('abandon then abandon is rejected', async () => {
    const id = await startSession(page, goalId);
    const first = await post(page, `/api/v1/sessions/${id}/abandon`);
    expect(first.status).toBe(200);

    const second = await post(page, `/api/v1/sessions/${id}/abandon`);
    expect(second.status, 'abandon was replayable').toBe(409);

    const after = await readSession(page, id);
    expect(after.data.status).toBe('abandoned');
  });

  test('an active session can still be abandoned', async () => {
    // The guard must not have closed the legitimate path.
    const id = await startSession(page, goalId);
    const r = await post(page, `/api/v1/sessions/${id}/abandon`);
    expect(r.status).toBe(200);
    expect((await readSession(page, id)).data.status).toBe('abandoned');
  });

  test('completing an abandoned session is rejected', async () => {
    const id = await startSession(page, goalId);
    await post(page, `/api/v1/sessions/${id}/abandon`);

    const complete = await post(page, `/api/v1/sessions/${id}/complete`, {
      activeMinutes: 20,
      ratings: [{ conceptId, rating: 'easy' }],
    });
    expect(complete.status).toBe(409);
    expect((await readSession(page, id)).data.status).toBe('abandoned');
  });
});

test.describe('mastery cannot be inflated from one session', () => {
  async function masteryOf(): Promise<{ mastery: number; evidenceCount: number }> {
    return page.evaluate(
      async ([g, c]) => {
        const r = (await (
          await fetch(`/api/v1/memory/mastery?goalId=${g}`, { credentials: 'include' })
        ).json()) as { data: { conceptId: string; mastery: number; evidenceCount: number }[] };
        const row = r.data.find((x) => x.conceptId === c)!;
        return { mastery: row.mastery, evidenceCount: row.evidenceCount };
      },
      [goalId, conceptId] as const,
    );
  }

  test('fifty ratings for one concept are rejected outright', async () => {
    // The audit sent this and watched mastery go 9.8% -> 68.8% on one request.
    const before = await masteryOf();

    const id = await startSession(page, goalId);
    const r = await post(page, `/api/v1/sessions/${id}/complete`, {
      activeMinutes: 5,
      ratings: Array.from({ length: 50 }, () => ({ conceptId, rating: 'easy' })),
    });

    expect(r.status, 'fifty duplicate ratings were accepted').toBe(400);

    const after = await masteryOf();
    expect(after.evidenceCount, 'evidence was written by a rejected request').toBe(
      before.evidenceCount,
    );
    expect(after.mastery).toBe(before.mastery);

    // And the session is still open, so the learner can retry correctly.
    expect((await readSession(page, id)).data.status).toBe('active');
    await post(page, `/api/v1/sessions/${id}/abandon`);
  });

  test('even two ratings for the same concept are rejected', async () => {
    const id = await startSession(page, goalId);
    const r = await post(page, `/api/v1/sessions/${id}/complete`, {
      activeMinutes: 5,
      ratings: [
        { conceptId, rating: 'good' },
        { conceptId, rating: 'again' },
      ],
    });
    // Rejected rather than de-duplicated: there is no sensible reading of which
    // of the two the client meant, and a broken client should find out.
    expect(r.status).toBe(400);
    await post(page, `/api/v1/sessions/${id}/abandon`);
  });

  test('a normal multi-concept rating still works and moves evidence exactly once', async () => {
    const concepts = await page.evaluate(async (g) => {
      const r = (await (
        await fetch(`/api/v1/memory/mastery?goalId=${g}`, { credentials: 'include' })
      ).json()) as { data: { conceptId: string; evidenceCount: number }[] };
      return r.data.slice(0, 3).map((x) => ({ id: x.conceptId, evidence: x.evidenceCount }));
    }, goalId);
    expect(concepts.length).toBeGreaterThanOrEqual(2);

    const id = await startSession(page, goalId);
    const r = await post(page, `/api/v1/sessions/${id}/complete`, {
      activeMinutes: 10,
      ratings: concepts.map((c) => ({ conceptId: c.id, rating: 'good' })),
    });
    expect(r.status).toBe(200);

    const after = await page.evaluate(async (g) => {
      const r2 = (await (
        await fetch(`/api/v1/memory/mastery?goalId=${g}`, { credentials: 'include' })
      ).json()) as { data: { conceptId: string; evidenceCount: number }[] };
      return r2.data;
    }, goalId);

    for (const c of concepts) {
      const now = after.find((x) => x.conceptId === c.id)!;
      expect(now.evidenceCount, `concept ${c.id} moved by more than one`).toBe(c.evidence + 1);
    }
  });
});

test.describe('malformed identifiers are rejected, not crashed on', () => {
  test('path and query parameters', async () => {
    const results = await page.evaluate(async () => {
      const probe = async (label: string, path: string) => {
        const r = await fetch(path, { credentials: 'include' });
        return { label, status: r.status };
      };
      return [
        await probe('path: not-a-uuid', '/api/v1/goals/not-a-uuid/plans/current'),
        await probe('path: SQL', "/api/v1/goals/' OR 1=1--/mission-control"),
        await probe('path: null', '/api/v1/goals/null/next-action'),
        await probe('path: empty-ish', '/api/v1/goals/%20/feasibility'),
        await probe('query: garbage goalId', '/api/v1/tasks?goalId=not-a-uuid'),
        await probe('query: SQL goalId', "/api/v1/memory/mastery?goalId=' OR 1=1--"),
      ];
    });

    for (const r of results) {
      expect(r.status, `${r.label} returned ${r.status}`).toBe(400);
    }
  });

  test('a valid identifier still resolves', async () => {
    const ok = await page.evaluate(async (g) => {
      const r = await fetch(`/api/v1/goals/${g}/plans/current`, { credentials: 'include' });
      return r.status;
    }, goalId);
    expect(ok).toBe(200);
  });
});
