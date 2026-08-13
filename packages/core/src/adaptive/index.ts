/**
 * The minimal adaptive engine.
 *
 * Three readings of the same table, turned into four decisions about how the
 * system should treat the learner next. No new tables, no new tracking, no model
 * call — every input already exists in `study_sessions`.
 *
 *   band       where they are over a fortnight  (slow, stable)
 *   trend      where the last three sessions went (fast, twitchy)
 *   transition where they were a fortnight ago    (continuity)
 *
 * Band decides the baseline; trend modulates it, because a learner whose last
 * three sessions collapsed needs a shorter session tonight, not in ten days when
 * the fortnight average finally notices. Transition is what makes the system
 * feel like it remembers — and is the easiest of the three to fake, so it is the
 * most tightly guarded.
 *
 * Three properties matter more than the rules themselves:
 *
 *   1. **It refuses to adapt on thin evidence.** Under `MIN_SESSIONS` the band
 *      is `unknown` and every dial sits at neutral. The fastest way to make a
 *      system feel stupid is to have it announce a confident conclusion drawn
 *      from two data points, and a learner told "you study inconsistently" on
 *      their second day will never trust the fourth thing it says.
 *
 *   2. **It never invents history.** A transition is emitted only when *both*
 *      windows independently cleared `MIN_SESSIONS`. "You were struggling last
 *      week, now you're steady" is the single most affecting sentence this
 *      engine can produce and the single most damaging one to get wrong.
 *
 *   3. **Every decision carries the observation it came from.** `observations`
 *      and `decisions` are computed here, next to the arithmetic, rather than
 *      written as copy in the UI or improvised by the Coach. The panel and the
 *      Coach both read this one structure, so they cannot contradict each other.
 *
 * Pure, like the rest of `@friday/core`: given sessions, returns a profile.
 */

/** The slice of a study session this engine reads. Nothing else is needed. */
export interface SessionObservation {
  startedAt: Date;
  status: 'active' | 'paused' | 'completed' | 'abandoned';
  /** Server-clamped wall-clock minutes (see the completion path). */
  activeMinutes: number;
  plannedMinutes: number | null;
}

export interface AdaptiveMetrics {
  /** Mean `activeMinutes` over completed sessions. 0 when there are none. */
  sessionDurationAvgMinutes: number;
  /** completed / (completed + abandoned). In-flight sessions are still in play. */
  sessionCompletionRate: number;
  /** 0..1 — the composite the band rules branch on. */
  consistencyScore: number;
  /** Consecutive days, ending today or yesterday, with a completed session. */
  currentStreakDays: number;
  daysStudiedInWindow: number;
  windowDays: number;
  /** Finished sessions considered. Drives `confidence`, and the refusal above. */
  observedSessions: number;
  /** Abandoned sessions among the most recent three. Never inferred — counted. */
  recentDrops: number;
}

export type AdaptiveBand = 'unknown' | 'struggling' | 'steady' | 'thriving';
export type AdaptiveTrend = 'improving' | 'stable' | 'declining';

/**
 * How to speak to this learner right now.
 *
 * Band and trend describe what is true. Stance decides what that should *sound*
 * like, which is a different question: the same 40% completion rate warrants
 * "reset with 8 minutes" from someone who just dropped two sessions and "keep
 * it going" from someone three days into a run.
 *
 *   recovery    something broke — normalise it and redirect, without comment
 *   momentum    something is working — name it and ask for continuation
 *   commitment  nothing to report — ask for the time box and stop talking
 *   onboarding  no evidence — no claims about them at all
 */
export type AdaptiveStance = 'recovery' | 'momentum' | 'commitment' | 'onboarding';

/** Where the learner was a fortnight ago, versus now. Never inferred. */
export interface AdaptiveTransition {
  from: AdaptiveBand;
  to: AdaptiveBand;
  direction: 'up' | 'down';
}

