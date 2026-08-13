'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { ApiClientError } from '@friday/contracts';
import { Button, Callout, Select, Spinner } from '@friday/ui';
import { api } from '@/lib/api/client';

/**
 * Weekly availability.
 *
 * This is the input the scheduler cannot run without (E-6), and capacity is the
 * most consequential thing a learner tells FRIDAY — every feasibility verdict is
 * measured against it.
 *
 * It was also the single worst screen in the product. On a phone it rendered
 * eighteen native selects across six identical rows, roughly 1,400px tall, with
 * the only button below all of it — and the defaults were already right, so the
 * overwhelmingly common action was "scroll past everything and accept". All of
 * the friction, none of the value, at the exact moment a new learner decides
 * whether this is worth their evening.
 *
 * So the shape is inverted. The common answer is now three taps' worth of
 * choice presented as whole weeks, the editor is behind a disclosure for the
 * minority who want it, and the total plus the button are pinned where a thumb
 * already is. Nothing about the payload changed.
 */

const DAYS = [
  { value: 1, label: 'Monday', short: 'Mon' },
  { value: 2, label: 'Tuesday', short: 'Tue' },
  { value: 3, label: 'Wednesday', short: 'Wed' },
  { value: 4, label: 'Thursday', short: 'Thu' },
  { value: 5, label: 'Friday', short: 'Fri' },
  { value: 6, label: 'Saturday', short: 'Sat' },
  { value: 0, label: 'Sunday', short: 'Sun' },
];

const TIMES = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, '0');
  const m = i % 2 === 0 ? '00' : '30';
  return `${h}:${m}`;
});

/** "18:30" → "6:30 PM". The value stays 24-hour; only the label changes. */
function clockLabel(time: string): string {
  const [rawHour, minute] = time.split(':');
  const hour = Number(rawHour);
  const suffix = hour < 12 ? 'AM' : 'PM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${minute} ${suffix}`;
}

export interface AvailabilityRuleInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

const weekdays = [1, 2, 3, 4, 5];

/**
 * Whole weeks, not slots.
 *
 * A student knows instantly whether they are "evenings after school"; they do
 * not know, and should not have to compute, that this means five rows of
 * 18:00–20:30.
 */
const PRESETS: { id: string; label: string; detail: string; rules: AvailabilityRuleInput[] }[] = [
  {
    id: 'evenings',
    label: 'Evenings after school',
    detail: 'Mon–Fri 6–8:30pm, Sat morning',
    rules: [
      ...weekdays.map((d) => ({ dayOfWeek: d, startTime: '18:00', endTime: '20:30' })),
      { dayOfWeek: 6, startTime: '09:00', endTime: '12:00' },
    ],
  },
  {
    id: 'mornings',
    label: 'Early mornings',
    detail: 'Mon–Sat 5:30–8am',
    rules: [...weekdays, 6].map((d) => ({ dayOfWeek: d, startTime: '05:30', endTime: '08:00' })),
  },
  {
    id: 'weekends',
    label: 'Mostly weekends',
    detail: 'Sat & Sun 9am–1pm, plus two evenings',
    rules: [
      { dayOfWeek: 6, startTime: '09:00', endTime: '13:00' },
      { dayOfWeek: 0, startTime: '09:00', endTime: '13:00' },
      { dayOfWeek: 2, startTime: '19:00', endTime: '21:00' },
      { dayOfWeek: 4, startTime: '19:00', endTime: '21:00' },
    ],
  },
];

function minutesOf(rule: AvailabilityRuleInput): number {
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  return Math.max(0, toMin(rule.endTime) - toMin(rule.startTime));
}

function sameRules(a: AvailabilityRuleInput[], b: AvailabilityRuleInput[]): boolean {
  if (a.length !== b.length) return false;
  const key = (r: AvailabilityRuleInput) => `${r.dayOfWeek}-${r.startTime}-${r.endTime}`;
  const left = a.map(key).sort();
  const right = b.map(key).sort();
  return left.every((v, i) => v === right[i]);
}

