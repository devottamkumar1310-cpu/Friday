/**
 * Focused probe: how reliably does the configured model satisfy the Content
 * Generator's nested output schema?
 *
 * Written because live validation showed the same call succeeding once and
 * failing later with "response did not match schema" — which is either an
 * intermittent conformance problem worth a repair loop, or noise. One sample
 * cannot tell the difference, so this takes several.
 *
 *   GEMINI_MODEL=gemini-flash-lite-latest npx tsx scripts/probe-schema.ts 3
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, '../../../.env.local') });

import { generateQuestions, resolveProvider, validateQuestions } from '../src/index';

const log = (m: string) => {
  // eslint-disable-next-line no-console -- CLI script
  console.log(m);
};

const attempts = Number(process.argv[2] ?? 3);

const { provider, name } = resolveProvider({
  AI_PROVIDER: process.env['AI_PROVIDER'],
  ANTHROPIC_API_KEY: process.env['ANTHROPIC_API_KEY'],
  GOOGLE_API_KEY: process.env['GOOGLE_API_KEY'],
  GEMINI_MODEL: process.env['GEMINI_MODEL'],
});

log(
  `provider=${name} model=${process.env['GEMINI_MODEL'] ?? '(tier default)'} attempts=${attempts}`,
);

let ok = 0;
let schemaFail = 0;
let other = 0;

for (let i = 1; i <= attempts; i++) {
  const start = Date.now();
  try {
    const result = await generateQuestions(provider, {
      conceptKey: 'physics.mechanics.newtons-laws',
      conceptTitle: "Newton's Laws of Motion",
      difficulty: 3,
      count: 2,
    });
    const issues = validateQuestions({ questions: result.questions });
    ok++;
    log(
      `  attempt ${i}: OK ${Date.now() - start}ms — ${result.questions.length} accepted, ` +
        `${result.rejected.length} rejected, ${issues.length} self-check issues, ` +
        `in=${result.usage.inputTokens} out=${result.usage.outputTokens}`,
    );
    // The rejection *reason* is the interesting part: it says whether the model
    // is producing broken answer keys, duplicates, or something else.
    for (const r of result.rejected) {
      log(
        `      rejected [${r.issues.map((x) => x.code).join(', ')}] ${r.question.stem.slice(0, 70)}`,
      );
    }
  } catch (error) {
    const message = String(error);
    if (message.includes('did not match schema') || message.includes('No object generated')) {
      schemaFail++;
      log(`  attempt ${i}: SCHEMA_FAIL ${Date.now() - start}ms`);
    } else if (message.includes('429') || message.toLowerCase().includes('quota')) {
      other++;
      log(`  attempt ${i}: QUOTA ${Date.now() - start}ms`);
    } else {
      other++;
      log(`  attempt ${i}: ERROR ${message.slice(0, 140)}`);
    }
  }
  if (i < attempts) await new Promise((r) => setTimeout(r, 8000));
}

log('');
log(`ok=${ok} schemaFail=${schemaFail} other=${other} of ${attempts}`);
process.exit(0);
