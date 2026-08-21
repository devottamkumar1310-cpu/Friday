import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { newLearner, onboard } from './support/learner';

/**
 * The Phase 4 audit matrix: every surface, every breakpoint, both themes.
 *
 * This is a *reporting* spec as much as an asserting one. It walks the product
 * at each viewport in each theme and collects concrete, located defects —
 * element, page, width, theme — because "something overflows at 360px" is not
 * actionable, and `<div class="grid-cols-3"> right=412 limit=360 on /plan
 * (dark)` is.
 *
 * The checks are the ones that actually break a product on a phone:
 *
 *   overflow      content wider than the screen
 *   tap targets   controls too small to hit reliably. WCAG 2.5.8 sets 24px as
 *                 the floor; 44px is the iOS guideline and what we hold to.
 *   contrast      text that vanishes in one theme because a colour was
 *                 hardcoded instead of tokenised
 *   focus         a keyboard user unable to see where they are
 */

const VIEWPORTS = [
  { label: '320', width: 320, height: 800 },
  { label: '360', width: 360, height: 800 },
  { label: '390', width: 390, height: 844 },
  { label: '768', width: 768, height: 1024 },
  { label: '1024', width: 1024, height: 768 },
  { label: '1440', width: 1440, height: 900 },
];

const PAGES = ['/dashboard', '/plan', '/practice', '/progress', '/settings', '/coach', '/memory'];
const THEMES = ['light', 'dark'] as const;

const learner = newLearner('audit');
let context: BrowserContext;
let page: Page;

interface Finding {
  severity: 'P0' | 'P1' | 'P2';
  kind: string;
  where: string;
  detail: string;
}
const findings: Finding[] = [];

test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  await onboard(page, learner);
});

test.afterAll(async () => {
  if (findings.length > 0) {
    const count = (s: string) => findings.filter((f) => f.severity === s).length;
    // eslint-disable-next-line no-console -- the audit report IS the deliverable
    console.log(
      [
        '',
        '============ RESPONSIVE / THEME AUDIT ============',
        `P0 ${count('P0')}   P1 ${count('P1')}   P2 ${count('P2')}`,
        '',
        ...findings.map(
          (f) => `  [${f.severity}] ${f.kind.padEnd(12)} ${f.where}\n        ${f.detail}`,
        ),
        '==================================================',
        '',
      ].join('\n'),
    );
  }
  await context.close();
});

async function setTheme(target: Page, theme: 'light' | 'dark') {
  await target.evaluate((t) => {
    window.localStorage.setItem('friday-theme', t);
    document.documentElement.classList.toggle('dark', t === 'dark');
  }, theme);
}

/** Elements sticking out past the viewport, with enough detail to find them. */
async function overflowOffenders(target: Page): Promise<string[]> {
  return target.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.right > limit + 1) {
        const cls = typeof el.className === 'string' ? el.className.slice(0, 60) : '';
        out.push(
          `<${el.tagName.toLowerCase()} class="${cls}"> right=${Math.round(r.right)} limit=${limit}`,
        );
      }
    }
    return [...new Set(out)].slice(0, 3);
  });
}

/** Interactive controls smaller than a fingertip. */
async function smallTargets(target: Page): Promise<string[]> {
  return target.evaluate(() => {
    const out: string[] = [];
    const sel = 'a[href], button, input:not([type=hidden]), select, textarea, [role=button]';
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Inline links inside a paragraph are exempt: WCAG 2.5.8 excludes them,
      // and enlarging them would wreck the typography for no safety gain.
      if (el.tagName === 'A' && el.closest('p') !== null) continue;
      if (r.height < 44 || r.width < 24) {
        const label = (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30);
        out.push(
          `${el.tagName.toLowerCase()} "${label}" ${Math.round(r.width)}x${Math.round(r.height)}`,
        );
      }
    }
    return [...new Set(out)].slice(0, 4);
  });
}

/** Text the theme has rendered near-invisible — the hardcoded-colour bug. */
async function lowContrastText(target: Page): Promise<string[]> {
  return target.evaluate(() => {
    const parse = (c: string): number[] => {
      const m = c.match(/[\d.]+/g);
      if (!m) return [0, 0, 0, 1];
      return [Number(m[0]), Number(m[1]), Number(m[2]), m[3] === undefined ? 1 : Number(m[3])];
    };
    const lum = (c: number[]) => {
      const f = (v: number) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(c[0]!) + 0.7152 * f(c[1]!) + 0.0722 * f(c[2]!);
    };
    const bgOf = (el: HTMLElement): number[] => {
      let cur: HTMLElement | null = el;
      while (cur) {
        const c = parse(getComputedStyle(cur).backgroundColor);
        if (c[3]! > 0.1) return c;
        cur = cur.parentElement;
      }
      return [255, 255, 255, 1];
    };
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const text = (el.textContent ?? '').trim();
      if (!text || el.children.length > 0) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const fg = parse(getComputedStyle(el).color);
      if (fg[3]! < 0.1) continue;
      const l1 = lum(fg);
      const l2 = lum(bgOf(el));
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      // 3:1 rather than 4.5:1 — this pass hunts for text that has effectively
      // disappeared, not for every borderline body-copy shade.
      if (ratio < 3) out.push(`"${text.slice(0, 32)}" contrast ${ratio.toFixed(2)}:1`);
    }
    return [...new Set(out)].slice(0, 4);
  });
}

for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    test(`${vp.label}px - ${theme}`, async () => {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      for (const path of PAGES) {
        await page.goto(path);
        await setTheme(page, theme);
        await page.waitForLoadState('networkidle').catch(() => undefined);

        const where = `${path} @${vp.label}px ${theme}`;

        for (const d of await overflowOffenders(page)) {
          findings.push({ severity: 'P0', kind: 'overflow', where, detail: d });
        }
        for (const d of await smallTargets(page)) {
          findings.push({ severity: 'P1', kind: 'tap-target', where, detail: d });
        }
        for (const d of await lowContrastText(page)) {
          findings.push({ severity: 'P0', kind: 'contrast', where, detail: d });
        }
      }

      const p0 = findings.filter((f) => f.severity === 'P0' && f.where.includes(`@${vp.label}px`));
      expect(p0.map((f) => `${f.kind} ${f.where} ${f.detail}`)).toStrictEqual([]);
    });
  }
}

test('keyboard: every interactive control on the dashboard shows focus', async () => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/dashboard');

  const noFocusRing = await page.evaluate(() => {
    const out: string[] = [];
    const sel = 'a[href], button, input, select, textarea';
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      el.focus();
      const s = getComputedStyle(el);
      const hasRing =
        (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none';
      if (!hasRing)
        out.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? '').slice(0, 24)}"`);
    }
    return out;
  });

  for (const d of noFocusRing) {
    findings.push({ severity: 'P1', kind: 'focus', where: '/dashboard', detail: d });
  }
  expect(noFocusRing, 'controls with no visible focus indicator').toStrictEqual([]);
});