export interface AdaptiveObservation {
  id: string;
  /** One sentence, learner-facing, about them — not about the system. */
  statement: string;
  /** The arithmetic behind it, so the claim is checkable rather than asserted. */
  evidence: string;
  tone: 'positive' | 'neutral' | 'concern';
}

export interface AdaptiveDecision {
  id: string;
  /** What changed. */
  change: string;
  /** Which observation it follows from. */
  because: string;
}

export interface AdaptiveProfile {
  band: AdaptiveBand;
  /** The last three sessions against the ones before them. */
  trend: AdaptiveTrend;
  /** Non-null only when two independent windows both had enough evidence. */
  transition: AdaptiveTransition | null;
  /** Which register the directive speaks in. See `AdaptiveStance`. */
  stance: AdaptiveStance;
  metrics: AdaptiveMetrics;
  /**
   * What a session should be sized at, in minutes.
   *
   * **The only dial on this profile, and that is deliberate.** Three others
   * existed — `workloadMultiplier`, `difficultyBias`, `guidance` — and an audit
   * found that nothing in the product read any of them. The panel announced
   * "cut your daily load to 60%" and "put easier material first" as accomplished
   * facts while the planner did neither. Three of the four things FRIDAY claimed
   * to have done were fiction.
   *
   * They are not hidden, deprecated, or commented out: they are gone. A field
   * that exists is a field a future decision string will reach for, and the copy
   * is generated from this structure. The rule this enforces structurally is
   * that a dial may exist only once a consumer does — see
   * `dashboard/page.tsx`, which passes this one to the planner as the time
   * budget the Next Action is ranked against.
   */
  targetSessionMinutes: number;
  confidence: 'low' | 'medium' | 'high';
  observations: AdaptiveObservation[];
  decisions: AdaptiveDecision[];
}

// --- Constants. Every threshold that decides something is named. ---

/** Statuses that mean "not finished yet", as opposed to "finished badly". */
const IN_FLIGHT = new Set<SessionObservation['status']>(['active', 'paused']);

/** Below this, the engine reports `unknown` and changes nothing. */
export const MIN_SESSIONS = 3;
const WINDOW_DAYS = 14;
/** Studying 5 days in 7 counts as full coverage. Nobody studies daily. */
const TARGET_DAYS_PER_WEEK = 5;
const STRUGGLING_BELOW = 0.4;
const THRIVING_AT_OR_ABOVE = 0.75;

/** How many recent sessions make a trend. The user asked for three. */
const TREND_SAMPLE = 3;
/** And how many earlier ones are needed to have something to compare against. */
const TREND_BASELINE_MIN = 2;
/** Quality change below this is noise, not a direction. */
const TREND_MARGIN = 0.2;

/** A late session starts at or after this local hour. */
const LATE_HOUR = 21;
/** Enough late sessions to say something about them without guessing. */
const MIN_LATE_SESSIONS = 3;
/** Completion gap that makes "late sessions go worse" worth surfacing. */
const LATE_COMPLETION_GAP = 0.25;

const DEFAULT_SESSION_MINUTES = 25;
const MIN_SESSION_MINUTES = 10;
const MAX_SESSION_MINUTES = 60;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

const pct = (n: number): string => `${Math.round(n * 100)}%`;

/** "1 study day", "7 study days". Learner-facing copy is generated, so it agrees. */
const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * The learner's local calendar day, `YYYY-MM-DD`.
 *
 * Consistency is a human question — "did I study on Tuesday?" — so it has to be
 * counted in the learner's own days. Counting UTC days would split an 11pm IST
 * session onto the previous date and invent a gap that never happened.
 */
function localDayKey(date: Date, timeZone: string): string {
  try {
    // en-CA formats as YYYY-MM-DD, which sorts and compares as a string.
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    // An unknown timezone is a bad profile field, not a reason to fail.
    return date.toISOString().slice(0, 10);
  }
}

