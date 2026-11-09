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
| AI extraction (Claude, structured output, deadline quote must appear word for word on the page) | Code built and unit-tested with a stand-in extractor; **not yet run against the live API** (no key configured) | `src/adapters/claude-extractor.ts` |
| Auto-publish of clean submissions (D11), behind `auto_publish_enabled` | Built; gate and worker path covered by `tests/integration/auto-publish.test.ts` | `src/domain/verification.ts` (`autoPublishBlockers`) |
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
| Unit + integration (local Postgres 16) | `npx vitest run` | 6 files, 70 tests passed |
| Same suite on Neon (Postgres 18) | `TEST_ENV_FILE=.env.neon npx vitest run` | passed (run before the admin UI was added; covers credits, authorization, reminders, storage) |
| End-to-end in Chromium against Neon | `node --env-file=<neon test env> tests/e2e/run.mjs` with app, worker and fetcher running | **19/19 passed** |
| Unit + integration on Windows 11 (local Postgres 16), 2026-11-05 | `npx vitest run` | 6 files, 70 tests passed |
| Unit + integration incl. auto-publish (local Postgres 16), 2026-11-06 | `npx vitest run` | 7 files, 77 tests passed. The reminders "outage" test depended on the time of day it ran; it now dispatches relative to the stored deadline. |
| End-to-end on Windows 11 (local Postgres 16), 2026-11-05 | `node --env-file=.env.local tests/e2e/run.mjs` with app, worker and fetcher running | **19/19 passed** (7/19 before the Windows fixes below) |

The e2e run (`tests/e2e/run.mjs`) covers: landing and brand logo; security headers; sign-up, email confirmation from the dev mail sink, onboarding; labelled sample data in the bank; sharing a link with a poster (stored in Neon object storage); the worker routing it to human review; poster visible to its owner only; a second member getting 404/403 on another member's submission, poster and the admin area; an admin accepting the submission and the contributor earning exactly one credit; all 12 admin pages returning 200; a never-checked fixture offering no unlock and debiting nothing; a starter-match unlock with no ledger entry; saving an application, adding a task, 6 deadline reminders scheduled, status not marked submitted; deadlines page; data export containing only the requester's data; mobile (iPhone 13) pages with no horizontal scroll.

The e2e refuses to run against a database whose name doesn't contain `test` or `dev`, because it creates accounts and resets rate limits. On Neon it ran against the `occasio_test` database, not `neondb`.

Bugs found and fixed by these runs: `forbidden()` returned 500 until `experimental.authInterrupts` was enabled; decorative tile art caused 8px of horizontal scroll on mobile; non-country eligibility codes were being uppercased by the review form, which would never match profile values.

Found on Windows: `worker/index.ts`, `scripts/migrate.ts` and `scripts/setup-roles.ts` compared `process.argv[1]` against a POSIX path, so on Windows they exited 0 without doing anything (no worker, no migrations, no roles). They now compare with `pathToFileURL`. The e2e's `npx` call needed `shell: true` on Windows. Sign-up and password reset showed only "Check the highlighted fields." with no field message; email/password errors now carry their field name.

## Blocked or not done

1. **Neon Realtime refuses all subscriptions** (`upstream_rejected`, non-retryable), from both the SDK and `neon realtime subscribe`. Re-running `neon realtime enable` did not change it. Needs Neon support or more time after enabling; the code is ready and degrades to the static bell.
2. **AI Gateway** needs a paid Neon plan (founder decision; not purchased).
3. **Email delivery**: no provider key configured, so mail goes to the development sink (`/admin/mail`). Nothing was sent to real addresses.
4. **No hosted deployment.** The app was built and run inside the build container only. Nothing was published publicly.
5. Terms and privacy pages are labelled drafts and need legal review.
6. Credentials pasted into chat during setup (the `neondb_owner` connection string and the first storage keys) should be rotated. New storage keys were already issued by `neon deploy`.

## Contributor perks (D13, 2026-11-06)

- Built: `src/domain/perks.ts`, migration `0004_perks_alerts.sql`, an outbox consumer on `opportunity.published.v1`, "Alert me" on Discover when filters are set, perks and alerts tiles on Credits, "Shared by you" on listing detail.
- Tested: `tests/integration/perks.test.ts` (4 tests) covers perks following earned credits rather than the balance, the threshold and empty-filter refusals, dedupe, an alert firing only for the matching member above the threshold (in-app and email), and "Shared by you". Full suite: 76/76 passing on the local database.
- Seen in the browser: Credits and Discover (locked state) for a new local account.
- Not seen: the unlocked state, and an alert arriving end to end through the running worker. No local account has 3 earned credits yet.

## Open board, discovery and invites (D14, 2026-11-08)

- Built: migration `0005_open_board_referrals.sql` (auto-publish on, Devpost source, `referral_codes`, `referrals`, `referral_award`); Devpost adapter and automatic candidate processing in `src/domain/discovery.ts`; sharing auto-tracks (`trackShared`); `src/domain/referrals.ts`, `/r/[code]`, invite tile on Credits; relaxed auto-publish gate.
- Fixed along the way: the restricted fetcher's pinned DNS lookup failed on Node 20+ (`Invalid IP address: undefined`) because Node asks for all addresses; `rejectSubmission` failed with "inconsistent types deduced for parameter $2".
- Tested: 91/91 (`tests/integration/open-board.test.ts`, updated `auto-publish.test.ts`). Covers the Devpost date formats, crawl, skipping invite-only, publishing, skip reasons, no credits from discovery, publishing from the record when pages return 403, auto-tracking for first and later sharers, referral award once on email confirmation, the monthly limit, and unknown codes.
- Live, local (8 Nov 2026): the Devpost crawl found 51 open hackathons, published 41 and skipped 10 that close within 72 hours. Invite flow checked in a real browser: link, sign-up, referral recorded, email confirmed, inviter balance 1.
- Scholarship Region (D15, migration 0006): live run on 8 Nov 2026. 40 posts read, 4 leads, 0 published: the linked organizer pages didn't state the deadline. One lead is waiting to retry after an HTTP 429. 94/94 tests pass.
- Official scholarship sources (D16, migration 0007): live run on 9 Nov 2026. Commonwealth: 6 candidates, 1 published. Erasmus Mundus catalogue: 20 candidates, 1 published; 17 rejected across both for no dated deadline on the page, 3 pages failed to load, 2 had passed deadlines. 95/95 tests pass.
- Admissions hop (D16): re-run of the 24 rejected official-source candidates on 9 Nov 2026 published 1 more (3 total from official sources). 96/96 tests pass.
- Not done: Devpost is the only source that publishes in volume (hackathons). Scholarships, fellowships and jobs need more sources. The e2e script still has the old unlock steps.

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
