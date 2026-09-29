import { NextResponse } from 'next/server';
import { getDb, goals, users } from '@friday/db';
import { eq } from 'drizzle-orm';
import { replanQuietly } from '@/modules/planning/planning.service';

export const runtime = 'nodejs';

/**
 * Nightly cron replan — Phase 4 requirement.
 * Iterates through all users with an active goal and replans them for the new day.
 */
export async function POST(req: Request) {
  // In a real production system, this would require a cron secret or
  // Google Cloud Scheduler OIDC token verification.
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET ?? 'cron-secret-dev'}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getDb();
    
    // Join goals and users to get both for replanQuietly
    const activeGoals = await db
      .select({ goalId: goals.id, user: users })
      .from(goals)
      .innerJoin(users, eq(users.id, goals.userId))
      .where(eq(goals.status, 'active'));

    let successCount = 0;
    let failureCount = 0;

    for (const { goalId, user } of activeGoals) {
      try {
        await replanQuietly(user, goalId, 'new_day', 'temporal');
        successCount++;
      } catch (err) {
        console.error(`Cron replan failed for goal ${goalId}:`, err);
        failureCount++;
      }
    }

    return NextResponse.json({
      status: 'ok',
      usersProcessed: successCount + failureCount,
      successCount,
      failureCount,
    });
  } catch (err) {
    console.error('Cron replan fatal error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