function localHour(date: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(date);
    const hour = parts.find((p) => p.type === 'hour')?.value;
    return hour === undefined ? date.getUTCHours() : Number(hour) % 24;
  } catch {
    return date.getUTCHours();
  }
}

/** `key` shifted back `n` days, still in the learner's calendar. */
function shiftDayKey(key: string, days: number): string {
  const shifted = new Date(`${key}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() - days);
  return shifted.toISOString().slice(0, 10);
}

/**
 * Consecutive study days ending today, or ending yesterday.
 *
 * Yesterday counts because the day is not over. Breaking someone's streak at
 * 9am for not having studied yet is the kind of small dishonesty that teaches a
 * learner to stop reading the number.
 */
function streakLength(studiedDays: Set<string>, todayKey: string): number {
  let cursor = studiedDays.has(todayKey) ? todayKey : shiftDayKey(todayKey, 1);
  if (!studiedDays.has(cursor)) return 0;

  let length = 0;
  while (studiedDays.has(cursor)) {
    length += 1;
    cursor = shiftDayKey(cursor, 1);
  }
  return length;
}

interface WindowStats {
  finished: SessionObservation[];
  completed: SessionObservation[];
  studiedDays: Set<string>;
  durationAvg: number;
  completionRate: number;
  consistencyScore: number;
}

/**
 * Everything derivable from one time window. Called twice — once for now, once
 * for a fortnight ago — which is the whole of the continuity mechanism.
 */
function statsFor(
  sessions: SessionObservation[],
  timeZone: string,
  from: Date,
  to: Date,
): WindowStats {
  // In-flight sessions have not failed. Counting an active or paused one as
  // "not completed" would penalise a learner for the session they are sitting
  // in right now — and paused is the state of someone who stepped away for two
  // minutes, which is the opposite of giving up.
  const finished = sessions.filter(
    (s) => !IN_FLIGHT.has(s.status) && s.startedAt >= from && s.startedAt < to,
  );
  const completed = finished.filter((s) => s.status === 'completed');

  const durationAvg =
    completed.length > 0
      ? completed.reduce((sum, s) => sum + s.activeMinutes, 0) / completed.length
      : 0;
  const completionRate = finished.length > 0 ? completed.length / finished.length : 0;

  const studiedDays = new Set(completed.map((s) => localDayKey(s.startedAt, timeZone)));
  const expectedDays = (WINDOW_DAYS * TARGET_DAYS_PER_WEEK) / 7;
  const coverage = clamp(studiedDays.size / expectedDays, 0, 1);

  // Coverage is "did they show up"; completion is "did they stay". A learner who
  // opens a session every day and abandons half of them is not consistent, and a
  // score built only from days-touched would call them exemplary.
  const consistencyScore = finished.length > 0 ? 0.6 * coverage + 0.4 * completionRate : 0;

  return { finished, completed, studiedDays, durationAvg, completionRate, consistencyScore };
}

function bandFor(stats: WindowStats): AdaptiveBand {
  if (stats.finished.length < MIN_SESSIONS) return 'unknown';
  if (stats.consistencyScore < STRUGGLING_BELOW) return 'struggling';
  if (stats.consistencyScore >= THRIVING_AT_OR_ABOVE) return 'thriving';
  return 'steady';
}

const BAND_RANK: Record<AdaptiveBand, number> = {
  unknown: -1,
  struggling: 0,
  steady: 1,
  thriving: 2,
};

interface TrendRead {
  trend: AdaptiveTrend;
  recentQuality: number;
  baselineQuality: number;
  /** Sessions the recent figure was computed from — for the evidence line. */
  sampled: number;
}

/**
 * The last three sessions against the ones before them.
 *
 * Quality is completion *scaled by how long they lasted*, because the two
 * failure modes look different and both matter: a learner who abandons is
 * obvious, and a learner who still finishes every session but whose durations
 * have collapsed from 45 minutes to 8 is quietly falling apart while a
 * completion-only signal calls them stable.
 */
function detectTrend(finished: SessionObservation[], reference: number): TrendRead {
  // Newest first, explicitly — the caller's ordering is not this function's
  // business, and getting it backwards would invert every trend silently.
  const ordered = [...finished].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  const recent = ordered.slice(0, TREND_SAMPLE);
  const baseline = ordered.slice(TREND_SAMPLE);

  const denominator = reference > 0 ? reference : DEFAULT_SESSION_MINUTES;
  const quality = (s: SessionObservation): number =>
    s.status === 'completed' ? Math.min(1, s.activeMinutes / denominator) : 0;
  const mean = (rows: SessionObservation[]): number =>
    rows.length === 0 ? 0 : rows.reduce((sum, s) => sum + quality(s), 0) / rows.length;

  const recentQuality = mean(recent);
  const baselineQuality = mean(baseline);

  // Not enough on either side is `stable` — the honest answer for "no direction
  // detectable", and it leaves the band's baseline untouched.
  if (recent.length < TREND_SAMPLE || baseline.length < TREND_BASELINE_MIN) {
    return { trend: 'stable', recentQuality, baselineQuality, sampled: recent.length };
  }

  const delta = recentQuality - baselineQuality;
  const trend: AdaptiveTrend =
    delta <= -TREND_MARGIN ? 'declining' : delta >= TREND_MARGIN ? 'improving' : 'stable';

  return { trend, recentQuality, baselineQuality, sampled: recent.length };
}

export interface AdaptiveInput {
  sessions: SessionObservation[];
  /** The learner's IANA timezone. Consistency is counted in their local days. */
  timeZone: string;
  now: Date;
}

/**
 * Derives the profile.
 *
 * Deliberately boring arithmetic. The intelligence a learner perceives comes
 * from the system *noticing and saying* something true about them, not from the
 * sophistication of the statistic behind it.
 */
export function computeAdaptiveProfile(input: AdaptiveInput): AdaptiveProfile {
  const { timeZone, now } = input;
  const todayKey = localDayKey(now, timeZone);

  const windowStart = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const priorStart = new Date(now.getTime() - 2 * WINDOW_DAYS * 86_400_000);

  const current = statsFor(input.sessions, timeZone, windowStart, now);
  const prior = statsFor(input.sessions, timeZone, priorStart, windowStart);

  const metrics: AdaptiveMetrics = {
    sessionDurationAvgMinutes: Math.round(current.durationAvg),
    sessionCompletionRate: current.completionRate,
    consistencyScore: current.consistencyScore,
    currentStreakDays: streakLength(current.studiedDays, todayKey),
    daysStudiedInWindow: current.studiedDays.size,
    windowDays: WINDOW_DAYS,
    observedSessions: current.finished.length,
    recentDrops: [...current.finished]
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, TREND_SAMPLE)
      .filter((s) => s.status === 'abandoned').length,
  };

  const band = bandFor(current);
  const { trend, ...trendDetail } = detectTrend(current.finished, current.durationAvg);

  if (band === 'unknown') return neutralProfile(metrics, trend);

  /**
   * Continuity, and the one place this engine could lie.
   *
   * Both windows must independently clear `MIN_SESSIONS`. A learner who took a
   * fortnight off has an empty prior window, and "you were struggling, now
   * you're steady" would be fabricated from that silence — the exact failure the
   * instruction "do NOT fake history" names.
   */
  const priorBand = bandFor(prior);
  const transition: AdaptiveTransition | null =
    priorBand !== 'unknown' && priorBand !== band
      ? {
          from: priorBand,
          to: band,
          direction: BAND_RANK[band] > BAND_RANK[priorBand] ? 'up' : 'down',
        }
      : null;

  // Kept apart so the decision copy can tell the truth about direction: the
  // trend claims a *cut* only when the number actually went down, which it does
  // not when the baseline is already at the floor.
  const baseline = tune(band, metrics);
  const dials = applyTrend(baseline, trend);
  const observations = describeObservations({
    metrics,
    band,
    trend,
    trendDetail,
    transition,
    prior,
    finished: current.finished,
    timeZone,
  });

  return {
    band,
    trend,
    transition,
    stance: stanceFor(band, trend, metrics),
    metrics,
    ...dials,
    confidence:
      current.finished.length >= 10 ? 'high' : current.finished.length >= 6 ? 'medium' : 'low',
    observations,
    decisions: describeDecisions(band, trend, dials, baseline, observations),
  };
}

/** Not enough evidence: report the metrics, change nothing, say why. */
function neutralProfile(metrics: AdaptiveMetrics, trend: AdaptiveTrend): AdaptiveProfile {
  const remaining = MIN_SESSIONS - metrics.observedSessions;
  return {
    band: 'unknown',
    trend,
    transition: null,
    stance: 'onboarding',
    metrics,
    targetSessionMinutes: DEFAULT_SESSION_MINUTES,
    confidence: 'low',
    observations: [
      {
        id: 'warming-up',
        statement: "I don't know how you study yet.",
        evidence:
          metrics.observedSessions === 0
            ? 'No finished sessions to learn from.'
            : `${metrics.observedSessions} finished session${metrics.observedSessions === 1 ? '' : 's'} so far — I need ${remaining} more before I start changing your plan.`,
        tone: 'neutral',
      },
    ],
    decisions: [
      {
        id: 'no-change',
        change: 'Left your plan exactly as it is.',
        because: 'Adjusting it on this little evidence would be guessing, not adapting.',
      },
    ],
  };
}

interface TunedDials {
  targetSessionMinutes: number;
}

/** The band rules. One dial, because one dial is all the product enforces. */
function tune(band: AdaptiveBand, metrics: AdaptiveMetrics): TunedDials {
  const observed = metrics.sessionDurationAvgMinutes || DEFAULT_SESSION_MINUTES;

  if (band === 'struggling') {
    // Shorter than they currently manage, because what they currently manage
    // is being abandoned. A target under the observed average is reachable.
    return { targetSessionMinutes: clamp(Math.round(observed * 0.7), MIN_SESSION_MINUTES, 25) };
  }
  if (band === 'thriving') {
    return { targetSessionMinutes: clamp(Math.round(observed * 1.15), 25, MAX_SESSION_MINUTES) };
  }
  return { targetSessionMinutes: clamp(Math.round(observed), 15, 45) };
}

/**
 * Trend modulates the band's baseline; it never replaces it.
 *
 * The two operate on different clocks on purpose. A fortnight average is stable
 * enough to plan against and far too slow to react — a learner whose last three
 * sessions fell apart would wait ten days for the mean to catch up. Trend is the
 * fast loop, and it only ever nudges.
 */
function applyTrend(dials: TunedDials, trend: AdaptiveTrend): TunedDials {
  if (trend === 'declining') {
    // "Immediately reduce session duration" — the same night, not once the
    // fortnight average agrees. Clamped so it can never rise.
    return {
      targetSessionMinutes: clamp(
        Math.round(dials.targetSessionMinutes * 0.75),
        MIN_SESSION_MINUTES,
        dials.targetSessionMinutes,
      ),
    };
  }
  if (trend === 'improving') {
    return {
      targetSessionMinutes: clamp(
        Math.round(dials.targetSessionMinutes * 1.1),
        dials.targetSessionMinutes,
        MAX_SESSION_MINUTES,
      ),
    };
  }
  return dials;
}

interface ObservationInput {
  metrics: AdaptiveMetrics;
  band: AdaptiveBand;
  trend: AdaptiveTrend;
  trendDetail: Omit<TrendRead, 'trend'>;
  transition: AdaptiveTransition | null;
  prior: WindowStats;
  finished: SessionObservation[];
  timeZone: string;
}

const BAND_WORD: Record<AdaptiveBand, string> = {
  unknown: 'unreadable',
  struggling: 'struggling',
  steady: 'steady',
  thriving: 'on top of it',
};

/** What the system noticed. Ordered by what the learner most needs to hear. */
function describeObservations(input: ObservationInput): AdaptiveObservation[] {
  const { metrics, band, trend, trendDetail, transition, prior, finished, timeZone } = input;

  const trendObservation: AdaptiveObservation | null =
    trend === 'declining'
      ? {
          id: 'trend-declining',
          // Named plainly. Softening this into "a slightly quieter week" would
          // leave the learner unsure whether anything was actually said.
          statement: 'Your last three sessions went worse than the ones before them.',
          evidence: `Recent session quality ${pct(trendDetail.recentQuality)} against ${pct(trendDetail.baselineQuality)} before — shorter sessions, more of them dropped, or both.`,
          tone: 'concern',
        }
      : trend === 'improving'
        ? {
            id: 'trend-improving',
            statement: 'Your last three sessions were better than the ones before them.',
            evidence: `Recent session quality ${pct(trendDetail.recentQuality)} against ${pct(trendDetail.baselineQuality)} before.`,
            tone: 'positive',
          }
        : null;

  const transitionObservation: AdaptiveObservation | null = transition
    ? {
        id: 'transition',
        statement:
          transition.direction === 'up'
            ? `Two weeks ago you were ${BAND_WORD[transition.from]}. You're ${BAND_WORD[transition.to]} now.`
            : `You were ${BAND_WORD[transition.from]} two weeks ago. You're ${BAND_WORD[transition.to]} now.`,
        evidence: `Then: ${plural(prior.studiedDays.size, 'study day')}, ${pct(prior.completionRate)} finished. Now: ${plural(metrics.daysStudiedInWindow, 'study day')}, ${pct(metrics.sessionCompletionRate)} finished.`,
        tone: transition.direction === 'up' ? 'positive' : 'concern',
      }
    : null;

  const bandObservation: AdaptiveObservation =
    band === 'struggling'
      ? {
          id: 'consistency-low',
          statement: 'You are starting more sessions than you finish.',
          evidence: `You studied on ${metrics.daysStudiedInWindow} of the last ${metrics.windowDays} days and finished ${pct(metrics.sessionCompletionRate)} of what you started.`,
          tone: 'concern',
        }
      : band === 'thriving'
        ? {
            id: 'consistency-high',
            statement: "You're showing up and finishing what you start.",
            evidence: `${metrics.daysStudiedInWindow} study days in the last ${metrics.windowDays}, ${pct(metrics.sessionCompletionRate)} of sessions finished.`,
            tone: 'positive',
          }
        : {
            id: 'consistency-steady',
            statement: "You're steady — not slipping, not stretching.",
            evidence: `${metrics.daysStudiedInWindow} study days in the last ${metrics.windowDays}, averaging ${metrics.sessionDurationAvgMinutes} minutes a session.`,
            tone: 'neutral',
          };

  const observations: AdaptiveObservation[] = [];

  // A learner falling apart hears that first. Otherwise continuity leads,
  // because "I remember where you were" is the line that earns the rest.
  if (trend === 'declining' && trendObservation) observations.push(trendObservation);
  if (transitionObservation) observations.push(transitionObservation);
  observations.push(bandObservation);
  if (trend === 'improving' && trendObservation) observations.push(trendObservation);

  // Time-of-day. The one observation here that a learner could not have worked
  // out themselves, which is exactly why it is worth computing.
  const late = finished.filter((s) => localHour(s.startedAt, timeZone) >= LATE_HOUR);
  const early = finished.filter((s) => localHour(s.startedAt, timeZone) < LATE_HOUR);
  if (late.length >= MIN_LATE_SESSIONS && early.length >= MIN_LATE_SESSIONS) {
    const rate = (rows: SessionObservation[]) =>
      rows.filter((s) => s.status === 'completed').length / rows.length;
    const lateRate = rate(late);
    const earlyRate = rate(early);

    if (earlyRate - lateRate >= LATE_COMPLETION_GAP) {
      observations.push({
        id: 'late-night-drop-off',
        statement: 'Late sessions go worse for you than earlier ones.',
        evidence: `After ${LATE_HOUR}:00 you finish ${pct(lateRate)} of sessions, against ${pct(earlyRate)} earlier in the day.`,
        tone: 'concern',
      });
    }
  }

  if (metrics.currentStreakDays >= 3) {
    observations.push({
      id: 'streak',
      statement: `You're on a ${metrics.currentStreakDays}-day run.`,
      evidence: 'Counted from your last completed session backwards.',
      tone: 'positive',
    });
  }

  return observations;
}

