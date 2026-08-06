import type { Metadata } from 'next';
import { Target } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState } from '@friday/ui';
import { requireOnboardedUser } from '@/lib/auth/server';
import { getMePayload } from '@/modules/identity/identity.service';

export const metadata: Metadata = { title: 'Mission Control' };

/**
 * Mission Control — Phase 0 shell.
 *
 * The Next Action card, today's plan, and the goal countdown arrive with the
 * decision engine in Phase 1 (roadmap 1.14). What exists here is the frame and
 * the guarantee that reaching it means the learner is authenticated and past
 * the FR-1.6 gate.
 */
export default async function DashboardPage() {
  const user = await requireOnboardedUser();
  const { onboarding } = await getMePayload(user);

  const firstName = user.displayName.split(' ')[0] ?? user.displayName;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Good to see you, {firstName}.</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your account is set up. The next step is telling FRIDAY what you are working towards.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Next action</CardTitle>
          <CardDescription>
            Once you have a goal, this is where FRIDAY tells you the single highest-impact thing to
            do right now — and why.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EmptyState
            icon={<Target className="size-8" />}
            title="No goal yet"
            description="Goal setup, curriculum generation, and the planner arrive in the next phase of the build."
          />
        </CardContent>
      </Card>

      <p className="text-xs text-subtle-foreground">
        Onboarding step: <span className="font-mono">{onboarding.step}</span>
      </p>
    </div>
  );
}