export function AvailabilityForm({
  initialRules,
  nextStep,
}: {
  initialRules: AvailabilityRuleInput[];
  nextStep: 'goal' | 'settings';
}) {
  const router = useRouter();
  const [rules, setRules] = useState<AvailabilityRuleInput[]>(
    initialRules.length > 0 ? initialRules : PRESETS[0]!.rules,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Open only for someone whose week is genuinely their own — otherwise the
  // editor is noise in front of an answer they already agree with.
  const [detailOpen, setDetailOpen] = useState(
    initialRules.length > 0 && !PRESETS.some((p) => sameRules(p.rules, initialRules)),
  );

  const weeklyMinutes = useMemo(() => rules.reduce((sum, r) => sum + minutesOf(r), 0), [rules]);

  const overlaps = useMemo(() => {
    const bad = new Set<number>();
    rules.forEach((a, i) => {
      rules.forEach((b, j) => {
        if (i >= j || a.dayOfWeek !== b.dayOfWeek) return;
        if (a.startTime < b.endTime && b.startTime < a.endTime) {
          bad.add(i);
          bad.add(j);
        }
      });
    });
    return bad;
  }, [rules]);

  const invalidRows = useMemo(
    () => new Set(rules.map((r, i) => (r.endTime <= r.startTime ? i : -1)).filter((i) => i >= 0)),
    [rules],
  );

  const canSave = rules.length > 0 && overlaps.size === 0 && invalidRows.size === 0;
  const activePreset = PRESETS.find((p) => sameRules(p.rules, rules))?.id ?? null;

  function update(index: number, patch: Partial<AvailabilityRuleInput>) {
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.call('setAvailability', {
        body: { rules: rules.map((r) => ({ ...r, kind: 'available' as const })) },
      });
      router.push(nextStep === 'goal' ? '/onboarding/goal' : '/settings');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not save. Check your connection.');
    } finally {
      setSaving(false);
    }
  }

  const hours = Math.floor(weeklyMinutes / 60);
  const minutes = weeklyMinutes % 60;

  return (
    // Bottom padding clears the pinned footer so the last control is reachable.
    <div className="space-y-6 pb-28">
      {error && (
        <Callout tone="danger" title="Could not save your availability">
          {error}
        </Callout>
      )}

      <div className="space-y-3">
        {PRESETS.map((preset) => {
          const active = activePreset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              aria-pressed={active}
              onClick={() => setRules(preset.rules)}
              className={[
                'flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                active
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-border-strong active:bg-muted',
              ].join(' ')}
            >
              <span
                className={[
                  'flex size-6 shrink-0 items-center justify-center rounded-full border',
                  active ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                ].join(' ')}
                aria-hidden
              >
                {active ? <Check className="size-4" /> : null}
              </span>
              <span className="min-w-0">
                <span className="block font-medium">{preset.label}</span>
                <span className="block text-sm text-muted-foreground">{preset.detail}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setDetailOpen((v) => !v)}
          aria-expanded={detailOpen}
          aria-controls="availability-detail"
          className="flex min-h-11 w-full items-center justify-between rounded-lg px-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {detailOpen ? 'Hide exact times' : 'Set my own times'}
          <ChevronDown
            className={`size-4 transition-transform motion-reduce:transition-none ${detailOpen ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </button>

        {detailOpen && (
          <div id="availability-detail" className="mt-3 space-y-3">
            <ul className="space-y-3">
              {rules.map((rule, index) => {
                const problem = overlaps.has(index) || invalidRows.has(index);
                return (
                  <li
                    key={index}
                    className={
                      problem
                        ? 'rounded-lg border border-destructive/40 bg-destructive/5 p-3'
                        : 'rounded-lg border border-border p-3'
                    }
                  >
                    {/* Stacked, not wrapped: a three-field row at 390px broke
                        across lines and split "From" away from "To". */}
                    <div className="space-y-2">
                      <div className="flex items-end gap-2">
                        <div className="min-w-0 flex-1">
                          <label
                            htmlFor={`day-${index}`}
                            className="mb-1 block text-xs font-medium text-muted-foreground"
                          >
                            Day
                          </label>
                          <Select
                            id={`day-${index}`}
                            className="h-11"
                            value={rule.dayOfWeek}
                            onChange={(e) => update(index, { dayOfWeek: Number(e.target.value) })}
                          >
                            {DAYS.map((d) => (
                              <option key={d.value} value={d.value}>
                                {d.label}
                              </option>
                            ))}
                          </Select>
                        </div>

                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setRules((prev) => prev.filter((_, i) => i !== index))}
                          className="size-11 shrink-0 p-0"
                          aria-label={`Remove ${DAYS.find((d) => d.value === rule.dayOfWeek)?.label ?? ''} ${clockLabel(rule.startTime)} to ${clockLabel(rule.endTime)}`}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label
                            htmlFor={`start-${index}`}
                            className="mb-1 block text-xs font-medium text-muted-foreground"
                          >
                            From
                          </label>
                          <Select
                            id={`start-${index}`}
                            className="h-11"
                            value={rule.startTime}
                            onChange={(e) => update(index, { startTime: e.target.value })}
                          >
                            {TIMES.map((t) => (
                              <option key={t} value={t}>
                                {clockLabel(t)}
                              </option>
                            ))}
                          </Select>
                        </div>

                        <div>
                          <label
                            htmlFor={`end-${index}`}
                            className="mb-1 block text-xs font-medium text-muted-foreground"
                          >
                            To
                          </label>
                          <Select
                            id={`end-${index}`}
                            className="h-11"
                            value={rule.endTime}
                            invalid={invalidRows.has(index)}
                            onChange={(e) => update(index, { endTime: e.target.value })}
                          >
                            {TIMES.map((t) => (
                              <option key={t} value={t}>
                                {clockLabel(t)}
                              </option>
                            ))}
                          </Select>
                        </div>
                      </div>
                    </div>

                    {invalidRows.has(index) && (
                      <p role="alert" className="mt-2 text-xs text-destructive">
                        The end time has to be after the start time.
                      </p>
                    )}
                    {overlaps.has(index) && !invalidRows.has(index) && (
                      <p role="alert" className="mt-2 text-xs text-destructive">
                        This overlaps another slot on the same day — FRIDAY would count those hours
                        twice.
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>

            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() =>
                setRules((prev) => [
                  ...prev,
                  { dayOfWeek: 1, startTime: '18:00', endTime: '20:00' },
                ])
              }
            >
              <Plus className="size-4" aria-hidden />
              Add a slot
            </Button>
          </div>
        )}
      </div>

      {rules.length === 0 && (
        <Callout tone="warning" title="You need at least one study slot">
          FRIDAY cannot build a plan without knowing when you are free. It will not invent hours you
          did not give it.
        </Callout>
      )}

      {/*
        Pinned. The total and the button used to sit below every control, so on
        a phone the reason a disabled button was disabled could be a thousand
        pixels above the button itself.
      */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur supports-[backdrop-filter]:bg-surface/80">
        <div className="mx-auto w-full max-w-2xl px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          {!canSave && rules.length > 0 && (
            <p role="alert" className="mb-2 text-sm text-destructive">
              {invalidRows.size > 0
                ? 'One slot ends before it starts — open “Set my own times” to fix it.'
                : 'Two slots overlap — open “Set my own times” to fix it.'}
            </p>
          )}
          <div className="flex items-center gap-3">
            <p className="text-sm text-muted-foreground" aria-live="polite">
              <span className="text-base font-semibold text-foreground">
                {hours}h{minutes ? ` ${minutes}m` : ''}
              </span>{' '}
              a week
            </p>
            <Button
              type="button"
              size="lg"
              onClick={save}
              disabled={!canSave || saving}
              className="ml-auto min-w-40"
            >
              {saving ? <Spinner label="Saving…" /> : 'Save and continue'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