/**
 * What the system did about it.
 *
 * **Every string here must correspond to something the product actually does.**
 * The one enforced change is the session-time budget, which
 * `dashboard/page.tsx` passes into the planner as the window the Next Action is
 * ranked and fitted against. So there is exactly one decision, and it is about
 * that number.
 *
 * The direction word is chosen by comparing against the pre-trend baseline
 * rather than assumed, because "cut to 10 minutes" is false when the baseline
 * was already at the ten-minute floor — the same class of untrue claim, one
 * level down.
 */
function describeDecisions(
  band: AdaptiveBand,
  trend: AdaptiveTrend,
  dials: TunedDials,
  baseline: TunedDials,
  observations: AdaptiveObservation[],
): AdaptiveDecision[] {
  const primary = observations[0]?.statement ?? '';
  const m = dials.targetSessionMinutes;
  const moved = m !== baseline.targetSessionMinutes;

  if (trend === 'declining') {
    return [
      {
        id: 'trend-shorten',
        change: moved
          ? `Cut tonight's session to ${m} minutes.`
          : `Held tonight's session at ${m} minutes — already as short as I go.`,
        because:
          'Something changed in the last week. A short session you finish is worth more right now than a full one you walk away from.',
      },
    ];
  }

  if (trend === 'improving') {
    return [
      {
        id: 'trend-stretch',
        change: moved
          ? `Stretched sessions to ${m} minutes.`
          : `Held sessions at ${m} minutes — already as long as I go.`,
        because: 'You are finishing more than you were. That is room, so I am using it.',
      },
    ];
  }

  if (band === 'struggling') {
    return [
      {
        id: 'shorten',
        change: `Sized your sessions at ${m} minutes.`,
        because: `${primary} A session you finish is worth more than one you walk away from.`,
      },
    ];
  }

  if (band === 'thriving') {
    return [
      {
        id: 'lengthen',
        change: `Sized your sessions at ${m} minutes.`,
        because: `${primary} You have room, so I am using it.`,
      },
    ];
  }

  return [
    {
      id: 'hold',
      change: `Held your sessions at about ${m} minutes.`,
      because: `${primary} Changing a plan that is working costs more than it gains.`,
    },
  ];
}

