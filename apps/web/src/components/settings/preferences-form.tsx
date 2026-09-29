'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError } from '@friday/contracts';
import { Button, Field, Select, Spinner, toast } from '@friday/ui';
import { api } from '@/lib/api/client';
import { applyTheme } from '@/components/app/theme-toggle';

const HOURS = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);

export function PreferencesForm({
  quietHoursStart,
  quietHoursEnd,
  maxDirectivesPerDay,
  theme,
}: {
  quietHoursStart: string;
  quietHoursEnd: string;
  maxDirectivesPerDay: number;
  theme: 'light' | 'dark' | 'system';
}) {
  const router = useRouter();
  const [start, setStart] = useState(quietHoursStart);
  const [end, setEnd] = useState(quietHoursEnd);
  const [cap, setCap] = useState(maxDirectivesPerDay);
  const [mode, setMode] = useState(theme);
  const [saving, setSaving] = useState(false);

  const dirty =
    start !== quietHoursStart ||
    end !== quietHoursEnd ||
    cap !== maxDirectivesPerDay ||
    mode !== theme;

  async function save() {
    setSaving(true);
    try {
      await api.call('updatePreferences', {
        body: {
          quietHoursStart: start,
          quietHoursEnd: end,
          maxDirectivesPerDay: cap,
          theme: mode,
        },
      });
      // Applied here as well as saved. This control used to write `theme` to
      // the database and leave the page exactly as it was.
      applyTheme(mode);
      toast.success('Preferences updated.');
      router.refresh();
    } catch (e) {
      toast.error(e instanceof ApiClientError ? e.message : 'Could not save preferences.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Quiet hours start" htmlFor="quietStart">
          <Select id="quietStart" value={start} onChange={(e) => setStart(e.target.value)}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Quiet hours end" htmlFor="quietEnd">
          <Select id="quietEnd" value={end} onChange={(e) => setEnd(e.target.value)}>
            {HOURS.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label="Most nudges per day"
        htmlFor="maxDirectives"
        hint="A ceiling, not a target. FRIDAY stays well under it when it has nothing useful to say."
      >
        <Select id="maxDirectives" value={cap} onChange={(e) => setCap(Number(e.target.value))}>
          {[0, 1, 2, 3, 5].map((n) => (
            <option key={n} value={n}>
              {n === 0 ? 'None' : n}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Theme" htmlFor="theme">
        <Select
          id="theme"
          value={mode}
          onChange={(e) => setMode(e.target.value as 'light' | 'dark' | 'system')}
        >
          <option value="system">Match my system</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </Select>
      </Field>

      <Button onClick={save} disabled={!dirty || saving}>
        {saving ? <Spinner label="Saving…" /> : 'Save preferences'}
      </Button>
    </div>
  );
}
