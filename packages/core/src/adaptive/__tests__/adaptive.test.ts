import { describe, expect, it } from 'vitest';
import {
  computeAdaptiveProfile,
  MIN_SESSIONS,
  reinforceCompletion,
  renderDirective,
  type SessionObservation,
} from '../index';

/**
 * The adaptive engine.
 *
 * The assertions that matter most are the ones about *restraint*: that it says
 * nothing on thin evidence, that it never claims a history it cannot evidence,
 * and that it never emits a decision without the observation that produced it.
 * Those are the properties that make the output feel like a system that
 * understands the learner rather than one performing understanding.
 */

const TZ = 'Asia/Kolkata';
const NOW = new Date('2026-08-10T12:00:00Z');

/** `daysAgo` in the learner's local calendar, at a given local hour. */
function session(
  daysAgo: number,
  status: SessionObservation['status'],
  activeMinutes = 30,
  localHour = 17,
): SessionObservation {
  // IST is UTC+5:30, so a local hour maps back by subtracting the offset.
  const utcHour = localHour - 5.5;
  const day = new Date(NOW.getTime() - daysAgo * 86_400_000);
  day.setUTCHours(Math.floor(utcHour), (utcHour % 1) * 60, 0, 0);
  return { startedAt: day, status, activeMinutes, plannedMinutes: 30 };
}

/** Shorthand for the behavioural fixtures further down, which build long lists. */
const s = session;