// ---------------------------------------------------------------------------
// The behavioural layer: what to say so the learner actually starts.
// ---------------------------------------------------------------------------

/**
 * Recovery outranks momentum.
 *
 * A learner who has been thriving for a fortnight and dropped their last two
 * sessions is in trouble *now*, and greeting them with their streak would be
 * reading the wrong clock. The bad news is the actionable one.
 */
function stanceFor(
  band: AdaptiveBand,
  trend: AdaptiveTrend,
  metrics: AdaptiveMetrics,
): AdaptiveStance {
  if (band === 'unknown') return 'onboarding';
  if (trend === 'declining' || band === 'struggling' || metrics.recentDrops >= 2) return 'recovery';
  if (trend === 'improving' || band === 'thriving' || metrics.currentStreakDays >= 3) {
    return 'momentum';
  }
  return 'commitment';
}

export interface DirectiveInput {
  taskTitle: string;
  /** The task's own estimate. The commitment is capped by it. */
  estimatedMinutes: number;
}

export interface Directive {
  /** The whole line. One frame sentence, then the instruction. Never more. */
  text: string;
  /** Minutes the learner is being asked to commit to, which may be less than the task. */
  committedMinutes: number;
  stance: AdaptiveStance;
}

/**
 * The one line that turns a recommendation into something a learner does.
 *
 * Two sentences, always in this order: what is true about them, then what to do.
 * The instruction is last because it is the thing they act on, and anything
 * after it is something to read before acting.
 *
 * The commitment is to **time, not completion**. "Stay with it for 10 minutes"
 * is a promise a struggling learner can keep; "finish this 50-minute task" is
 * the promise they have been breaking, and asking for it again is how a plan
 * becomes something to avoid. It also resolves the contradiction between a
 * shortened session target and a task that is longer than it — the learner
 * commits to the target and the task simply takes as long as it takes.
 */
