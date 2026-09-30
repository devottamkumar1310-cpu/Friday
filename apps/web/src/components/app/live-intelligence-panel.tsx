'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Target } from 'lucide-react';
import type { AdaptiveProfile } from '@friday/core';
import { MissionCard, MissionComplete } from '@/components/friday/mission-card';
import type { MissionAction } from '@/components/friday/mission-card';
import { AdaptationCard, IntelligenceBlock } from '@/components/friday/intelligence';
import type { WhyThisProps } from '@/components/progress/why-this';

export interface PanelRisk {
  id: string;
  severity: 'low' | 'medium' | 'high';
  title: string;
  detail: string;
}

export interface PanelAction {
  taskId: string;
  title: string;
  estimatedMinutes: number;
  rationale: string;
  why: WhyThisProps | null;
}

export interface LiveIntelligencePanelProps {
  firstName: string;
  goalTitle: string;
  daysRemaining: number;
  profile: AdaptiveProfile;
  risks: PanelRisk[];
  action: PanelAction | null;
  planChange: { statement: string; evidence: string } | null;
  todayTasks: { id: string; title: string; estimatedMinutes: number }[];
}

function useGreeting(): string {
  const [greeting, setGreeting] = useState('Welcome back');
  useEffect(() => {
    const hour = new Date().getHours();
    setGreeting(hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening');
  }, []);
  return greeting;
}

export function LiveIntelligencePanel({
  firstName,
  goalTitle,
  daysRemaining,
  profile,
  risks,
  action,
  planChange,
  todayTasks,
}: LiveIntelligencePanelProps) {
  const greeting = useGreeting();

  const observations = [
    ...profile.observations.map((o) => ({
      key: o.id,
      statement: o.statement,
      evidence: o.evidence,
      alarming: o.tone === 'concern',
    })),
    ...risks.map((r) => ({
      key: r.id,
      statement: r.title,
      evidence: r.detail,
      alarming: r.severity === 'high',
    })),
  ];

  const missionAction: MissionAction | null = action
    ? {
        taskId: action.taskId,
        title: action.title,
        estimatedMinutes: action.estimatedMinutes,
        rationale: action.rationale,
        why: action.why,
      }
    : null;

  return (
    <div className="space-y-10">
      {/* Page header — the reason this screen exists. */}
      <header className="animate-enter space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {greeting}, {firstName}.
        </h1>
        <p className="text-sm text-muted-foreground">Your next move is ready.</p>
        <p className="flex items-center gap-2 text-xs font-medium text-subtle-foreground">
          <Target className="size-3.5" aria-hidden />
          {goalTitle}
          <span aria-hidden>·</span>
          {daysRemaining} {daysRemaining === 1 ? 'day' : 'days'} left
        </p>
      </header>

      {/* The one thing to do. */}
      {missionAction ? <MissionCard action={missionAction} /> : <MissionComplete />}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Today's plan — the rest of the day after the mission. */}
        <section aria-label="Today's plan" className="animate-enter space-y-3" style={{ ['--enter-delay' as string]: '60ms' }}>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Today&apos;s plan
          </h2>
          <div className="overflow-hidden rounded-xl border border-border bg-surface">
            {todayTasks && todayTasks.length > 0 ? (
              <ul className="divide-y divide-border">
                {todayTasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">
                      {t.title}
                    </span>
                    <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs tabular-nums text-muted-foreground">
                      {t.estimatedMinutes} min
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">
                Nothing else scheduled today. Enjoy the clear day — FRIDAY will plan tomorrow.
              </p>
            )}
          </div>
          <p className="text-right">
            <Link
              href="/plan"
              className="text-xs font-medium text-primary hover:underline"
            >
              See your full schedule
            </Link>
          </p>
        </section>

        {/* What FRIDAY noticed + what it changed. */}
        <section aria-label="Friday intelligence" className="animate-enter space-y-3" style={{ ['--enter-delay' as string]: '120ms' }}>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Friday noticed
          </h2>
          <div className="space-y-3">
            {planChange && (
              <AdaptationCard statement={planChange.statement} reason={planChange.evidence} />
            )}
            {observations.slice(0, 3).map((obs) => (
              <IntelligenceBlock
                key={obs.key}
                statement={obs.statement}
                evidence={obs.evidence}
                alarming={obs.alarming}
              />
            ))}
            {observations.length === 0 && !planChange && (
              <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
                <p className="text-sm font-medium text-foreground">Nothing to report yet.</p>
                <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
                  Complete study sessions and FRIDAY will start noticing how you learn.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
