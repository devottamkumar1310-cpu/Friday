import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Brain } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from '@friday/ui';
import { requireOnboardedUser } from '@/lib/auth/server';
import { listGoals } from '@/modules/curriculum/curriculum.service';
import {
  listDueReviews,
  listFacts,
  listMastery,
  toWireFact,
} from '@/modules/memory/memory.service';
import { FactList } from '@/components/memory/fact-list';

export const metadata: Metadata = { title: 'Memory' };

export default async function MemoryPage() {
  const user = await requireOnboardedUser();
  const goals = await listGoals(user);
  const goal = goals.find((g) => g.status === 'active') ?? goals[0];
  if (!goal) redirect('/onboarding/availability?next=goal');

  const [facts, mastery, due] = await Promise.all([
    listFacts(user),
    listMastery(user, goal.id, 100),
    listDueReviews(user, goal.id),
  ]);

  const studied = mastery.filter((m) => m.evidenceCount > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Memory</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What FRIDAY knows about your knowledge, and what it believes about you.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What FRIDAY believes about you</CardTitle>
          <CardDescription>
            Every belief carries the evidence behind it. Correct anything that is wrong — deletion
            is immediate and permanent.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FactList facts={facts.map(toWireFact)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Due for review</CardTitle>
          <CardDescription>
            Scheduled by FSRS from how well you recalled each concept — not by a fixed interval.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {due.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing is due yet.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {due.slice(0, 15).map((item) => (
                <li key={item.conceptId} className="flex items-center justify-between gap-3 py-2">
                  <span className="truncate">{item.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {item.dueAt.slice(0, 10)} · recall {Math.round(item.retrievability * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Mastery</CardTitle>
          <CardDescription>
            {studied.length} of {mastery.length} concepts have evidence behind them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {studied.length === 0 ? (
            <EmptyState
              icon={<Brain className="size-8" />}
              title="Nothing measured yet"
              description="Complete a study session or a practice set and your mastery appears here."
            />
          ) : (
            <ul className="divide-y divide-border text-sm">
              {studied.map((item) => (
                <li key={item.conceptId} className="flex items-center justify-between gap-3 py-2">
                  <span className="truncate">{item.title}</span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {Math.round(item.mastery * 100)}% · {item.evidenceCount} obs
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