export function renderDirective(profile: AdaptiveProfile, input: DirectiveInput): Directive {
  const committedMinutes = Math.max(
    MIN_SESSION_MINUTES,
    Math.min(profile.targetSessionMinutes, input.estimatedMinutes),
  );
  const task = input.taskTitle;
  const m = committedMinutes;
  const { stance, metrics, trend } = profile;

  let text: string;

  if (stance === 'recovery') {
    // Normalise, then redirect. No sympathy, no explanation of why it happened,
    // no invitation to reflect — all three invite the learner to sit in it.
    const lead =
      metrics.recentDrops >= 2
        ? `You dropped the last ${metrics.recentDrops} sessions.`
        : trend === 'declining'
          ? 'This week went worse than last.'
          : `You finish ${pct(metrics.sessionCompletionRate)} of what you start.`;
    text = `${lead} Reset with ${m} minutes on ${task} now.`;
  } else if (stance === 'momentum') {
    const lead =
      metrics.currentStreakDays >= 3
        ? `${metrics.currentStreakDays} days straight.`
        : trend === 'improving'
          ? 'Your last three sessions beat the ones before.'
          : 'You finish what you start.';
    text = `${lead} Keep it going with ${m} minutes on ${task} now.`;
  } else if (stance === 'commitment') {
    text = `Do ${task} now. Stay with it for ${m} minutes.`;
  } else {
    // Onboarding: nothing is known, so nothing is claimed. Just the ask.
    text = `Start with ${task}. Stay with it for ${m} minutes.`;
  }

  return { text, committedMinutes, stance };
}

export interface CompletionInput {
  /** What the session actually recorded, server-clamped. */
  activeMinutes: number;
  /** What the task was estimated at. */
  estimatedMinutes: number;
}

/**
 * What to say the moment a session ends.
 *
 * Reinforces the **behaviour**, not the result. "Your mastery went up 9%" is an
 * outcome the learner did not directly control and cannot repeat on purpose;
 * "you stayed with it" is the thing they did, and it is the thing that needs to
 * happen again tomorrow. Praising outcomes teaches learners to chase sessions
 * that produce good numbers, which is how you get people re-studying what they
 * already know.
 *
 * Stopping short is stated without softening and without reproach — a fact and
 * a target, then nothing.
 */
export function reinforceCompletion(input: CompletionInput): string {
  if (input.activeMinutes >= input.estimatedMinutes) {
    return 'You stayed with it and finished. That is the pattern.';
  }
  if (input.activeMinutes >= Math.round(input.estimatedMinutes * 0.5)) {
    return `You stayed with it for ${input.activeMinutes} of ${input.estimatedMinutes} minutes. That is most of it — hold the full ${input.estimatedMinutes} next time.`;
  }
  return `You logged ${input.activeMinutes} minutes. Short counts. Come back tomorrow and do it again.`;
}
