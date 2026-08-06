'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiClientError } from '@friday/contracts';
import { Button, Field, Input, Select, Spinner, toast } from '@friday/ui';
import { api } from '@/lib/api/client';

/** A short list covering the launch segment, plus whatever the browser reports. */
function timezoneOptions(current: string): string[] {
  const common = [
    'Asia/Kolkata',
    'Asia/Dubai',
    'Asia/Singapore',
    'Europe/London',
    'Europe/Berlin',
    'America/New_York',
    'America/Los_Angeles',
    'Australia/Sydney',
    'UTC',
  ];
  let detected = '';
  try {
    detected = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    detected = '';
  }
  return [...new Set([current, detected, ...common].filter(Boolean))];
}

export function ProfileForm({
  displayName,
  timezone,
  locale,
  email,
}: {
  displayName: string;
  timezone: string;
  locale: string;
  email: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(displayName);
  const [tz, setTz] = useState(timezone);
  const [lang, setLang] = useState(locale);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = name !== displayName || tz !== timezone || lang !== locale;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.call('updateMe', { body: { displayName: name, timezone: tz, locale: lang } });
      toast.success('Profile updated.');
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Field label="Email" htmlFor="email" hint="Contact support to change your email address.">
        <Input id="email" value={email} disabled readOnly />
      </Field>

      <Field label="Display name" htmlFor="displayName" error={error ?? undefined}>
        <Input
          id="displayName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Timezone"
          htmlFor="timezone"
          hint="Changes when your plan is shown, never what it contains."
        >
          <Select id="timezone" value={tz} onChange={(e) => setTz(e.target.value)}>
            {timezoneOptions(timezone).map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Language" htmlFor="locale">
          <Select id="locale" value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="en">English</option>
            <option value="en-IN">English (India)</option>
          </Select>
        </Field>
      </div>

      <Button onClick={save} disabled={!dirty || saving || name.trim().length === 0}>
        {saving ? <Spinner label="Saving…" /> : 'Save profile'}
      </Button>
    </div>
  );
}
