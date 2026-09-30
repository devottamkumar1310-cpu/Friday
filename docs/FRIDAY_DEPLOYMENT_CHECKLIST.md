# FRIDAY — Production Deployment Checklist

## 1. Vercel Configuration

**Status: READY**

The existing `apps/web/vercel.json` is correct:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs"
}
```

Vercel auto-detects:
- Framework: Next.js 15
- Build command: `next build` (from `apps/web/package.json`)
- Output: `.next` (Next.js default)
- Monorepo: pnpm workspaces with Turborepo

**Manual action required in Vercel dashboard:**
- Set root directory to `apps/web` (or use `packages/*` + `apps/*` workspace)
- Ensure Node.js 20.11+ is selected
- pnpm 9.15.9 is specified via `packageManager` field

## 2. Environment Variables

**Status: REQUIRES MANUAL ACTION**

### Required (server will not start without these)

| Variable | Purpose | Vercel Env Var Type |
|----------|---------|---------------------|
| `DATABASE_URL` | PostgreSQL connection string | Server-only |
| `AUTH_SECRET` | HMAC pepper for session tokens (32+ chars) | Server-only |

### Security / Correctness

| Variable | Purpose | Vercel Env Var Type |
|----------|---------|---------------------|
| `APP_URL` | Canonical HTTPS origin | Server-only |
| `CRON_SECRET` | Bearer token for cron endpoint | Server-only |

### Feature Gates

| Variable | Purpose | Vercel Env Var Type |
|----------|---------|---------------------|
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | Server-only |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | Server-only |
| `AI_PROVIDER` | `anthropic` or `google` | Server-only |
| `GOOGLE_API_KEY` | Google AI Studio key | Server-only |
| `ANTHROPIC_API_KEY` | Anthropic API key | Server-only |
| `NEXT_PUBLIC_REVENUECAT_WEB_API_KEY` | RevenueCat public key | Public |

### Optional

| Variable | Default | Purpose |
|----------|---------|---------|
| `SENTRY_DSN` | — | Server error reporting |
| `NEXT_PUBLIC_SENTRY_DSN` | — | Browser error reporting |
| `SENTRY_TRACES_SAMPLE_RATE` | `0.1` | Trace sampling |
| `LOG_LEVEL` | `info` | Log severity |
| `DATABASE_POOL_MAX` | `10` | Connection pool size |
| `DIRECT_DATABASE_URL` | — | Direct connection for migrations |
| `NEXT_PUBLIC_ENVIRONMENT` | `production` | Environment label |

**Never set in production:** `SEED_DEMO_USERS`

## 3. Google OAuth

**Status: REQUIRES MANUAL ACTION**

### Production Checklist

- [ ] Create Google Cloud project
- [ ] Enable Google+ API
- [ ] Create OAuth 2.0 credentials (Web application)
- [ ] Set authorized origin: `https://your-domain.com`
- [ ] Set authorized redirect URI: `https://your-domain.com/api/v1/auth/google/callback`
- [ ] Copy client ID to `GOOGLE_CLIENT_ID`
- [ ] Copy client secret to `GOOGLE_CLIENT_SECRET`

### Implementation Details

- **Initiator:** `GET /api/v1/auth/google`
- **Callback:** `GET /api/v1/auth/google/callback`
- **State cookie:** `google_oauth_state` (httpOnly, secure, sameSite=lax, 10min)
- **Session cookie:** `friday_session` (httpOnly, secure, sameSite=lax, 14-day sliding)
- **CSRF protection:** State parameter comparison
- **Error handling:** Redirects to `/sign-in?error=<code>`

### Cookie/Session Requirements

- `APP_URL` must be HTTPS in production
- Cookies are `Secure` in production
- `SameSite=Lax` for CSRF protection
- Session tokens are opaque 32-byte random strings
- Only HMAC-SHA256 hash stored in database

## 4. RevenueCat

**Status: REQUIRES MANUAL ACTION**

### Configuration

- **Public key:** `NEXT_PUBLIC_REVENUECAT_WEB_API_KEY`
- **Entitlement:** `friday_pro`
- **Offering:** Current offering (dynamic)
- **Packages:** Read from RevenueCat dashboard

### Production Checklist

- [ ] Create RevenueCat project
- [ ] Generate public Web API key
- [ ] Configure `friday_pro` entitlement
- [ ] Create offering with packages
- [ ] Add product identifiers (monthly/annual/lifetime)
- [ ] Set up App Store / Google Play (if mobile)
- [ ] Copy public key to `NEXT_PUBLIC_REVENUECAT_WEB_API_KEY`

### Test Store vs Production

- **Test Store:** Sandbox environment for development
- **Production:** Live environment for real purchases
- **Action required:** Switch from Test Store to Production in RevenueCat dashboard before public launch

### Purchase Flow

1. User clicks upgrade
2. RevenueCat paywall presented
3. User completes purchase
4. Webhook updates backend
5. Entitlement `friday_pro` activated
6. UI reflects Pro status

### Restore Flow

- Handled via `presentPaywall()` in billing-client.tsx
- User taps "Restore purchases"
- RevenueCat handles restore
- UI reloads with updated status

## 5. Database

**Status: READY**

### Requirements

- PostgreSQL 16+ (Neon recommended)
- SSL required (`sslmode=require`)
- Connection pooling via Neon pooler

### Migrations

8 migrations in `packages/db/migrations/`:

1. `0000_extensions.sql` — citext extension
2. `0001_identity.sql` — users, auth_sessions, consents
3. `0002_updated_at_triggers.sql` — auto-update timestamps
4. `0003_curriculum_planning_execution_memory_traces.sql` — core tables
5. `0004_assessment_intelligence_coach_platform.sql` — assessment tables
6. `0005_product_telemetry_and_feedback.sql` — product tables
7. `0006_insights_evidence_citation.sql` — evidence citations
8. `0007_add_decision_trace_id_to_insights.sql` — decision trace IDs

### Migration Command

```bash
pnpm db:migrate
```

### Connection Configuration

- `DATABASE_URL` — pooled connection for queries
- `DIRECT_DATABASE_URL` — direct connection for migrations (optional, falls back to DATABASE_URL)
- `DATABASE_POOL_MAX` — max connections (default: 10)

### SSL Requirements

- Neon requires SSL
- `sslmode=require` in connection string
- No self-signed certificates in production

## 6. Cron / Background Work

**Status: READY**

### Nightly Replan Route

- **Route:** `POST /api/v1/cron/replan`
- **Auth:** Bearer token (`Authorization: Bearer <CRON_SECRET>`)
- **Runtime:** Node.js
- **Protection:** Returns 401 on mismatch, 500 if CRON_SECRET unset

### Vercel Cron Configuration

Configured in `apps/web/vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/v1/cron/replan",
      "schedule": "0 0 * * *"
    }
  ]
}
```

### Required Environment Variables

- `CRON_SECRET` — long random string
- `DATABASE_URL` — for database access

### Safe Failure Behavior

- Returns 401 on auth failure
- Returns 500 on missing CRON_SECRET
- Logs errors per user/goal
- Continues processing on individual failures
- Returns summary: `{ usersProcessed, successCount, failureCount }`

## 7. Build

**Status: READY**

### Production Build Verification

```bash
pnpm typecheck    # PASS
pnpm test         # PASS (378 tests)
pnpm --filter=@friday/web run build  # PASS (49 routes)
```

### Build Output

- 49 routes generated
- Static pages pre-rendered
- Dynamic routes server-rendered
- Middleware: 91 kB
- First Load JS: ~169 kB shared

## 8. Post-Deployment Smoke Tests

**Status: REQUIRES MANUAL ACTION**

After deployment, verify:

- [ ] `https://your-domain.com` loads (landing page)
- [ ] `https://your-domain.com/sign-in` loads
- [ ] `https://your-domain.com/sign-up` loads
- [ ] Sign up creates account and redirects to onboarding
- [ ] Sign in authenticates and redirects to dashboard
- [ ] Dashboard shows real mission data
- [ ] Study session starts and completes
- [ ] Progress updates after session
- [ ] Billing page loads (if RevenueCat configured)
- [ ] Settings page loads
- [ ] Dark mode toggles correctly
- [ ] Mobile navigation works
- [ ] No console errors
- [ ] No failed network requests

## 9. Known Limitations

### Intentional

- AI provider falls back to fixture if no API key configured
- Google OAuth disabled if client ID/secret not set
- RevenueCat billing disabled if public key not set
- Cron job disabled if CRON_SECRET not set
- Sentry disabled if DSN not set

### Post-Launch Work

- Mobile app (React Native) exists but not production-ready
- Email verification not implemented (by design for MVP)
- Password reset not implemented (by design for MVP)
- Multi-goal support not implemented (single active goal)
- Notifications not implemented
- Daily brief not implemented

## Summary

| Component | Status |
|-----------|--------|
| Vercel Config | READY |
| Environment Variables | REQUIRES MANUAL ACTION |
| Google OAuth | REQUIRES MANUAL ACTION |
| RevenueCat | REQUIRES MANUAL ACTION |
| Database | READY |
| Cron | READY |
| Build | READY |
| Smoke Tests | REQUIRES MANUAL ACTION |
