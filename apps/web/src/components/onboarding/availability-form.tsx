'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { ApiClientError } from '@friday/contracts';
import { Button, Callout, Select, Spinner } from '@friday/ui';
import { api } from '@/lib/api/client';

/**
 * Weekly availability editor.
 *
 * This is the input the scheduler cannot run without (E-6), so it gets a real
 * editor rather than a number field. Capacity is the single most consequential
 * thing a learner tells FRIDAY: every feasibility verdict is measured against
 * it, and an optimistic answer here produces a plan that quietly fails.
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

export interface AvailabilityRuleInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

const WEEKDAY_EVENINGS: AvailabilityRuleInput[] = [
  ...[1, 2, 3, 4, 5].map((d) => ({ dayOfWeek: d, startTime: '18:00', endTime: '20:30' })),
  { dayOfWeek: 6, startTime: '09:00', endTime: '12:00' },
];

function minutesOf(rule: AvailabilityRuleInput): number {
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  return Math.max(0, toMin(rule.endTime) - toMin(rule.startTime));
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
    initialRules.length > 0 ? initialRules : WEEKDAY_EVENINGS,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="space-y-6">
      {error && (
        <Callout tone="danger" title="Could not save your availability">
          {error}
        </Callout>
      )}

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
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-32 flex-1">
                  <label
                    htmlFor={`day-${index}`}
                    className="mb-1 block text-xs font-medium text-muted-foreground"
                  >
                    Day
                  </label>
                  <Select
                    id={`day-${index}`}
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

                <div className="min-w-24 flex-1">
                  <label
                    htmlFor={`start-${index}`}
                    className="mb-1 block text-xs font-medium text-muted-foreground"
                  >
                    From
                  </label>
                  <Select
                    id={`start-${index}`}
                    value={rule.startTime}
                    onChange={(e) => update(index, { startTime: e.target.value })}
                  >
                    {TIMES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="min-w-24 flex-1">
                  <label
                    htmlFor={`end-${index}`}
                    className="mb-1 block text-xs font-medium text-muted-foreground"
                  >
                    To
                  </label>
                  <Select
                    id={`end-${index}`}
                    value={rule.endTime}
                    invalid={invalidRows.has(index)}
                    onChange={(e) => update(index, { endTime: e.target.value })}
                  >
                    {TIMES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRules((prev) => prev.filter((_, i) => i !== index))}
                  aria-label={`Remove ${DAYS.find((d) => d.value === rule.dayOfWeek)?.label ?? ''} ${rule.startTime} to ${rule.endTime}`}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>

              {invalidRows.has(index) && (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  The end time has to be after the start time.
                </p>
              )}
              {overlaps.has(index) && !invalidRows.has(index) && (
                <p role="alert" className="mt-2 text-xs text-destructive">
                  This overlaps another slot on the same day — FRIDAY would count those hours twice.
                </p>
              )}
            </li>
          );
        })}
      </ul>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() =>
          setRules((prev) => [...prev, { dayOfWeek: 1, startTime: '18:00', endTime: '20:00' }])
        }
      >
        <Plus className="size-4" aria-hidden />
        Add a slot
      </Button>

      {rules.length === 0 && (
        <Callout tone="warning" title="You need at least one study slot">
          FRIDAY cannot build a plan without knowing when you are free. It will not invent hours you
          did not give it.
        </Callout>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          <span className="font-medium text-foreground">
            {Math.floor(weeklyMinutes / 60)}h {weeklyMinutes % 60}m
          </span>{' '}
          a week
        </p>
        <Button type="button" onClick={save} disabled={!canSave || saving}>
          {saving ? <Spinner label="Saving…" /> : 'Save and continue'}
        </Button>
      </div>
    </div>
  );
}
