'use client';

import { useEffect, useRef, useState } from 'react';
import { Send, Sparkles, Wrench } from 'lucide-react';
import { API_PREFIX } from '@friday/contracts';
import { Badge, Button, Callout, Spinner, Textarea } from '@friday/ui';

/**
 * Coach conversation — API_SPECIFICATION §5.10.
 *
 * Consumes the SSE stream by hand rather than with `EventSource`, because
 * `EventSource` cannot issue a POST and this endpoint takes a message body.
 * The parser below is the minimum that correctly handles the wire format:
 * events are separated by a blank line, and a chunk boundary can land in the
 * middle of one — so the buffer is only drained up to the last complete event.
 */

export interface CoachMessageView {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  createdAt: string;
}

interface ToolActivity {
  name: string;
  summary?: string;
}

export function CoachChat({
  threadId,
  initialMessages,
}: {
  threadId: string;
  initialMessages: CoachMessageView[];
}) {
  const [messages, setMessages] = useState<CoachMessageView[]>(initialMessages);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamedText, setStreamedText] = useState('');
  const [tools, setTools] = useState<ToolActivity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, streamedText, tools]);

  async function send() {
    const content = input.trim();
    if (!content || streaming) return;

    setInput('');
    setError(null);
    setTools([]);
    setStreamedText('');
    setStreaming(true);
    setMessages((prev) => [
      ...prev,
      { id: `local-${Date.now()}`, role: 'user', content, createdAt: new Date().toISOString() },
    ]);

    try {
      const response = await fetch(`${API_PREFIX}/coach/threads/${threadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        credentials: 'include',
        body: JSON.stringify({ content }),
      });

      // A pre-flight failure (unconfigured provider, missing thread) arrives as
      // a normal JSON error before the stream opens.
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        setError(payload?.error?.message ?? 'The coach is unavailable right now.');
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        setError('Streaming is not supported in this browser.');
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let assembled = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Only consume complete events; keep any partial tail in the buffer.
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const raw of parts) {
          const eventLine = raw.split('\n').find((l) => l.startsWith('event: '));
          const dataLine = raw.split('\n').find((l) => l.startsWith('data: '));
          if (!eventLine || !dataLine) continue;

          const name = eventLine.slice(7).trim();
          let data: Record<string, unknown> = {};
          try {
            data = JSON.parse(dataLine.slice(6)) as Record<string, unknown>;
          } catch {
            continue;
          }

          if (name === 'delta') {
            assembled += String(data['text'] ?? '');
            setStreamedText(assembled);
          } else if (name === 'tool_call') {
            setTools((prev) => [...prev, { name: String(data['name']) }]);
          } else if (name === 'tool_result') {
            setTools((prev) =>
              prev.map((t) =>
                t.name === data['name'] && !t.summary
                  ? { ...t, summary: String(data['summary']) }
                  : t,
              ),
            );
          } else if (name === 'error') {
            setError(String(data['message'] ?? 'Something went wrong.'));
          }
        }
      }

      if (assembled) {
        setMessages((prev) => [
          ...prev,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            content: assembled,
            createdAt: new Date().toISOString(),
          },
        ]);
      }
    } catch {
      setError('Lost connection to the coach.');
    } finally {
      setStreaming(false);
      setStreamedText('');
    }
  }

  return (
    <div className="flex min-h-[60vh] flex-col gap-4">
      <div className="flex-1 space-y-4" role="log" aria-live="polite" aria-label="Conversation">
        {messages.length === 0 && !streaming && (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <Sparkles className="mx-auto size-6 text-ai-accent" aria-hidden />
            <p className="mt-2 font-medium">Ask about your studying</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              The coach can see your plan, your mastery, and what is due. It reports what the engine
              decided — it does not invent numbers.
            </p>
          </div>
        )}

        {messages.map((message) => (
          <Message key={message.id} role={message.role} content={message.content} />
        ))}

        {tools.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {tools.map((tool, i) => (
              <Badge key={`${tool.name}-${i}`} variant="neutral">
                <Wrench className="size-3" aria-hidden />
                {tool.name}
                {tool.summary ? ` · ${tool.summary}` : '…'}
              </Badge>
            ))}
          </div>
        )}

        {streamedText && <Message role="assistant" content={streamedText} streaming />}
        {streaming && !streamedText && tools.length === 0 && (
          <div className="text-sm text-muted-foreground">
            <Spinner label="Thinking…" />
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {error && (
        <Callout tone="warning" title="Coach unavailable">
          {error} Your plan, next action, and sessions are unaffected.
        </Callout>
      )}

      <form
        className="flex items-end gap-2 border-t border-border pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className="flex-1">
          <label htmlFor="coach-input" className="sr-only">
            Message the coach
          </label>
          <Textarea
            id="coach-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter is a newline — the convention for chat.
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="What should I focus on this week?"
            rows={2}
            maxLength={4000}
            disabled={streaming}
          />
        </div>
        <Button type="submit" disabled={streaming || !input.trim()} aria-label="Send message">
          <Send className="size-4" aria-hidden />
        </Button>
      </form>
    </div>
  );
}

function Message({
  role,
  content,
  streaming,
}: {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  streaming?: boolean;
}) {
  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-primary px-3.5 py-2.5 text-sm text-primary-foreground">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      {/* NFR-6.3: model-generated content is visually marked as such. */}
      <div className="max-w-[85%] space-y-1.5">
        <Badge variant="ai">Coach</Badge>
        <div className="whitespace-pre-wrap rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm">
          {content}
          {streaming ? <span className="ml-0.5 animate-pulse">▍</span> : null}
        </div>
      </div>
    </div>
  );
}