describe('evidence thresholds', () => {
  it('refuses to adapt before it has seen enough', () => {
    const profile = computeAdaptiveProfile({
      sessions: [session(1, 'completed'), session(2, 'completed')],
      timeZone: TZ,
      now: NOW,
    });

    expect(profile.band).toBe('unknown');
    expect(profile.targetSessionMinutes).toBe(25);
    expect(profile.observations[0]?.statement).toMatch(/don't know how you study/i);
    expect(profile.decisions[0]?.change).toMatch(/Left your plan/);
  });

  it('says nothing at all when there is no history', () => {
    const profile = computeAdaptiveProfile({ sessions: [], timeZone: TZ, now: NOW });
    expect(profile.band).toBe('unknown');
    expect(profile.metrics.observedSessions).toBe(0);
    expect(profile.observations[0]?.evidence).toMatch(/No finished sessions/);
  });

  it('does not count the session the learner is sitting in right now', () => {
    // Three finished sessions plus one active and one paused. Neither in-flight
    // session may be read as "not completed" — that would punish someone
    // mid-session, and paused is what someone who stepped away looks like.
    const profile = computeAdaptiveProfile({
      sessions: [
        session(1, 'completed'),
        session(2, 'completed'),
        session(3, 'completed'),
        session(0, 'active'),
        session(0, 'paused'),
      ],
      timeZone: TZ,
      now: NOW,
    });

    expect(profile.metrics.observedSessions).toBe(3);
    expect(profile.metrics.sessionCompletionRate).toBe(1);
  });

  it('survives a nonsense timezone rather than throwing', () => {
    const sessions = Array.from({ length: MIN_SESSIONS }, (_, i) => session(i + 1, 'completed'));
    expect(() =>
      computeAdaptiveProfile({ sessions, timeZone: 'Not/AZone', now: NOW }),
    ).not.toThrow();
  });
});

describe('bands', () => {
  it('shortens sessions when consistency is low', () => {
    const profile = computeAdaptiveProfile({
      sessions: [
        // Distinct local hours: two sessions sharing a timestamp make the
        // newest-first sort inside the trend detector arbitrary.
        session(1, 'completed', 20, 10),
        session(1, 'abandoned', 4, 18),
        session(9, 'completed', 18, 11),
        session(9, 'abandoned', 3, 19),
        session(11, 'abandoned', 2, 16),
      ],
      timeZone: TZ,
      now: NOW,
    });

    expect(profile.band).toBe('struggling');
    expect(profile.targetSessionMinutes).toBeLessThan(profile.metrics.sessionDurationAvgMinutes);
  });

  it('lengthens sessions when consistency is high', () => {
    const sessions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((d) => session(d, 'completed', 40));
    const profile = computeAdaptiveProfile({ sessions, timeZone: TZ, now: NOW });

    expect(profile.band).toBe('thriving');
    expect(profile.targetSessionMinutes).toBeGreaterThan(profile.metrics.sessionDurationAvgMinutes);
    expect(profile.confidence).toBe('high');
  });

  it('holds the plan steady in the middle band', () => {
    const sessions = [1, 3, 5, 8, 10].map((d) => session(d, 'completed', 30));
    const profile = computeAdaptiveProfile({ sessions, timeZone: TZ, now: NOW });

    expect(profile.band).toBe('steady');
    expect(profile.trend).toBe('stable');
    expect(profile.decisions.some((d) => d.change.match(/Held your sessions/))).toBe(true);
  });
});

describe('trend — the fast loop', () => {
  it('detects decline and shortens the session immediately, without waiting for the band', () => {
    // A solid baseline, then three sessions that fell apart. The fortnight
    // average is still respectable, which is exactly the point: the slow signal
    // has not noticed yet.
    const sessions: SessionObservation[] = [
      ...[6, 7, 8, 9, 10, 11].map((d) => session(d, 'completed', 40)),
      session(1, 'abandoned', 3),
      session(2, 'abandoned', 4),
      session(3, 'completed', 6),
    ];

    const profile = computeAdaptiveProfile({ sessions, timeZone: TZ, now: NOW });
    const steadyBaseline = computeAdaptiveProfile({
      sessions: [6, 7, 8, 9, 10, 11].map((d) => session(d, 'completed', 40)),
      timeZone: TZ,
      now: NOW,
    });

    expect(profile.trend).toBe('declining');
    expect(profile.targetSessionMinutes).toBeLessThan(steadyBaseline.targetSessionMinutes);

    // And it says so, rather than quietly shrinking the plan.
    const acknowledged = profile.observations.find((o) => o.id === 'trend-declining');
    expect(acknowledged, 'the decline was not acknowledged to the learner').toBeDefined();
    expect(profile.decisions[0]?.id).toBe('trend-shorten');
  });

  it('detects improvement and lengthens the session', () => {
    const sessions: SessionObservation[] = [
      ...[6, 7, 8, 9, 10].map((d) => session(d, 'abandoned', 4)),
      session(1, 'completed', 45),
      session(2, 'completed', 45),
      session(3, 'completed', 45),
    ];

    const profile = computeAdaptiveProfile({ sessions, timeZone: TZ, now: NOW });

    expect(profile.trend).toBe('improving');
    expect(profile.decisions[0]?.id).toBe('trend-stretch');
  });

  it('catches a collapse in duration even when every session still completes', () => {
    // The quiet failure: nothing is abandoned, so a completion-only signal calls
    // this stable while the learner drops from 50 minutes to 6.
    const sessions: SessionObservation[] = [
      ...[6, 7, 8, 9, 10].map((d) => session(d, 'completed', 50)),
      session(1, 'completed', 6),
      session(2, 'completed', 7),
      session(3, 'completed', 5),
    ];

    const profile = computeAdaptiveProfile({ sessions, timeZone: TZ, now: NOW });
    expect(profile.trend).toBe('declining');
  });

  it('reports stable when there is no baseline to compare the last three against', () => {
    const sessions = [1, 2, 3].map((d) => session(d, 'completed', 30));
    const profile = computeAdaptiveProfile({ sessions, timeZone: TZ, now: NOW });
    expect(profile.trend).toBe('stable');
  });

  it('does not mistake ordinary variation for a direction', () => {
    const sessions: SessionObservation[] = [
      ...[6, 7, 8, 9, 10].map((d) => session(d, 'completed', 30)),
      session(1, 'completed', 32),
      session(2, 'completed', 28),
      session(3, 'completed', 31),
    ];
    const profile = computeAdaptiveProfile({ sessions, timeZone: TZ, now: NOW });
    expect(profile.trend).toBe('stable');
  });
});

describe('continuity — and the refusal to invent it', () => {
  it('reports the move when both fortnights independently have evidence', () => {
    const sessions: SessionObservation[] = [
      // Two weeks ago: mostly dropped.
      ...[16, 18, 20, 22, 24].map((d) => session(d, 'abandoned', 3)),
      session(17, 'completed', 20),
      // This fortnight: showing up and finishing.
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((d) => session(d, 'completed', 35)),
    ];

    const profile = computeAdaptiveProfile({ sessions, timeZone: TZ, now: NOW });

    expect(profile.transition).not.toBeNull();
    expect(profile.transition?.from).toBe('struggling');
    expect(profile.transition?.direction).toBe('up');

    const said = profile.observations.find((o) => o.id === 'transition');
    expect(said?.statement).toMatch(/Two weeks ago/i);
    // The claim has to be checkable, not just affecting.
    expect(said?.evidence).toMatch(/Then:.*Now:/);
  });

  it('says nothing about the past when the learner has no past to speak of', () => {
    // A brand-new learner, active only in the current fortnight. Claiming a
    // transition here would be fabricating a story out of silence.
    const sessions = [1, 2, 3, 4, 5, 6].map((d) => session(d, 'completed', 35));
    const profile = computeAdaptiveProfile({ sessions, timeZone: TZ, now: NOW });

    expect(profile.transition).toBeNull();
    expect(profile.observations.some((o) => o.id === 'transition')).toBe(false);
  });

  it('says nothing when the previous fortnight is too thin to band', () => {
    const sessions: SessionObservation[] = [
      // Two sessions three weeks ago is under MIN_SESSIONS — unreadable.
      session(17, 'abandoned', 3),
      session(19, 'abandoned', 3),
      ...[1, 2, 3, 4, 5, 6].map((d) => session(d, 'completed', 35)),
    ];

    const profile = computeAdaptiveProfile({ sessions, timeZone: TZ, now: NOW });
    expect(profile.transition).toBeNull();
  });

  it('stays silent when the band did not actually move', () => {
    const sessions: SessionObservation[] = [
      ...[16, 18, 20, 22].map((d) => session(d, 'completed', 35)),
      ...[1, 3, 5, 7].map((d) => session(d, 'completed', 35)),
    ];

    const profile = computeAdaptiveProfile({ sessions, timeZone: TZ, now: NOW });
    expect(profile.transition).toBeNull();
  });

  it('reports a slide backwards as plainly as a climb', () => {
    const sessions: SessionObservation[] = [
      ...[16, 17, 18, 19, 20, 21, 22, 23].map((d) => session(d, 'completed', 40)),
      ...[1, 3, 5].map((d) => session(d, 'abandoned', 3)),
      session(7, 'completed', 10),
    ];

    const profile = computeAdaptiveProfile({ sessions, timeZone: TZ, now: NOW });
    expect(profile.transition?.direction).toBe('down');
    expect(profile.observations.find((o) => o.id === 'transition')?.tone).toBe('concern');
  });
});

describe('observations', () => {
  it('notices that late sessions go worse, which the learner could not work out alone', () => {
    const sessions: SessionObservation[] = [
      session(1, 'abandoned', 5, 23),
      session(3, 'abandoned', 4, 22),
      session(5, 'abandoned', 6, 23),
      session(7, 'completed', 30, 22),
      session(2, 'completed', 35, 16),
      session(4, 'completed', 35, 15),
      session(6, 'completed', 35, 17),
      session(8, 'completed', 35, 16),
    ];

    const profile = computeAdaptiveProfile({ sessions, timeZone: TZ, now: NOW });
    const late = profile.observations.find((o) => o.id === 'late-night-drop-off');

    expect(late, 'the time-of-day pattern was not surfaced').toBeDefined();
    expect(late?.evidence).toMatch(/21:00/);
  });

  it('stays quiet about time of day when one side has too few sessions', () => {
    const sessions: SessionObservation[] = [
      session(1, 'abandoned', 5, 23),
      session(3, 'abandoned', 4, 22),
      ...[2, 4, 6, 8].map((d) => session(d, 'completed', 35, 16)),
    ];

    const profile = computeAdaptiveProfile({ sessions, timeZone: TZ, now: NOW });
    expect(profile.observations.some((o) => o.id === 'late-night-drop-off')).toBe(false);
  });

  it('counts a streak in the learner’s local days, not UTC days', () => {
    // 00:30 IST on each of the last three local days is 19:00 UTC the day
    // before. Counting in UTC would scatter these across the wrong dates.
    const sessions = [0, 1, 2].map((d) => session(d, 'completed', 30, 0.5));
    const profile = computeAdaptiveProfile({ sessions, timeZone: TZ, now: NOW });

    expect(profile.metrics.currentStreakDays).toBe(3);
  });

  it('does not break the streak just because today has not happened yet', () => {
    const sessions = [1, 2, 3].map((d) => session(d, 'completed', 30));
    const profile = computeAdaptiveProfile({ sessions, timeZone: TZ, now: NOW });

    expect(profile.metrics.currentStreakDays).toBe(3);
  });

  it('ignores sessions older than both windows', () => {
    const sessions = [
      ...[1, 2, 3].map((d) => session(d, 'completed', 30)),
      ...[40, 41, 42, 43].map((d) => session(d, 'abandoned', 2)),
    ];
    const profile = computeAdaptiveProfile({ sessions, timeZone: TZ, now: NOW });

    expect(profile.metrics.observedSessions).toBe(3);
    expect(profile.metrics.sessionCompletionRate).toBe(1);
  });

  it('never emits a decision without a reason, or an observation without evidence', () => {
    const sessions = [1, 2, 3, 4, 5, 6].map((d) => session(d, 'completed', 30));
    const profile = computeAdaptiveProfile({ sessions, timeZone: TZ, now: NOW });

    expect(profile.decisions.length).toBeGreaterThan(0);
    for (const decision of profile.decisions) {
      expect(decision.change.length).toBeGreaterThan(0);
      expect(decision.because.length).toBeGreaterThan(0);
    }
    for (const observation of profile.observations) {
      expect(observation.evidence.length).toBeGreaterThan(0);
    }
  });
});

describe('the directive — turning a recommendation into an action', () => {
  const TASK = { taskTitle: "Newton's Third Law", estimatedMinutes: 50 };

  /** Sentences, counted the way a reader would. */
  const sentences = (text: string): string[] =>
    text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);

  const profileFrom = (sessions: SessionObservation[]) =>
    computeAdaptiveProfile({ sessions, timeZone: TZ, now: NOW });

  const STRUGGLING_DROPS = [
    ...[8, 9, 10, 11].map((d) => s(d, 'completed', 30)),
    s(1, 'abandoned', 3),
    s(2, 'abandoned', 4),
  ];
  const STREAK = [0, 1, 2, 3, 4, 5].map((d) => s(d, 'completed', 30));
  const STEADY = [1, 3, 5, 8, 10].map((d) => s(d, 'completed', 30));

  it('normalises the failure and redirects, in two sentences', () => {
    const directive = renderDirective(profileFrom(STRUGGLING_DROPS), TASK);

    expect(directive.stance).toBe('recovery');
    expect(directive.text).toMatch(/You dropped the last 2 sessions\./);
    expect(directive.text).toMatch(/Reset with \d+ minutes on Newton's Third Law now\./);
    expect(sentences(directive.text)).toHaveLength(2);
  });

  it('names momentum and asks for continuation', () => {
    const directive = renderDirective(profileFrom(STREAK), TASK);

    expect(directive.stance).toBe('momentum');
    expect(directive.text).toMatch(/days straight\./i);
    expect(directive.text).toMatch(/Keep it going with \d+ minutes/);
  });

  it('asks for the time box and stops talking when there is nothing to report', () => {
    const directive = renderDirective(profileFrom(STEADY), TASK);

    expect(directive.stance).toBe('commitment');
    expect(directive.text).toBe("Do Newton's Third Law now. Stay with it for 30 minutes.");
  });

  it('claims nothing about a learner it has never seen', () => {
    const directive = renderDirective(profileFrom([s(1, 'completed', 20)]), TASK);

    expect(directive.stance).toBe('onboarding');
    expect(directive.text).toBe("Start with Newton's Third Law. Stay with it for 25 minutes.");
    // No observation about them, because there is nothing to observe.
    expect(directive.text).not.toMatch(/you (are|have|dropped|finish)/i);
  });

  it('commits to time, never to finishing a task longer than the target', () => {
    const profile = profileFrom(STRUGGLING_DROPS);
    const directive = renderDirective(profile, TASK);

    // The whole point: a 50-minute task under a shortened target asks for the
    // target, not the task. Promising to finish is the promise being broken.
    expect(directive.committedMinutes).toBeLessThanOrEqual(profile.targetSessionMinutes);
    expect(directive.committedMinutes).toBeLessThan(TASK.estimatedMinutes);
    expect(directive.text).toContain(`${directive.committedMinutes} minutes`);
  });

  it('never asks for more time than the task actually takes', () => {
    const directive = renderDirective(profileFrom(STREAK), {
      taskTitle: 'Quick review',
      estimatedMinutes: 12,
    });
    expect(directive.committedMinutes).toBe(12);
  });

  it('always ends on the instruction, and never hedges', () => {
    for (const sessions of [STRUGGLING_DROPS, STREAK, STEADY, [s(1, 'completed', 20)]]) {
      const { text } = renderDirective(profileFrom(sessions), TASK);
      const parts = sentences(text);

      expect(parts.length, `too much to read before acting: ${text}`).toBeLessThanOrEqual(2);
      // The last sentence is the one they act on.
      expect(parts.at(-1), `the action is not last: ${text}`).toMatch(/(now|for \d+ minutes)\.$/i);
      expect(text).not.toMatch(
        /it seems|might want to|perhaps|somewhat|a bit|try to|I would suggest|maybe/i,
      );
    }
  });

  it('puts recovery ahead of momentum when a good run just broke', () => {
    // Thriving fortnight, then two dropped sessions. The streak is the wrong
    // thing to lead with when the learner is mid-collapse.
    const profile = profileFrom([
      ...[4, 5, 6, 7, 8, 9, 10].map((d) => s(d, 'completed', 40)),
      s(1, 'abandoned', 2),
      s(2, 'abandoned', 3),
    ]);

    expect(renderDirective(profile, TASK).stance).toBe('recovery');
  });
});

describe('completion feedback — behaviour, not outcome', () => {
  it('names what the learner did when they saw it through', () => {
    const line = reinforceCompletion({ activeMinutes: 30, estimatedMinutes: 25 });
    expect(line).toBe('You stayed with it and finished. That is the pattern.');
  });

  it('states a short session flatly and sets the target, without reproach', () => {
    const line = reinforceCompletion({ activeMinutes: 18, estimatedMinutes: 30 });
    expect(line).toMatch(/18 of 30 minutes/);
    expect(line).toMatch(/hold the full 30 next time/i);
  });

  it('counts a very short session rather than treating it as a failure', () => {
    const line = reinforceCompletion({ activeMinutes: 4, estimatedMinutes: 30 });
    expect(line).toMatch(/Short counts/);
  });

  it('never praises the outcome, and never guilts', () => {
    for (const minutes of [2, 12, 30, 60]) {
      const line = reinforceCompletion({ activeMinutes: minutes, estimatedMinutes: 30 });
      expect(line, line).not.toMatch(/mastery|progress|score|%|great|well done|amazing|proud/i);
      expect(line, line).not.toMatch(/should have|failed|only managed|unfortunately|but you/i);
    }
  });
});
