import { describe, expect, it } from 'vitest';
import {
  computeDrift,
  decideReplan,
  identifyMissedTasks,
  isMaterial,
  withinChurnBudget,
} from '../replanning';

describe('core/replanning — drift and materiality (§10.3)', () => {
  it('identical plans produce zero drift', () => {
    const tasks = [{ conceptId: 'a', scheduledDate: '2026-01-05' }];
    const result = computeDrift({
      previousTasks: tasks,
      newTasks: tasks,
      previousVerdict: 'on_track',
      newVerdict: 'on_track',
      previousProjectedCompletionDate: '2026-06-01',
      newProjectedCompletionDate: '2026-06-01',
      previousRequiredMinutes: 1000,
      newRequiredMinutes: 1000,
      today: '2026-01-01',
    });
    expect(result.drift).toBe(0);
    expect(result.verdictChanged).toBe(false);
  });

  it('a verdict change is material regardless of drift magnitude', () => {
    const drift = computeDrift({
      previousTasks: [],
      newTasks: [],
      previousVerdict: 'on_track',
      newVerdict: 'at_risk',
      previousProjectedCompletionDate: null,
      newProjectedCompletionDate: null,
      previousRequiredMinutes: 1000,
      newRequiredMinutes: 1000,
      today: '2026-01-01',
    });
    expect(isMaterial(drift, 'evidence', 0.15)).toBe(true);
  });

  it('small task-date shifts under the threshold are immaterial', () => {
    const drift = computeDrift({
      previousTasks: [{ conceptId: 'a', scheduledDate: '2026-01-05' }],
      newTasks: [{ conceptId: 'a', scheduledDate: '2026-01-05' }],
      previousVerdict: 'on_track',
      newVerdict: 'on_track',
      previousProjectedCompletionDate: '2026-06-01',
      newProjectedCompletionDate: '2026-06-01',
      previousRequiredMinutes: 1000,
      newRequiredMinutes: 1010, // 1% change, well under 5%
      today: '2026-01-01',
    });
    expect(isMaterial(drift, 'temporal', 0.15)).toBe(false);
  });

  it('explicit triggers are always material, even with zero drift', () => {
    const drift = computeDrift({
      previousTasks: [],
      newTasks: [],
      previousVerdict: 'on_track',
      newVerdict: 'on_track',
      previousProjectedCompletionDate: null,
      newProjectedCompletionDate: null,
      previousRequiredMinutes: 100,
      newRequiredMinutes: 100,
      today: '2026-01-01',
    });
    expect(isMaterial(drift, 'explicit', 0.15)).toBe(true);
  });
});

describe('core/replanning — churn budget', () => {
  it('caps automatic changes at one per 24h and three per week', () => {
    expect(withinChurnBudget({ changesLast24h: 0, changesLast7d: 0 }, 'evidence')).toBe(true);
    expect(withinChurnBudget({ changesLast24h: 1, changesLast7d: 1 }, 'evidence')).toBe(false);
    expect(withinChurnBudget({ changesLast24h: 0, changesLast7d: 3 }, 'evidence')).toBe(false);
  });

  it('never rate-limits explicit requests', () => {
    expect(withinChurnBudget({ changesLast24h: 5, changesLast7d: 10 }, 'explicit')).toBe(true);
  });
});

describe('core/replanning — the missed-session debt model (§10.4)', () => {
  it('identifies overdue pending tasks without shifting them forward', () => {
    const tasks = [
      { taskId: 't1', conceptId: 'a', scheduledDate: '2025-12-20', status: 'pending' },
      { taskId: 't2', conceptId: 'b', scheduledDate: '2026-01-05', status: 'pending' }, // future
      { taskId: 't3', conceptId: 'c', scheduledDate: '2025-12-15', status: 'completed' }, // done
    ];
    const missed = identifyMissedTasks(tasks, '2026-01-01');
    expect(missed.map((m) => m.taskId)).toEqual(['t1']);
    // No "backlog" field or forwarded date exists anywhere on the result —
    // the shape itself proves nothing is being shifted.
    expect(missed[0]).not.toHaveProperty('rescheduledTo');
  });
});

describe('core/replanning — the full gate (§10.2)', () => {
  it('discards an immaterial candidate and keeps the active version', () => {
    const decision = decideReplan(
      {
        previousTasks: [{ conceptId: 'a', scheduledDate: '2026-01-05' }],
        newTasks: [{ conceptId: 'a', scheduledDate: '2026-01-05' }],
        previousVerdict: 'on_track',
        newVerdict: 'on_track',
        previousProjectedCompletionDate: '2026-06-01',
        newProjectedCompletionDate: '2026-06-01',
        previousRequiredMinutes: 1000,
        newRequiredMinutes: 1000,
        today: '2026-01-01',
      },
      'temporal',
      0.15,
      { changesLast24h: 0, changesLast7d: 0 },
    );
    expect(decision.shouldCommit).toBe(false);
    expect(decision.reason).toBe('immaterial');
  });

  it('commits a material, explicit request even against a tight churn budget', () => {
    const decision = decideReplan(
      {
        previousTasks: [],
        newTasks: [{ conceptId: 'a', scheduledDate: '2026-01-05' }],
        previousVerdict: 'at_risk',
        newVerdict: 'on_track',
        previousProjectedCompletionDate: null,
        newProjectedCompletionDate: null,
        previousRequiredMinutes: 1000,
        newRequiredMinutes: 500,
        today: '2026-01-01',
      },
      'explicit',
      0.15,
      { changesLast24h: 5, changesLast7d: 10 },
    );
    expect(decision.shouldCommit).toBe(true);
  });
});
