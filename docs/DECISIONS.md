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
## D12. A free board; credits are earned by sharing (founder decision, 2026-11-06)
Founder: OCCASIO is a board of opportunities. Signed-in members see every published listing in full (requirements, official and application links) and can track any of them as an application, at no cost. Signed-out visitors see previews only. Sharing an opportunity that is accepted as new still earns one credit; credits will pay for perks that are not yet chosen. This replaces "spend a credit to unlock a match" from the confirmed rule "exchange opportunities": nothing on the board costs a credit any more.
Withdrawn listings stay visible only to staff and to members who tracked them before. The old match and unlock pages redirect to the board; the matching, redemption and refund code is kept but unused until the perks are decided.

## D13. Contributor perks: badge and personal alerts (founder decision, 2026-11-06)
Founder chose the first perks to build. Perks are reached by credits **earned** from shared opportunities over the account's lifetime; reaching one never spends a credit and spending later never removes it.
- Contributor badge (proposed threshold: 1 earned): a "Contributor" badge on the credits page, and "Shared by you" on listings your submission created.
- Personal alerts (proposed threshold: 3 earned): save Discover filters as an alert (max 5); when a matching listing is published the member gets an in-app notice and an email, once per listing, respecting notification preferences. The sharer is not alerted about their own listing.
Thresholds and the alert cap are PROPOSED values in `src/config/product-rules.ts`. Early access and AI application review were offered and are not built.

## D14. An open board fed by web discovery; credits for sharing and inviting (founder decision, 2026-11-08)
Founder: "no need to review anything, just scrape the web for opportunities and put it there." Credits come from sharing an opportunity you're applying to, and from sharing OCCASIO with other people.
- No review queue. Auto-publish is on by default (migration 0005). A listing still publishes only when its checks pass: the page or official record loads, title and deadline date come from it, the deadline hasn't passed and is more than 72 hours away, no risk signals or conflicts, not a duplicate. Anything else is skipped with its reasons (discovery) or returned to the sharer as "needs information" (shares). An admin can still switch auto-publish off.
- No AI key required: the rule-based parser may publish when every check passes (`autoPublishRequiresAi: false`). A deadline with no stated timezone publishes as date-only and is shown as such (`autoPublishAllowsUnknownTimezone: true`).
- First source: Devpost's public open-hackathon list (robots.txt allows all agents). Devpost answers our crawler's requests for individual hackathon pages with HTTP 403; we do not disguise the crawler to get past that. For Devpost-hosted hackathons the platform's own list record (title, organizer, submission period, location) is used as the official listing, recorded as the evidence snapshot, with the deadline as the last day of the submission period, date-only.
- Sharing an opportunity also adds it to the sharer's applications, new (1 credit) or already on the board (no credit).
- Invites: each member has a link (`/r/<code>`). When an invited person confirms their email, the inviter gets 1 credit (proposed), at most 10 a month (proposed). Self-invites and unknown codes are ignored; only the worker can award.
- Perks (D13) now count all earned credits, from shares and invites.

## D15. Opportunity blogs as lead sources: Scholarship Region (founder decision, 2026-11-08)
Founder asked to include Scholarship Region after being told most of its posts don't link to the organizer.
- Adapter `wordpress_leads` reads the site's public WordPress feed (robots.txt allows all agents except /wp-admin/).
- A post is a lead only. It becomes a candidate when it states "Deadline: <date>" and links out to an organizer page. Links to the blog's own or sister sites, other opportunity blogs, social media, logins, documents and bare homepages are ignored. Guides and listicles (no deadline) are skipped.
- The organizer page is fetched and checked like any other candidate, and the post's text is never published. Its deadline is a claim; the deadline has to be found on the organizer's page.
- Network errors and rate limits are retried later (up to 3 tries) instead of counting as a verdict.
- Expected yield is low. In the first live run, 40 posts gave 4 leads and 0 publishable pages: the linked pages were general pages without the specific deadline.


## D16. Official scholarship sources (founder decision, 2026-11-09)
Founder approved adding sources run by the funders themselves, after D15 showed blog leads rarely reach a page that states the deadline.
- Commonwealth Scholarships (cscuk.fcdo.gov.uk, robots.txt allows all): existing `html_listing` adapter over `/scholarships/`.
- Erasmus Mundus catalogue (www.eacea.ec.europa.eu, robots.txt disallows only admin/system paths): new `outbound_listing` adapter. The catalogue links to each joint master's own site; those links are the candidates, and EU, social and bare-URL links are ignored.
- Both crawl once a day, 5 seconds between requests. Every candidate page goes through the same checks; nothing publishes without a dated deadline on the official page.
- Considered and not added yet: DAAD (deadlines load from a script, not the page), Chevening, Mastercard Foundation and Study in Holland (robots.txt didn't respond to our agent), Gates Cambridge and Rhodes (no dated deadline on the apply pages we checked).
- First live run: 26 candidates, 2 published (Commonwealth Shared Scholarships; Erasmus Mundus STEPS). Most programme homepages put the deadline on a separate admissions page, so they were rejected for having no dated deadline.
