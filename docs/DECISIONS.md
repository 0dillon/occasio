# Build decisions

These are engineering decisions made while building, not founder-confirmed product rules. Product rules that are still proposals live in `src/config/product-rules.ts`. Each entry says what was chosen, why, and what would change it.

## D1. Plain Postgres (Neon in production) instead of a hosted backend platform
Chosen: Postgres with our own schema, roles and row security; Neon as the managed host. Why: credits, entitlements and reminders need transactional guarantees and policies we can test directly in SQL; nothing ties the app to a vendor SDK. Revisit if a hosted platform's auth or storage becomes a requirement.

## D2. Two runtime roles, both NOBYPASSRLS
`occasio_app` serves requests with the user identity set transaction-locally; `occasio_worker` runs trusted jobs. The owner role only runs migrations. Migration 0003 adds triggers so even the app role cannot raise a balance, re-enable a starter match, unfreeze a wallet or change roles outside an admin context.

## D3. Raw SQL, no ORM
Queries are short, reviewed SQL with parameters. Why: the money paths depend on exact locking (`FOR UPDATE`, `SKIP LOCKED`) and constraints that ORMs tend to hide.

## D4. Database-backed lease queue instead of a job service
Submissions, reminders, outbox events and discovery candidates are claimed with leases in Postgres. Restarts and multiple workers are safe; there are no in-memory timers per deadline. Revisit at volumes where polling cost matters.

## D5. Rule-based extraction plus mandatory human review
No model provider is configured (and Neon's AI Gateway needs a paid plan). Extraction is deterministic; anything uncertain goes to a person. Auto-publish is behind a flag that defaults to off.

## D6. Own auth instead of Neon Auth
Neon Auth is provisioned but unused. The app's auth was already built and covered by tests (rate limits counted in their own transaction, sessions ended on role change, re-auth for sensitive actions). Switching would mean re-proving all of that. Revisit if social sign-in is required.

## D7. Storage driver: disk for development, private S3-compatible bucket in production
Env names are `OBJECT_STORAGE_*`, not `AWS_*`, because some hosts inject their own `AWS_*` variables that silently override them. Posters are never public; they are served through an authorized route.

## D8. An open scam report blocks new unlocks
Until a person resolves it, nobody spends a credit on a listing someone flagged as a scam. Existing unlocks are not touched.

## D9. Neon serverless driver over WebSockets as an option
`DATABASE_DRIVER=neon` uses the Neon Pool over port 443, for hosts where TCP 5432 is blocked or connections are short-lived. `pg` remains the default.

## D10. Live notifications through Neon Realtime, with a static fallback
Realtime does not apply row security, so the live query filters by the session's user id, sealed server-side and renewed through an authenticated route that refuses if the signed-in user changed. If sealing or the connection fails, the bell shows the server-rendered count.

## D11. Auto-publish clean submissions (founder decision, 2026-11-06)
Founder chose to automate review for clean cases. Supersedes the "every acceptance goes through a person" part of D5 and the master plan's "200-item benchmark before broad auto-publication"; no benchmark exists yet.
When `auto_publish_enabled` is on, the worker publishes a member submission with no person only if: the AI extractor (Claude, `ANTHROPIC_API_KEY` + `ai_extraction_enabled`) read the official page; the page loaded; it isn't a duplicate; the deadline was quoted word for word from the page with a date and timezone and is more than 72 hours away; title, organizer and category were found; and there are no conflicts, risk signals or missing fields. A new organizer domain or an unstated fee no longer forces review. Everything else stays in the review queue with the reasons recorded as an "Auto-publish" check. Publishing goes through `acceptSubmission`, so the one-credit award, notifications and audit are unchanged.
Auto-published records have eligibility unconfirmed, so they are browsable but excluded from credit redemption until a person confirms eligibility. If the AI call fails, extraction falls back to rule-based and the submission goes to a person. Turning the flag off restores full human review immediately.
