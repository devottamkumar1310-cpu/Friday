/**
 * Boot-time environment validation.
 *
 * A missing `AUTH_SECRET` or a placeholder `DATABASE_URL` is a deployment
 * mistake, and the worst time to discover it is when the first learner hits the
 * first request. Checked once at startup instead, where it is loud, attributable
 * to the deploy that caused it, and cheap to roll back.
 *
 * Nothing here reads a *value* into a log. Configuration problems are described
 * by name only.
 */

export interface EnvProblem {
  variable: string;
  problem: string;
  fatal: boolean;
}

/** Long enough that a guessed or truncated secret is not viable. */
const MIN_AUTH_SECRET_LENGTH = 32;

const PLACEHOLDERS = [
  'postgresql://user:password@host/friday',
  'changeme',
  'your-secret-here',
  'ci-placeholder-secret-at-least-32-chars-long',
];

/**
 * Whether a URL is a loopback address.
 *
 * Browsers treat `localhost` and `127.0.0.1` as secure contexts, so a `Secure`
 * cookie is delivered over plain http there. That is not a technicality to work
 * around — it is how `next start` is exercised locally and in CI, both of which
 * set `NODE_ENV=production` because they are running a production build. This
 * exemption was added after the check refused to start exactly that.
 */
function isLoopback(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  } catch {
    return false;
  }
}

export function inspectEnv(env: NodeJS.ProcessEnv = process.env): EnvProblem[] {
  const problems: EnvProblem[] = [];
  const production = env['NODE_ENV'] === 'production';

  const databaseUrl = env['DATABASE_URL'];
  if (!databaseUrl) {
    problems.push({ variable: 'DATABASE_URL', problem: 'is not set', fatal: true });
  } else if (PLACEHOLDERS.some((p) => databaseUrl.includes(p))) {
    problems.push({
      variable: 'DATABASE_URL',
      problem: 'still contains the template placeholder',
      fatal: true,
    });
  }

  const authSecret = env['AUTH_SECRET'];
  if (!authSecret) {
    problems.push({ variable: 'AUTH_SECRET', problem: 'is not set', fatal: true });
  } else {
    if (authSecret.length < MIN_AUTH_SECRET_LENGTH) {
      problems.push({
        variable: 'AUTH_SECRET',
        problem: `is shorter than ${MIN_AUTH_SECRET_LENGTH} characters`,
        fatal: true,
      });
    }
    // Fatal only in production: the CI placeholder exists so a build can run
    // without a real secret, and failing that build helps nobody.
    if (PLACEHOLDERS.includes(authSecret)) {
      problems.push({
        variable: 'AUTH_SECRET',
        problem: 'is a known placeholder value and would be trivially forgeable',
        fatal: production,
      });
    }
  }

  const appUrl = env['APP_URL'];
  if (!appUrl) {
    problems.push({
      variable: 'APP_URL',
      // Not fatal: the same-origin check falls back to the request's own
      // origin. It is still wrong to leave unset, because that fallback trusts
      // whatever host header arrives.
      problem: 'is not set, so the same-origin check falls back to the request host',
      fatal: false,
    });
  } else if (production && appUrl.startsWith('http://') && !isLoopback(appUrl)) {
    problems.push({
      variable: 'APP_URL',
      problem: 'is plaintext http in production; session cookies are Secure and will not be sent',
      fatal: true,
    });
  }

  if (production && !env['SENTRY_DSN']) {
    problems.push({
      variable: 'SENTRY_DSN',
      problem: 'is not set, so unhandled exceptions will only reach the local log',
      fatal: false,
    });
  }

  return problems;
}
