# OCCASIO build status

Last updated: 2026-11-03. Every claim below links to a command that was run, with its result. Nothing here is projected.

## What exists

| Area | State | Where |
| --- | --- | --- |
| Schema, row security, money guards | Built | `migrations/0001_init.sql`, `0002_eligibility_completeness.sql`, `0003_money_and_role_guards.sql` |
| Auth (email + password, verification, reset, re-auth, rate limits) | Built | `src/domain/auth.ts`, `src/app/auth/*`, `src/app/actions/auth.ts` |
| Onboarding, profile, notification settings, export, account deletion | Built | `src/app/(app)/onboarding`, `src/app/(app)/settings/*`, `src/app/api/v1/me/export` |
| Link + poster submission (private storage, metadata stripped) | Built | `src/app/(app)/contribute`, `src/adapters/storage.ts` |
| Verification pipeline (restricted fetcher, rule-based extraction, human review) | Built | `fetcher/`, `src/domain/verification.ts`, `src/app/admin/reviews` |
| Opportunity bank, search, detail with source and freshness | Built | `src/app/(app)/discover`, `src/app/(app)/opportunities/[id]` |
| Matching with transactional credits, starter match, refunds | Built | `src/domain/matching.ts`, `src/domain/exchange.ts`, `src/app/(app)/matches` |
| Application tracker, tasks, status history | Built | `src/domain/applications.ts`, `src/app/(app)/applications` |
| Deadline reminders (lease queue, coalescing, quiet hours) | Built | `src/domain/reminders.ts`, `worker/index.ts` |
| Approved-source discovery (fixture, JSON feed, HTML listing adapters) | Built | `src/domain/discovery.ts`, `src/app/admin/sources`, `src/app/admin/discovery` |
| Admin: overview, reviews, discovery, catalog corrections, reports, refunds, sources, jobs, audit, users and roles, flags, dev mail | Built | `src/app/admin/*` |
| Live unread-notification bell (Neon Realtime) | Code built, **not working on Neon yet** (see Blocked) | `src/server/live.ts`, `src/components/LiveBell.tsx`, `src/app/api/v1/live/notifications` |
| Labelled sample data | Built | `scripts/seed-fixtures.ts`, `fixtures/sources/` |

## Neon setup (org Dillon, project `snowy-sky-12593469`, branch `production`)

`neon init` and `neon deploy` both completed. `neon config plan` reports: `Utilized services: Postgres, Neon Auth, Object Storage, Realtime`.

| Service | State | Evidence |
| --- | --- | --- |
| Postgres | Wired. App and worker connect as `occasio_app` / `occasio_worker` (NOBYPASSRLS) via the Neon serverless driver (`DATABASE_DRIVER=neon`). | Full test suite and the e2e run pass against Neon (below). |
| Object storage | Wired. Private bucket `occasio-private`; posters served only through `/api/v1/assets/[id]` to the owner or staff. | `tests/integration/storage.test.ts` passes on Neon; e2e "poster is served to A only" passes. |
| Realtime | Enabled on the branch; app code wired. **Every subscription is refused by Neon** with `upstream_rejected`, including `neon realtime subscribe "SELECT 1 AS x"` from the Neon CLI itself. `wal_level` is `logical`, region `aws-us-east-2` is supported. The bell falls back to the server-rendered count, so nothing breaks. | See Blocked. |
| Neon Auth | Provisioned, **not used**. The app keeps its own tested auth (decision D6). | `neon.ts` `auth: true` |
| AI Gateway | **Off.** `neon deploy` refused it on the Free plan. Turning it on needs a paid plan, which is a purchase for the founder to approve. Extraction stays rule-based with human review. | `neon.ts` `aiGateway: false` |

Neon environment values live only in git-ignored `.env.local` / `.env.neon` in the build container. Nothing secret is committed.

## Test evidence

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | passes, 0 errors |
| Production build | `npm run build` | passes, 0 warnings, 44 routes |
| Unit + integration (local Postgres 16) | `npx vitest run` | 7 files, 72 tests passed |
| Same suite on Neon (Postgres 18) | `TEST_ENV_FILE=.env.neon npx vitest run` | passed (run before the admin UI was added; covers credits, authorization, reminders, storage) |
| End-to-end in Chromium against Neon | `node --env-file=<neon test env> tests/e2e/run.mjs` with app, worker and fetcher running | **19/19 passed** |

The e2e run (`tests/e2e/run.mjs`) covers: landing and brand logo; security headers; sign-up, email confirmation from the dev mail sink, onboarding; labelled sample data in the bank; sharing a link with a poster (stored in Neon object storage); the worker routing it to human review; poster visible to its owner only; a second member getting 404/403 on another member's submission, poster and the admin area; an admin accepting the submission and the contributor earning exactly one credit; all 12 admin pages returning 200; a never-checked fixture offering no unlock and debiting nothing; a starter-match unlock with no ledger entry; saving an application, adding a task, 6 deadline reminders scheduled, status not marked submitted; deadlines page; data export containing only the requester's data; mobile (iPhone 13) pages with no horizontal scroll.

The e2e refuses to run against a database whose name doesn't contain `test` or `dev`, because it creates accounts and resets rate limits. On Neon it ran against the `occasio_test` database, not `neondb`.

Bugs found and fixed by these runs: the restricted fetcher's pinned DNS lookup broke on Node 22 (every source check failed with "Invalid IP address" and fell back to human review); sending a submission back or rejecting it failed with a SQL parameter type error (now covered by `tests/integration/review-decisions.test.ts`); `forbidden()` returned 500 until `experimental.authInterrupts` was enabled; decorative tile art caused 8px of horizontal scroll on mobile; non-country eligibility codes were being uppercased by the review form, which would never match profile values.

## Blocked or not done

1. **Neon Realtime refuses all subscriptions** (`upstream_rejected`, non-retryable), from both the SDK and `neon realtime subscribe`. Re-running `neon realtime enable` did not change it. Needs Neon support or more time after enabling; the code is ready and degrades to the static bell.
2. **AI Gateway** needs a paid Neon plan (founder decision; not purchased).
3. **Email delivery**: no provider key configured, so mail goes to the development sink (`/admin/mail`). Nothing was sent to real addresses.
4. **No hosted deployment.** The app was built and run inside the build container only. Nothing was published publicly.
5. Terms and privacy pages are labelled drafts and need legal review.
6. Credentials pasted into chat during setup (the `neondb_owner` connection string and the first storage keys) should be rotated. New storage keys were already issued by `neon deploy`.

## How to run

```bash
npm ci
cp .env.example .env.local        # fill in values
npm run db:setup-roles && npm run db:migrate
npm run db:seed-fixtures          # optional, labelled sample data; refuses in production mode
npm run build && npm start        # app on :3000
npm run fetcher                   # restricted fetcher on :4100
npm run worker                    # verification, reminders, outbox, discovery
npm run db:make-admin -- you@example.com admin
```
