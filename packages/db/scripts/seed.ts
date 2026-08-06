/**
 * Deterministic development fixture.
 *
 * Roadmap 0.10 calls the seed the highest-leverage developer-experience
 * investment, because every later phase depends on having realistic data to
 * work against. Phase 0 seeds identity only — goals, curriculum, and session
 * history need tables that roadmap 1.1 introduces, and a seed cannot populate
 * a table that does not exist yet. The extension point is marked below.
 *
 * Idempotent: fixed ids and upserts, so it can be re-run against a dirty
 * database without duplicating rows.
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash } from '@node-rs/argon2';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { canonicalConcepts, curriculumTemplates } from '../src/schema/curriculum';
import { questionConceptKeys, questions } from '../src/schema/assessment';
import { GOLDEN_QUESTIONS } from '../src/seed-data/golden-questions';
import { availabilityRules, consents, userPreferences, users } from '../src/schema/identity';
import {
  JEE_PHYSICS_FOUNDATIONS_SLUG,
  JEE_PHYSICS_FOUNDATIONS_TREE,
  flattenTemplateConcepts,
} from '../src/seed-data/jee-physics-foundations';

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, '../../../.env.local') });
config({ path: resolve(here, '../../../.env') });

const log = (m: string) => {
  // eslint-disable-next-line no-console -- CLI script; stdout is its interface
  console.log(m);
};

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.local first.');
  process.exit(1);
}

/** Fixed ids so seeded data is stable across runs and referenceable in tests. */
const ADULT_ID = '018f0000-0000-7000-8000-000000000001';
const MINOR_ID = '018f0000-0000-7000-8000-000000000002';

const DEV_PASSWORD = 'friday-dev-password';

const pool = new pg.Pool({
  connectionString,
  ...(connectionString.includes('localhost') ? {} : { ssl: { rejectUnauthorized: true } }),
});
const db = drizzle(pool);

try {
  // Argon2id (NFR-3.2). Verification reads cost parameters from the encoded
  // hash, so a fixture created here verifies fine against the identity module.
  const passwordHash = await hash(DEV_PASSWORD, { algorithm: 2 });

  await db
    .insert(users)
    .values([
      {
        id: ADULT_ID,
        email: 'demo@friday.app',
        emailVerifiedAt: new Date(),
        passwordHash,
        displayName: 'Demo Learner',
        timezone: 'Asia/Kolkata',
        locale: 'en',
        dateOfBirth: '1999-04-12',
        isMinor: false,
        onboardingState: { step: 'goal', completed: false },
      },
      {
        // Exercises the FR-1.6 guardian-consent path, which is the common case
        // for the launch segment rather than an edge case.
        id: MINOR_ID,
        email: 'minor@friday.app',
        emailVerifiedAt: new Date(),
        passwordHash,
        displayName: 'Aarav',
        timezone: 'Asia/Kolkata',
        locale: 'en',
        dateOfBirth: '2009-08-21',
        isMinor: true,
        onboardingState: { step: 'guardian_consent', completed: false },
      },
    ])
    .onConflictDoNothing({ target: users.id });

  await db
    .insert(userPreferences)
    .values([{ userId: ADULT_ID }, { userId: MINOR_ID }])
    .onConflictDoNothing();

  // Weekday evenings and weekend mornings — a realistic aspirant's week.
  await db.delete(availabilityRules).where(eq(availabilityRules.userId, ADULT_ID));
  await db.insert(availabilityRules).values([
    ...[1, 2, 3, 4, 5].map((day) => ({
      userId: ADULT_ID,
      dayOfWeek: day,
      startTime: '18:00',
      endTime: '21:30',
      kind: 'available',
    })),
    { userId: ADULT_ID, dayOfWeek: 6, startTime: '09:00', endTime: '13:00', kind: 'available' },
    { userId: ADULT_ID, dayOfWeek: 0, startTime: '09:00', endTime: '12:00', kind: 'available' },
  ]);

  await db
    .insert(consents)
    .values([
      { userId: ADULT_ID, consentType: 'terms', granted: true, version: '2026-07-01' },
      { userId: ADULT_ID, consentType: 'privacy', granted: true, version: '2026-07-01' },
      { userId: MINOR_ID, consentType: 'terms', granted: true, version: '2026-07-01' },
      { userId: MINOR_ID, consentType: 'privacy', granted: true, version: '2026-07-01' },
      // Deliberately absent for the minor: 'guardian'. The gate should block.
    ])
    .onConflictDoNothing();

  // ── Phase 1: canonical vocabulary + curated template (roadmap 1.8) ────────
  const templateConcepts = flattenTemplateConcepts(JEE_PHYSICS_FOUNDATIONS_TREE);
  await db
    .insert(canonicalConcepts)
    .values(
      templateConcepts.map((c) => ({
        key: c.conceptKey,
        title: c.title,
        domain: c.conceptKey.split('.')[0] ?? 'general',
      })),
    )
    .onConflictDoNothing({ target: canonicalConcepts.key });

  await db
    .insert(curriculumTemplates)
    .values({
      slug: JEE_PHYSICS_FOUNDATIONS_SLUG,
      title: 'JEE Main Physics — Mechanics & Waves Foundations',
      examBoard: 'JEE Main',
      region: 'IN',
      tree: JEE_PHYSICS_FOUNDATIONS_TREE,
      isPublished: true,
    })
    .onConflictDoNothing({ target: curriculumTemplates.slug });

  // ── Phase 2: golden-set questions (roadmap 2.12) ──────────────────────────
  // Shared content keyed by canonical concept, so the practice loop has a cache
  // to serve from before any generation happens. Idempotent via a stem check —
  // `questions` has no natural unique key, and inventing one would constrain
  // real generated content for the sake of the seed.
  const existingStems = new Set(
    (await db.select({ stem: questions.stem }).from(questions)).map((r) => r.stem),
  );
  const newQuestions = GOLDEN_QUESTIONS.filter((q) => !existingStems.has(q.stem));

  if (newQuestions.length > 0) {
    const inserted = await db
      .insert(questions)
      .values(
        newQuestions.map((q) => ({
          conceptKey: q.conceptKey,
          type: q.type,
          status: 'active' as const,
          difficulty: q.difficulty,
          stem: q.stem,
          options: q.options ?? null,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          generationMeta: { source: 'golden_set', handWritten: true },
        })),
      )
      .returning();

    await db
      .insert(questionConceptKeys)
      .values(
        inserted.map((row, i) => ({
          questionId: row.id,
          conceptKey: newQuestions[i]!.conceptKey,
          isPrimary: true,
        })),
      )
      .onConflictDoNothing();
  }

  // A learner's Goal, curriculum, plan, and study history remain a per-user
  // fixture built by exercising the API rather than seeded directly here —
  // see PHASE_1_REPORT.md's demo walkthrough for the end-to-end example.

  log('Seeded 2 users (1 adult, 1 minor awaiting guardian consent).');
  log(`  Seeded ${templateConcepts.length} canonical concepts + 1 curriculum template.`);
  log(
    `  Seeded ${newQuestions.length} golden-set questions (${GOLDEN_QUESTIONS.length} total defined).`,
  );
  log(`  demo@friday.app  / ${DEV_PASSWORD}`);
  log(`  minor@friday.app / ${DEV_PASSWORD}`);
} catch (error) {
  console.error('Seed failed:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
