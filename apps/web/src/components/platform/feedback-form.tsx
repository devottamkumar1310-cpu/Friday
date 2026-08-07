'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { ApiClientError } from '@friday/contracts';
import { Button, Callout, Select, Spinner, Textarea } from '@friday/ui';
import { api } from '@/lib/api/client';

/**
 * The private beta's feedback channel (CR-007).
 *
 * Lives on Settings rather than as a floating widget on every screen: a
 * persistent button covers content, and the study screen in particular has one
 * thing that must stay visible. Reporting a *bad question* already has its own
 * affordance inside practice, where the context is specific; this is for
 * everything else.
 */

const KINDS = [
  { value: 'bug', label: 'Something is broken' },
  { value: 'confusing', label: 'Something is confusing' },
  { value: 'idea', label: 'I have an idea' },
  { value: 'praise', label: 'Something works well' },
  { value: 'other', label: 'Something else' },
] as const;

export function FeedbackForm() {
  const pathname = usePathname();
  const [kind, setKind] = useState<string>('bug');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.call('submitFeedback', {
        body: { kind: kind as 'bug', message: message.trim(), path: pathname },
      });
      setSent(true);
      setMessage('');
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : 'Could not send that. Try again shortly.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <Callout tone="success" title="Sent — thank you">
        Someone reads every one of these during the beta.{' '}
        <button
          type="button"
          className="underline underline-offset-2"
          onClick={() => setSent(false)}
        >
          Send another
        </button>
      </Callout>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <Callout tone="danger" title="Could not send your feedback">
          {error}
        </Callout>
      )}

      <div className="space-y-1.5">
        <label htmlFor="feedback-kind" className="text-sm font-medium">
          What kind of feedback is this?
        </label>
        <Select id="feedback-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="feedback-message" className="text-sm font-medium">
          Tell us what happened
        </label>
        <Textarea
          id="feedback-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What were you trying to do, and what happened instead?"
          rows={4}
          maxLength={4000}
        />
        <p className="text-xs text-muted-foreground">
          We record which screen you were on. Nothing else is attached.
        </p>
      </div>

      <Button onClick={submit} disabled={busy || message.trim().length < 4}>
        {busy ? <Spinner label="Sending…" /> : 'Send feedback'}
      </Button>
    </div>
  );
}
