> **Precedence note (from the handoff, Appendix A):** This preserves the original plan in full. Its proposed credit model, architecture, scope, budgets and roadmap remain detailed engineering guidance. Its historical "brand design not completed" line is superseded by the handoff Part I and the current Figma file. Nigeria-first acquisition and narrow initial cohorts are hypotheses, not restrictions on the founder's broad audience. Numerical targets are proposals, not measured results. Source references are the plan's research record, not fresh verification of vendor pricing or versions.

# OCCASIO
## Product, technical analysis, architecture, and delivery plan

Version 0.1 · 3 November 2026 · Planning baseline

**Purpose:** Give a product team and implementation agent a concrete basis for building OCCASIO. This is a proposed design, not evidence that software has been built, tested, deployed, or commercially validated. All numerical targets and budgets are planning assumptions unless identified as sourced facts.

## Contents

1. Product definition and assumptions
2. Feasibility and strategic analysis
3. Scope and requirements
4. Exchange economy and abuse rules
5. User experience and information architecture
6. Architecture and technology decisions
7. Domains and ownership boundaries
8. Opportunity data model
9. Relational storage and integrity
10. Submission and verification pipeline
11. Autonomous discovery and crawling
12. Matching and AI assistant
13. Application management and reminders
14. API and event contracts
15. Security and privacy
16. Infrastructure and deployment
17. Reliability, observability, and operations
18. Testing and AI evaluation
19. Capacity and cost model
20. Analytics and experiments
21. Launch, growth, and business planning
22. Delivery roadmap and backlog
23. Risk register and failure playbooks
24. Architecture decisions and unresolved choices
25. Implementation handoff and acceptance gates
26. Research references

---

## 1. Product definition and assumptions

### 1.1 Confirmed product intent

OCCASIO is an opportunity exchange hub. Users register, contribute opportunities with an image and application link, and ask an AI assistant for a relevant opportunity in return. The AI uses supplied materials as references, checks existence and current availability, and stores accepted opportunities in a shared bank. Automated web discovery also supplies the bank. Users can manage saved opportunities and receive help acting before application deadlines.

Opportunity categories can include hackathons, scholarships, grants, fellowships, jobs, internships, competitions, accelerators, events, and other application-based programmes. The platform's differentiator is the combination of contribution, useful matching, freshness, and application follow-through.

### 1.2 Working assumptions requiring validation

| Topic | Proposed starting assumption | Why it matters |
|---|---|---|
| Audience | Adults, initially students, early-career builders, and startup founders | Keeps initial eligibility and privacy scope manageable |
| Geography | Nigeria-first acquisition; opportunities may be global if eligible | Acquisition hypothesis, not a geographic restriction supplied by the founder |
| Language | English first, preserving original source language | Avoids untested multilingual extraction at launch |
| Product surface | Mobile-friendly web app; installable PWA later | Serves phone and laptop without native app teams |
| Initial categories | Hackathons, scholarships, grants/fellowships | Test distinct demand while keeping source operations bounded |
| Staffing | Two full-stack engineers, part-time designer/product owner, part-time curator | Basis for timeline and operational estimates |
| Beta scale | 1,000 registered users; 5,000 active canonical opportunities | Sizing scenario, not forecast |
| Exchange | One accepted contribution earns one noncash credit; one successful match redemption spends one | Proposed implementation of give-one/get-one |
| Submission | Application link required; image strongly encouraged but optional | Link-only submissions reduce friction; founder may choose mandatory images |
| Automation | Discover, assess, recommend, and remind; users submit their own applications | Application automation is a separate future integration project |
| Monetization | Free beta; paid convenience explored after retention | Avoids inventing demand or paid conversion |

No domain ownership, trademark availability, funding, source partnership, or provider account is assumed. Research these before public branding commitments or contracts.

### 1.3 Intended outcomes

- A contributor receives a useful, current, previously unseen match.
- A seeker understands why an opportunity fits and what remains uncertain.
- An applicant has a realistic preparation plan and timely reminders.
- An operator can explain why an opportunity was published, corrected, rejected, or removed.

OCCASIO can help users complete applications. It cannot guarantee registration, eligibility, selection, funding, or that someone reads a reminder.

## 2. Feasibility and strategic analysis

### 2.1 Technical feasibility

The core product is feasible using existing web, relational database, queue, OCR/vision, search, and language-model capabilities. The hard part is evidence quality and operational discipline, rather than generating opportunity summaries.

| Capability | Feasibility | Principal constraint | Starting approach |
|---|---|---|---|
| Image extraction | High for legible material | Blurry posters, incorrect years, ambiguous dates | Vision extraction with evidence and review fallback |
| Existence checks | High for accessible sources | Login walls, bot blocks, deleted pages | Official-source retrieval plus uncertainty states |
| Legitimacy assessment | Partial | Real sites can host scams; reputation is incomplete | Organizer checks, risk flags, reporting, human escalation |
| Deadline validation | Moderate | Missing timezones, rolling rounds, extensions | Structured deadline records and repeated checks |
| Eligibility matching | Moderate | Conditional rules and incomplete profiles | Explicit rules with eligible/ineligible/unknown outcomes |
| Web discovery | High within a bounded source list | Coverage, permissions, extraction drift, cost | Curated sources and adapters, then broader search |
| Reminders | High | Delivery failures and user inaction | Persistent schedules, retries, preferences, audit trail |

### 2.2 Product risks to test before scaling

1. **Contribution friction:** people seeking help may have nothing new to contribute.
2. **Duplicate saturation:** popular opportunities may already be in the bank.
3. **Perceived fairness:** a poor recommendation can feel like a wasted contribution.
4. **Trust:** a single convincingly presented scam can damage credibility.
5. **Outcome gap:** discovery may increase while completed applications remain low.
6. **Supply mismatch:** a large bank may still lack opportunities for a particular profile.

Run 12–15 interviews and a small concierge pilot across the initial audience segments. Ask users to contribute, request a match, and prepare an application while observing friction. Suggested directional go/no-go signals: at least half of pilot users find a match they would act on, and at least a third of activated users return within two weeks. These are experiment criteria, not established benchmarks.

### 2.3 Strategic options

| Model | Benefit | Weakness | Recommendation |
|---|---|---|---|
| Strict contribution before any value | Clear exchange identity | Cold-start and exclusion risk | Avoid as the only onboarding path |
| Starter match, then credits | Users experience value first | Requires abuse controls | Recommended beta hypothesis |
| Open bank plus paid assistant | Easy access and growth | Exchange becomes less central | Test later if exchange constrains retention |
| Community/institution sponsorship | Wider access without personal contribution | Sales and administration effort | Future access route |

Competitive positioning and willingness to pay remain research tasks. This document does not claim OCCASIO has no competitors.

## 3. Scope and requirements

### 3.1 MVP requirements

| ID | Requirement | Acceptance condition |
|---|---|---|
| FR-01 | Registration, verified email, recovery, sign-out | User can access and recover their own account |
| FR-02 | Profile and preferences | Interests, location, relevant eligibility, timezone, and notification choices editable |
| FR-03 | Image/link contribution | Upload accepted safely; submission status visible without holding a long request open |
| FR-04 | Verification | Evidence-backed decision with review/rejection reasons |
| FR-05 | Shared bank | Only publishable records appear in matching; operator can correct and retire records |
| FR-06 | Exchange credit ledger | Retry, concurrency, and duplicate handling cannot mint or spend a credit twice |
| FR-07 | Personalized match | Explains fit, uncertain eligibility, source, deadline, and last check |
| FR-08 | Automated discovery | Scheduled approved-source ingestion uses the same verification gates |
| FR-09 | Application tracker | Private saved opportunities, requirements, target dates, and status |
| FR-10 | Reminders | In-app/email reminders with preferences, deduplication, and deadline changes handled |
| FR-11 | Moderation and reporting | Review queue, reasons, audit log, correction appeal |
| FR-12 | Account export/deletion | Tested ownership checks and deletion workflow |

### 3.2 Later scope

Browser extension; direct calendar integrations; web push; WhatsApp/SMS; organization accounts; organizer self-service with verification; multilingual extraction; richer semantic search; institution dashboards; document assistance; integrations that verify application submission.

Keep native apps, global unrestricted crawling, a bespoke model-training programme, microservices, paid credit trading, and automatic application submission outside MVP. These require independent demand and risk assessments.

### 3.3 Quality targets

Targets apply to the beta workload in section 19 and exclude planned maintenance unless otherwise defined.

| Area | Proposed target |
|---|---|
| Web availability | 99.5% monthly, measured externally |
| Ordinary API latency | p95 below 800 ms, excluding uploads and third-party AI calls |
| Bank search | p95 below 1 second for representative beta queries |
| Cached match | p95 below 3 seconds |
| AI-assisted match | Usually below 15 seconds; asynchronous progress beyond request budget |
| Verification | p95 below 10 minutes for reachable, supported sources; review cases separate |
| Reminder scheduling | 99% of eligible due jobs attempted within 5 minutes under normal operation |
| Privacy | No cross-account access in authorization test matrix |
| Accessibility | WCAG 2.2 AA as a design and test target; audit before claiming conformance |
| Budget | Explicit per-stage monthly caps and operator alerts |

Delivery attempt is distinct from inbox delivery, which is distinct from the user reading or acting.

## 4. Exchange economy and abuse rules

### 4.1 Proposed rules

- One accepted **new canonical opportunity edition** earns one credit to its first accepted eligible contributor.
- Another year or round can count as a new edition; a tracking URL or rewritten title cannot.
- Accepted submissions from automated discovery do not create user credits.
- Ordinary duplicate submissions earn no credit. Explain this and link the existing record.
- Material corrections receive visible contributor recognition initially; credit rewards require a later policy to prevent edit farming.
- Credits have no cash value, transfer mechanism, expiry, or purchasable balance in beta.
- Offer one starter match per verified account as a configurable experiment. This is proposed, not founder-confirmed.
- A redeemed match gives permanent account access to that opportunity record and its subsequent corrections, including its official link. Saving, tracking, revisiting, and reminders do not consume further credits.
- Bank previews can show category, general topic, eligibility summary, and availability without the entire redemption payload. The exchange rewards curation and matching; it is not a promise that public information is secret.

### 4.2 Successful redemption

Charge only after the server has selected a publishable, fresh-enough, previously unseen opportunity that satisfies all known hard constraints and atomically created the user's entitlement. Never charge for an empty result, provider failure, a previously unlocked record, or an incomplete profile that blocks a reliable match.

Allow feedback and a refund request for objectively expired, duplicate, or clearly ineligible matches. A discretionary “not interesting” response influences ranking and may permit a limited replacement experiment; it must not allow unlimited bank extraction.

If a record was already closed at redemption or critical eligibility facts were wrong, issue one compensating ledger entry. Closure after a correctly timed redemption is not automatically a refund, but notify the user. Treat fraud reversals separately: freeze earning/redemption for investigation rather than silently imposing a negative spendable balance.

### 4.3 Transactional credit design

Use immutable signed ledger entries and a wallet row with `balance >= 0`. Within a single transaction: lock the wallet, validate spendability, create entitlement, append debit, update wallet, and write the domain event. Unique keys prevent a second award for the same canonical edition and prevent duplicate request execution. A unique `(user_id, opportunity_id)` entitlement prevents repeated charging for the same item.

Verification acceptance uses the same principle: lock or create the canonical edition under a unique identity, resolve duplicate races, then award once. An automated crawl may win the race; the losing user submission is explained as a duplicate. A future fairness experiment could reserve a candidate briefly, but MVP does not promise earliest-upload credit.

Use idempotency keys scoped to authenticated user and operation, store request hashes, and return the original response for a matching replay. A reused key with a different payload returns a conflict. Keep business uniqueness constraints after idempotency cache retention expires.

### 4.4 Initial anti-abuse controls

Verified email, per-account and per-IP submission limits, upload limits, risk-based challenges, organizer-domain checks, duplicate detection, and moderation. Proposed starting cap: five new submissions per verified user per day and one pending batch at a time; tune with evidence. Do not block an entire campus solely because users share a public IP. Reputation can prioritize review but cannot bypass publication requirements.

## 5. User experience and information architecture

### 5.1 Main screens

| Screen | Main action | Important states |
|---|---|---|
| Welcome | Understand give/get and see examples | Starter access explanation, no misleading inventory claims |
| Onboarding | Set interests and relevant eligibility | Skip optional fields; explain how unknown data affects matching |
| Home | See next action and request a match | Pending submission, no credits, no fit, deadlines approaching |
| Contribute | Paste link, upload image, confirm extracted details | Upload failed, duplicate, verifying, review needed, accepted |
| Match conversation | Describe desired opportunity | Clarification, candidate explanation, no suitable match |
| Opportunity detail | Check evidence and open official application | Changed deadline, uncertain timezone, withdrawn or suspected scam |
| My applications | Prepare and track | Saved, preparing, submitted, result, expired |
| Calendar/deadlines | Plan work | Local timezone and preparation milestones |
| Credits/history | Understand earnings and spending | Pending award, refund, frozen account |
| Settings | Manage privacy and notifications | Quiet hours, unsubscribe, export, deletion |
| Operations console | Review and maintain supply | Conflict evidence, crawl failure, fraud report, failed reminder |

### 5.2 UX rules

Mobile-first layouts; compressed upload previews; retry after network interruption; persistent submission drafts; visible status transitions; usable without chat for ordinary filtering and tracking. Keyboard and screen-reader access to every important action. Color is never the only verification signal.

Display distinct statements such as “Applications open; checked 3 Nov”, “Organizer identity needs review”, and “Deadline timezone not specified”. Avoid a single badge implying universal legitimacy or guaranteed eligibility. State what was actually checked.

An image should help extraction, not become the only accessible version of an opportunity. Show readable text, source links, and alternative text. Never let a web summary hide application fees, location restrictions, or important exclusions.

### 5.3 Notification example

“Your application target for [opportunity] is tomorrow. You still have two checklist items. Official deadline: [source date and timezone].” If timezone is uncertain: “The organizer lists [date] without a timezone. We recommend submitting early.” A click on the application link does not mark an application submitted.

## 6. Architecture and technology decisions

### 6.1 Recommended architecture

Use a **modular monolith with independently deployed background workers**. Keep product transactions in one PostgreSQL database and shared TypeScript domain packages. Separate untrusted website fetching from trusted application workers through a restricted fetch service.

```mermaid
flowchart TD
    U["Web app"] --> A["Application API"]
    A --> D["PostgreSQL"]
    A --> O["Private object storage"]
    D --> W["Trusted job workers"]
    W --> D
    W --> F["Restricted fetch service"]
    F --> S["External sources"]
    W --> M["Model provider"]
    W --> N["Email provider"]
```

The database includes durable domain events and a queue schema. Storage handles uploads and evidence assets. The fetch service has no database credentials, cloud metadata access, user cookies, or notification secrets. Administrative UI uses the same API with separate authorization, MFA, and audit requirements.

### 6.2 Proposed stack

| Layer | Starting choice | Reason / trade-off |
|---|---|---|
| Web and API | Next.js, React, TypeScript on supported stable releases | One language and deployment path; server code must remain separate from client bundles |
| Styling | Accessible component primitives plus a small token system | Faster consistent UI; design language remains a separate deliverable |
| Validation | Zod and shared JSON schemas | Validate user input, model output, and event contracts |
| Database | Managed PostgreSQL, initially Supabase | Transactions and relational integrity; managed auth/storage reduce setup |
| Database access | Drizzle for typed queries and migrations; SQL where explicit locking is needed | Keep database constraints visible and versioned |
| Authentication | Supabase Auth, verified email and optional Google login | Managed identity; authorization remains OCCASIO's responsibility |
| Uploads/evidence | Private Supabase Storage buckets | Signed access and retention; separate object backup required |
| Jobs | pg-boss with long-running Node workers | PostgreSQL-backed retries and scheduling without a second datastore |
| Fetching | Bounded HTTP retrieval; isolated Playwright fallback | Cheap normal extraction, browser rendering only when justified |
| AI | Provider adapter supporting structured text and vision | Choose a model through evaluation; do not hard-code a provider throughout the app |
| Search | PostgreSQL full-text search and structured filters | Sufficient first step; embeddings are optional after measured need |
| Email | Resend adapter or equivalent | Preserve portability; account setup and delivery validation required |
| Monitoring | Structured logs, error tracking, OpenTelemetry-compatible traces | Trace a contribution through verification to award |
| Deployment | Node web container, trusted worker container, restricted fetch container | Can use a managed container platform; no Kubernetes required |

Technical grounding: Next.js supports Node/container deployment [S1]. Supabase provides Postgres with associated auth/storage services [S2, S3]. PostgreSQL offers full-text search [S4]. pg-boss documents PostgreSQL job storage, scheduling, and retry behavior [S5–S7]. Specific package versions must be pinned and compatibility-tested during implementation.

### 6.3 Alternatives and revisit triggers

| Decision | Alternative | Revisit when |
|---|---|---|
| One product database | Separate services/datastores | Independent teams or sustained measured resource contention |
| PostgreSQL queue | Managed queue or workflow engine | Long multi-day workflows, queue load affecting product queries, operational burden |
| PostgreSQL search | Dedicated search engine | Representative searches miss latency/relevance targets despite indexing |
| TypeScript extraction | Python extraction workers | Specific parsing/ML libraries justify the operational cost |
| PWA-first | Native mobile apps | Retained users demonstrate native integration needs |
| Provider-neutral AI | Single provider implementation | A short prototype may start with one, while retaining a small adapter boundary |

## 7. Domains and ownership boundaries

| Module | Owns | Cannot do directly |
|---|---|---|
| Identity/profile | Account mapping, preferences, consent | Grant itself operator roles from profile input |
| Submissions | Raw contribution, status, attribution | Publish or mint credits without verification decision |
| Catalog | Canonical editions, eligibility, deadlines, visibility | Infer private user attributes |
| Verification | Evidence and rule evaluation | Spend credits or send unrestricted outbound messages |
| Discovery | Source registry, crawl frontier, budgets | Auto-publish without catalog gates |
| Exchange | Wallet, ledger, entitlements, refund policy | Change source evidence to make a match pass |
| Matching | Candidate filtering/ranking and match explanations | Override hard exclusions or write arbitrary SQL |
| Applications | Private saved records, checklists, status | Claim organizer confirmation from a link click |
| Notifications | Due records, attempts, preferences, webhooks | Change authoritative deadline based on email content |
| Trust/operations | Reports, decisions, appeals, audit | Edit ledger history or erase audit records silently |

Enforce boundaries through domain service functions and database roles. Shared database access does not mean every module may update every table.

## 8. Opportunity data model

### 8.1 Identity and editions

A programme is a recurring identity, such as an annual scholarship. An opportunity is one application edition or round. A source is one evidence location. Multiple posters, organizer pages, and application forms can describe the same edition. A new application round can share a programme but must have its own deadlines and eligibility.

Do not use a URL alone as the canonical identity: one URL can be reused every year, and many URLs can point to one round. Prefer trusted organizer identifiers; otherwise derive a reviewable identity from organizer, programme, edition/round, application window, and geography. Ambiguous collisions go to review.

### 8.2 Canonical fields

| Group | Fields |
|---|---|
| Identity | `id`, `programme_id`, `organizer_id`, `edition_key`, `title`, `slug`, `category` |
| Description | `summary`, `description`, `tags`, `skills`, `language` |
| Source links | `official_url`, `application_url`, alternate sources, canonical URL aliases |
| Availability | `opens_at`, `availability_state`, `availability_checked_at`, `next_check_at` |
| Geography | Allowed residence, citizenship, study location, event location, remote/hybrid/on-site |
| Eligibility | Versioned structured rules, source wording, exceptions, unknown conditions |
| Benefits | Cash/noncash benefits, amount range, currency, funding coverage, source wording |
| Cost | Application fee, attendance cost, travel support, free/paid/unknown |
| Application | Required documents, prerequisites, external portal, official instructions |
| Provenance | Original submitter, discovery source, evidence references, extraction/model/ruleset versions |
| Trust | Organizer assessment, publication decision, risk flags, last reviewed by |
| Change control | `revision`, `created_at`, `updated_at`, correction/withdrawal history |

Keep source-extracted values separate from user-confirmed values and operator-approved canonical values. A user correction is evidence to examine, not automatically authoritative.

### 8.3 Deadline representation

Each deadline is a record with `kind` (registration/application/document/interview), `source_text`, `source_local_date`, optional `source_local_time`, optional IANA timezone, optional UTC instant, precision (`instant`, `date_only`, `rolling`, `unknown`), evidence reference, verification timestamp, and revision.

Store user preparation targets separately. An unknown source timezone remains unknown; it does not silently become the user's timezone. A conservative internal planning cutoff can be generated and labeled as an estimate, never displayed as the official closing instant. Date-only or unclear deadlines near closing should be excluded from paid-credit matching until rechecked/reviewed. Rolling opportunities need freshness checks even without a fixed deadline.

### 8.4 Separate status dimensions

| Dimension | Values |
|---|---|
| Submission workflow | `received`, `processing`, `needs_information`, `review_required`, `accepted`, `duplicate`, `rejected`, `withdrawn` |
| Publication | `draft`, `review_required`, `published`, `hidden`, `archived` |
| Availability | `upcoming`, `open`, `closed`, `rolling`, `unknown` |
| Organizer trust | `unassessed`, `supported`, `concern`, `blocked` |
| Verification freshness | Derived from `last_successful_check_at`, source policy, and current time |

These dimensions prevent a common error: an expired scholarship may remain a valid historical record but is no longer available for a new match.

## 9. Relational storage and integrity

### 9.1 Logical tables

This is a schema design inventory, not executable migrations. Every table needs UUID identity where appropriate, foreign keys, timestamps, ownership policies, and explicit deletion behavior before implementation.

| Table | Key data and relationships |
|---|---|
| `profiles` | Auth user reference; display name, timezone, country, account state |
| `user_preferences` | Categories, interests, locations, constraints, desired benefits |
| `user_eligibility` | Minimal volunteered attributes; explicit unknowns; private |
| `user_consents` | Consent type, version, granted/revoked timestamps |
| `organizers` | Canonical name, domains, assessment and supporting evidence |
| `programmes` | Organizer reference and recurring programme identity |
| `opportunities` | Programme/organizer, unique edition identity, canonical fields and statuses |
| `opportunity_deadlines` | Opportunity, deadline kind/precision, original text, UTC if known, revision |
| `eligibility_rules` | Opportunity, rule type, operand JSON, source wording/evidence, ruleset version |
| `opportunity_sources` | Opportunity, source URL/role, latest evidence reference |
| `url_aliases` | Normalized URL, opportunity/edition mapping, validity window; not globally unique across all years |
| `submissions` | Contributor, raw link, upload references, processing state, resolved opportunity |
| `submission_assets` | Owner, private object key, media metadata, checksum, retention date |
| `evidence_snapshots` | Retrieved URL/time, HTTP metadata, content hash, bounded excerpt/object reference |
| `field_evidence` | Canonical field path, source snapshot, extracted value, review state |
| `verification_runs` | Submission/opportunity, rule results, model and prompt versions, costs, decision |
| `source_registry` | Domain/adapter, scope, access policy, robots status, priority, budget, next crawl |
| `crawl_runs` | Source, requested URL, fetch result, content hash, timing, retry/error classification |
| `crawl_frontier` | Dedupe key, source/URL, priority, due time, lease state |
| `wallets` | One per user; nonnegative balance; locked during awards/redemptions |
| `credit_ledger` | User, signed delta, reason, business reference, actor, immutable entry |
| `contribution_awards` | Unique canonical edition; recipient and source submission; enforces one award |
| `match_requests` | User, structured constraints, request state, selected match, feedback |
| `match_candidates` | Request, opportunity revision, eligibility evaluation, score/reason factors |
| `entitlements` | Unique user/opportunity; redemption reference and unlocked timestamp |
| `applications` | Unique user/opportunity; private notes/status, user submission assertion |
| `application_tasks` | Application, checklist, target date, completion |
| `reminders` | Owner/application/deadline/task, due time, deadline revision, channel, logical dedupe key |
| `notification_attempts` | Reminder, provider request ID/key, status, retry count, bounded response metadata |
| `reports` / `moderation_actions` | Reporter, target, reason, evidence, review outcome, appeal linkage |
| `audit_events` | Actor, action, target, redacted changes and correlation ID |
| `domain_events` | Transactional outbox: event ID/type, aggregate ID/revision, payload, dispatch state |
| `processed_events` | Unique consumer/event ID receipt for safe replay |
| `api_idempotency` | User/route/key, payload hash, stored response/reference, expiry |
| `provider_webhook_events` | Provider/event unique key, signature result, processing state |

### 9.2 Required constraints and indexes

- Unique programme/edition identity after canonicalization; manual merge tooling preserves aliases and attribution.
- Unique `contribution_awards(opportunity_id)`; an immutable ledger entry links the award.
- Unique `entitlements(user_id, opportunity_id)` and `applications(user_id, opportunity_id)`.
- Unique ledger business keys: award ID, redemption ID, and original-entry-plus-refund reason. An award/refund retry must collide harmlessly.
- `CHECK(wallets.balance >= 0)` and `CHECK(credit_ledger.delta <> 0)`.
- Unique reminder logical key built from user, target, revision, offset, and channel.
- Partial due-job index on active `reminders(due_at)`; index `opportunities(next_check_at)` for published records.
- Composite catalog indexes based on measured queries: publication/availability/category, organizer/edition, and geographic eligibility lookup. Normalize repeated membership data where indexing arrays/JSON becomes awkward.
- GIN full-text index over weighted title/summary/tags; trigram indexes only for demonstrated duplicate/search use cases.
- Index user ownership on private tables and foreign-key joins. Use cursor pagination and stable sort keys.

### 9.3 Access strategy

Keep product tables in a non-exposed schema; disable the general data API for those tables. Product reads/writes go through authenticated server domain services with a least-privilege database role. Use a separate migration role, queue role, and operator role. Supabase Auth and Storage continue through their supported interfaces; explicitly test storage object access.

User-owned tables additionally use RLS where practical. Direct server queries must set a verified user identity in a transaction-local context through a documented policy helper; `auth.uid()` does not magically know the user on a generic database connection. No query executes outside that transaction. Workers have narrowly scoped non-user roles and never rely on RLS to compensate for missing application authorization. Owners and `BYPASSRLS` roles can bypass row policies, so routine runtime roles must not be database owners [S8–S10].

Monthly ledger reconciliation compares wallet balances against summed signed entries and flags discrepancies. Never fix discrepancies by editing historic entries; add an audited corrective entry after investigation.

## 10. Submission and verification pipeline

### 10.1 Pipeline

```mermaid
flowchart TD
    I["Link and image"] --> E["Extract claims"]
    E --> C["Check sources and rules"]
    C --> D{"Evidence sufficient?"}
    D -->|Yes| P["Publish canonical edition"]
    D -->|Unclear| R["Request info or review"]
    D -->|Invalid| X["Reject with reason"]
    P --> A["Award eligible contribution"]
```

1. Authenticate, enforce quotas, validate URL syntax, and create a submission with a stable request ID.
2. Issue a scoped signed upload URL; verify actual object size, file signature, dimensions, and decode limits after upload. Images only in MVP; no SVG/HTML/executable uploads. Strip EXIF and re-encode accepted images.
3. Extract structured claims from the poster and link. Keep nulls when information is missing. A schema-valid response is not proof that the facts are true.
4. Retrieve the submitted page through restricted fetching. Locate the organizer's authoritative programme page and approved application portal where possible.
5. Resolve redirects safely, identify organizer/application relationship, and compare source claims with the poster. A third-party form can be valid when the organizer explicitly links it.
6. Normalize category, eligibility, benefits, fees, edition, and deadline. Save field-level evidence with timestamps and minimal excerpts.
7. Check duplicates against URL aliases, organizer/programme identity, edition, dates, title similarity, and optional image hashes.
8. Apply deterministic publication rules and risk checks. Route unresolved conflicting or high-risk cases to review.
9. Commit canonical publication and eligible contribution award atomically, with an outbox event. Notify the contributor after commit.

### 10.2 Publication gate

For ordinary automatic publication require: accessible supporting official source; organizer/application relationship supported; current edition identifiable; availability supported; required date precision captured; no unresolved material conflicts; known fee/benefit facts represented accurately or as unknown; no high-risk flags; no duplicate collision.

“Unknown” is not “false”, “free”, “global”, or “eligible”. A numerical model confidence must not override a failed rule. At launch, new organizer domains and unusually high-value offers receive human review. Review can publish with explicit uncertainty for browsing while excluding the record from credit redemption until the required conditions are met.

### 10.3 Decision examples

| Situation | Outcome |
|---|---|
| Poster and official page agree; current application window open | Publish if remaining gates pass |
| Poster says December; official page says October and is closed | Reject current contribution as closed; preserve discrepancy evidence |
| Official page says deadline extended | Adopt supported extension, increment revision, reschedule reminders |
| Image contains only day/month, no edition year | Ask for information or review; do not guess year |
| Search snippet says open but source is unavailable | Pending evidence; snippet alone insufficient |
| Application requires unexplained payment to an unrelated account | Escalate risk; do not auto-publish |
| Official portal has CAPTCHA | Request permitted evidence/review; do not attempt bypass |
| Same programme, new year's round | New edition if evidence supports a new window |

### 10.4 AI extraction contract

```json
{
  "schema_version": "1",
  "title": "Example only",
  "category": "scholarship",
  "organizer": {"name": null, "official_url": null},
  "application_url": "https://example.org/apply",
  "edition": null,
  "deadlines": [{
    "kind": "application",
    "source_text": "Applications close 20 December",
    "local_date": null,
    "local_time": null,
    "timezone": null,
    "precision": "unknown",
    "evidence_id": "evidence-example"
  }],
  "eligibility_claims": [],
  "fees": {"status": "unknown", "amount": null, "currency": null},
  "conflicts": ["Year not established"],
  "missing_information": ["edition", "deadline_year", "deadline_timezone"]
}
```

Validate field types, enumerations, URL policies, evidence references, length, and currency/date formats. Record model, prompt, schema, and ruleset versions. Never give the extraction model the power to publish, award credits, change user roles, or send arbitrary requests.

## 11. Autonomous discovery and crawling

### 11.1 Bounded discovery strategy

Start with a curated registry of 30–50 approved organizer/listing sources across the initial categories. Use official APIs, feeds, and sitemaps where available; then static HTML; then isolated browser rendering when necessary and permitted. Search APIs can discover new domains; unknown domains become candidates for source review rather than an unrestricted recursive crawl.

No live source registry has been created or audited in this planning task. Before enabling a source, an operator records ownership context, access/terms review, retrieval method, coverage, canonicalization rules, rate limits, attribution requirements, and a contact/takedown route. Respect robots rules as a product policy; robots rules themselves are not authorization [S11]. Seek advice on jurisdiction-specific obligations before launch instead of treating this document as legal clearance.

### 11.2 Crawl mechanics

- Identify the crawler with a descriptive user agent and contact page.
- Scope domain/path depth; cap candidate URLs, response size, wall time, and daily spend.
- Use conditional requests with ETag/Last-Modified where supported; avoid model calls for unchanged content.
- Start with one in-flight request per domain and a configurable minimum interval, such as five seconds; obey source-specific stricter limits and `Retry-After`.
- Treat 401/403/CAPTCHA as blocked/review outcomes, not a reason to rotate identities or evade restrictions.
- Separate listing discovery from detail-page verification. Third-party listings are leads, not definitive proof.
- Keep adapter fixtures and alert on large changes in extraction yield, empty pages, missing dates, and unexpected template changes.
- Store limited evidence and canonical facts with links; do not republish entire source pages by default.

### 11.3 Proposed refresh schedule

| Record condition | Starting cadence | Additional rule |
|---|---|---|
| Priority source listings | Every 6–24 hours | Per-source budget and change rate |
| Open opportunity, more than 14 days remaining | Every 48 hours | Recheck before redemption if older than the matching freshness limit |
| 2–14 days remaining | Every 24 hours | Changes notify affected applicants |
| Under 48 hours remaining | Every 6 hours | Exclude ambiguous deadlines near closing |
| Rolling deadline | Every 72 hours | Label last check and expire freshness eligibility |
| Repeated fetch failure | Back off up to 24 hours | Mark stale; do not automatically declare expired |
| Reported fraud or deadline conflict | Priority review | Hide from new matching until resolved |

These are initial policies, not external service guarantees. Selectors must recompute freshness at request time. Passing a historical check does not grant indefinite match eligibility.

### 11.4 Merge, withdrawal, and correction

Never replace current facts solely because a low-authority page is newer. Keep source priority and field conflicts. Organizer-supported updates create a new revision and a domain event. Merging duplicates reassigns aliases and user records safely; if a user already owns both records, preserve one entitlement and review any duplicate charge. Keep merge history and compensating credit entries where justified.

## 12. Matching and AI assistant

### 12.1 Matching pipeline

1. Parse the user's request into validated filters; ask only for attributes needed for the requested category.
2. Retrieve currently publishable and sufficiently fresh candidates using structured filters/full-text search.
3. Evaluate eligibility with three outcomes: `eligible`, `ineligible`, `unknown`.
4. Exclude explicit ineligibility and unresolved material hard constraints. Show useful unknowns for free exploration or ask the user to clarify before charging.
5. Exclude already unlocked, dismissed, withdrawn, or duplicate-edition candidates.
6. Rank remaining candidates and rerank for useful diversity.
7. Recheck critical availability when stale; revalidate revision/status inside redemption transaction.
8. Commit entitlement/debit, then explain the selected record using stored evidence.

### 12.2 Eligibility and ranking

Eligibility rules cover citizenship/residence, age range where necessary, education/enrollment, experience, organization stage, team size, location, and mandatory prerequisites. Request the minimum useful detail. An optional declined attribute remains unknown; do not infer nationality from a name or eligibility from browsing behavior.

Initial explainable ranking proposal, with factors normalized to 0–1:

`score = 0.35 interest_fit + 0.25 goal_fit + 0.15 verified_quality + 0.15 preparation_feasibility + 0.10 preference_fit`

Weights are product hypotheses to evaluate. Eligibility remains a gate, not a score component that can be offset by an attractive prize. Preparation feasibility considers remaining time and required documents; “closes soon” should not automatically rank highest. Show paid/free cost compatibility and uncertainty separately. Sponsored positions, if ever introduced, must be labeled and cannot override eligibility or trust gates.

### 12.3 AI assistant boundaries

The assistant can search allowed catalog fields, explain sources and fit, draft a checklist, and propose tracker changes. Explicit user requests may authorize saving or updating their own tracker through validated tools. Profile facts, ledger changes, publication, and notifications require normal domain authorization and rules regardless of model output.

The assistant must never invent an application link, deadline, prize, or eligibility claim. If no match exists, keep the credit, explain the limiting filters, and offer a saved search. External sources are untrusted content; instruction-like text in a poster cannot grant the assistant additional permissions [S12].

### 12.4 Model selection experiment

Compare a low-cost model and a stronger model on the same labeled sample of posters/pages. Measure field correctness, deadline errors, unsupported claims, escalation quality, latency, and cost per accepted opportunity. Use the stronger model only for evaluated hard cases. Default to deterministic/date/domain logic where possible. Keep a provider kill switch and a manual verification path.

## 13. Application management and reminders

### 13.1 Application lifecycle

`saved → preparing → submitted → selected / unsuccessful / withdrawn`

`expired` is an availability signal for unsubmitted applications, not a replacement for historic user status. Users can correct an accidental status update, with an audit trail. Store `submitted_at`, `submission_reported_by`, and optional user reference; distinguish user-reported submission from organizer-confirmed submission.

Task templates may suggest transcript, CV, essay, team formation, portfolio, or references. Each suggestion is linked to source requirements or labeled optional. MVP stores checklist text and notes, not identity documents or transcripts. File-vault support would need a separate privacy and retention design.

### 13.2 Scheduler and queue design

Use a small recurring scheduler that selects due persistent reminder records and dispatches jobs. Do not create an in-memory timer per deadline. A queue handles retries and process restarts; cron is an acceptable trigger, while database schedules remain the source of truth. pg-boss supports recurring scheduling; its handlers may execute more than once, so each side effect must be idempotent [S5–S7].

Default reminders: 7 days, 3 days, 24 hours, and optionally 3 hours before a known deadline. User preparation targets can produce earlier reminders. Quiet hours apply in the user's IANA timezone. If shifting through quiet hours would move a reminder beyond its cutoff, move it earlier or suppress it under an explicit preference policy. Do not quietly send after the deadline.

For date-only deadlines, use an explicitly labeled conservative preparation target and date-based reminders. For unknown/rolling dates, offer periodic check-ins and source-update alerts rather than fabricated deadline countdowns.

### 13.3 Idempotent send process

1. Claim a due reminder with a lease, using a transaction and bounded batch.
2. Reload application, user consent, current deadline revision, opportunity status, and cutoff.
3. Skip submitted/deleted/withdrawn/suppressed targets; obsolete revision jobs become no-ops.
4. Create an immutable notification attempt and provider idempotency key before the external call.
5. Send without holding a long database transaction open.
6. Store provider acceptance; signed webhook events update delivery/bounce/complaint state.
7. Retry transient failures with the same frozen payload/key; stop retries beyond cutoff.

The provider call and database commit are not atomic. If acceptance is uncertain, reuse the provider key during its supported retention window, reconcile using provider events, and route unresolved cases to review rather than blindly resending. Resend currently documents a 24-hour idempotency window [S13]. OCCASIO's logical reminder keys and attempt records are retained independently; provider support does not establish unlimited exactly-once delivery.

### 13.4 Deadline change and outage behavior

On deadline revision, invalidate unsent old reminders and rebuild future schedules. Notify users of a material extension or earlier closure separately. The send-time revision check protects against jobs already queued. After an outage, coalesce redundant missed reminders into at most one useful catch-up message per application/channel; never send the full backlog. Submitted users stop application reminders but may opt into result updates.

## 14. API and event contracts

### 14.1 API conventions

Version endpoints under `/api/v1`. Use authenticated server identity rather than trusting `user_id` in payloads. Validate JSON schemas, cursor pagination, rate limits, and object ownership. Mutation requests that award, spend, schedule, or trigger paid work require an idempotency key. Return UTC timestamps plus original source timezone/precision fields where relevant.

Errors use `{code, message, request_id, details}` with no stack trace or secret values. Use 401 for authentication, 403 for authorization, 404 without existence leakage where appropriate, 409 for state/idempotency conflicts, 422 for invalid/insufficient input, and 429 with retry guidance for limits.

### 14.2 Endpoint inventory

| Method/path | Purpose | Special condition |
|---|---|---|
| `GET/PATCH /me` | Profile/preferences | Only allow explicitly writable fields |
| `POST /uploads` | Issue scoped upload | File policy and quota enforced |
| `POST /submissions` | Start contribution | 202 with submission ID and state |
| `GET /submissions/:id` | Poll status/reasons | Owner or authorized reviewer |
| `POST /submissions/:id/information` | Add requested evidence | Version check; rerun relevant verification |
| `GET /opportunities` | Safe bank previews/filtering | No unintended entitlement leakage |
| `GET /opportunities/:id` | Preview or entitled detail | Server checks visibility and entitlement |
| `POST /match-requests` | Parse preferences and produce candidate | No debit on creation |
| `GET /match-requests/:id` | Match readiness | Owner only |
| `POST /match-requests/:id/redeem` | Unlock selected current record | Atomic entitlement and debit; replay safe |
| `GET /wallet` | Balance/ledger | Owner only; no client mutation |
| `POST /redemptions/:id/refund-requests` | Report objective mismatch | One request per issue, moderation rules |
| `POST/GET /applications` | Save/list own tracker | Unique user/opportunity |
| `PATCH /applications/:id` | Status/notes/target date | Optimistic revision check |
| `POST/PATCH /applications/:id/tasks` | Manage checklist | Ownership and safe text validation |
| `PATCH /notification-preferences` | Channels/quiet hours | Confirm timezone and consent changes |
| `POST /reports` | Report problem | Rate limited; preserve evidence |
| `GET/POST /admin/reviews/...` | Review and resolve | Operator permission, MFA, audit reason |
| `POST /webhooks/email-provider` | Delivery events | Raw-body signature verification, event dedupe |
| `POST /me/export` / `DELETE /me` | Privacy requests | Recent authentication and asynchronous completion |

### 14.3 Example request and response

```json
{
  "application_url": "https://example.org/programme/apply",
  "asset_ids": ["upload-example"],
  "user_note": "The organizer shared this poster today."
}
```

Submission creation returns `202 {"submission_id":"submission-example","status":"received"}`. Workers advance the workflow; the browser does not wait for scraping/model calls inside the creation request.

### 14.4 Events and jobs

| Domain event | Consumers / effects |
|---|---|
| `submission.received.v1` | Verification pipeline |
| `submission.resolved.v1` | Contributor status notification |
| `opportunity.published.v1` | Search freshness, saved searches, audit |
| `opportunity.changed.v1` | Reindex, impacted-applicant alerts, reminder replanning |
| `opportunity.hidden.v1` | Stop matching and relevant reminders; notify affected users if necessary |
| `contribution.awarded.v1` | Credit history notification |
| `match.redeemed.v1` | Analytics and entitled-detail availability |
| `application.changed.v1` | Reminder planning/cancellation |
| `user.deleted.v1` | Erasure orchestration and provider cleanup |

Event envelope: `event_id`, `event_type`, `schema_version`, `aggregate_id`, `aggregate_revision`, `occurred_at`, `correlation_id`, and minimal payload. Do not place private notes or full profile data in generic events. Consumers use unique receipts and revision checks; event order is not assumed across queues. Write domain state and outbox event in one transaction; the dispatcher may enqueue twice, so consumers remain idempotent.

## 15. Security and privacy

### 15.1 Threat model

The principal trust boundaries are browser-to-API, API-to-database, trusted-worker-to-fetcher, fetcher-to-internet, source-content-to-model, and model-output-to-domain-tools. Untrusted submissions can contain malicious links, images, fabricated facts, and embedded instructions.

| Threat | Required controls | Verification |
|---|---|---|
| Cross-account data access | Server ownership checks, least-privilege roles, tested RLS | Account A cannot read/update B's profile, tracker, ledger, uploads, or match requests |
| Credit races/replay | Transactions, wallet locks, unique business keys | Parallel acceptance and redemption tests |
| SSRF and metadata access | Restricted egress proxy; public HTTP(S) only; validated destinations and redirect hops | Private IPv4/IPv6, encoded addresses, rebinding, redirect and subresource tests |
| Prompt injection | No privileged tools in extraction; strict tool schemas/authorization; grounded output | Hostile poster/page and model-tool tests |
| Unsafe uploads | Signature/decode checks, dimensions/size caps, re-encoding, private buckets | MIME mismatch, decompression bomb, SVG/HTML and quota cases |
| Account abuse | Verified email, per-user/risk limits, operator MFA | Recovery and shared-network false-positive cases |
| XSS and unsafe links | Escaped text, sanitized render paths, CSP, safe outbound link handling | Malicious title/summary/URL tests |
| Forged webhooks | Signature/timestamp check, replay protection, event dedupe | Wrong signature, stale timestamp, repeated event |
| Secrets exposure | Managed secrets, restricted runtime roles, redacted logging | Bundle/secret scanning and logging tests |
| Operator misuse | Fine-grained roles, reason-required actions, append-only audit | Role matrix and audited high-impact actions |

SSRF checks must apply to every network destination: redirects, retries, browser subresources, downloads, websocket connections, and any model tool request. Block loopback, private, link-local, reserved, metadata, and unsupported address ranges. Validate resolved addresses and connect only to validated destinations with hostname/TLS verification preserved; a separate second DNS resolution can invalidate a check [S14]. A denylist alone is insufficient for an open fetch service. Use network enforcement and a narrowly controlled outbound proxy, with unknown domains reviewed for automatic crawling.

The browser fetch container runs non-root with resource limits, temporary filesystem, no persistent login session, no application secrets, no internal-network route, and browser sandbox enabled where supported. Return bounded text and evidence metadata. Do not give the fetcher a write path into the product database.

### 15.2 Authorization matrix

| Role | Allowed |
|---|---|
| Visitor | Marketing and limited sample opportunities |
| Verified member | Own submissions/profile/tracker; allowed previews; entitled details |
| Reviewer | Evidence and assigned moderation tasks; no wallet edits or unrestricted profile browsing |
| Catalog operator | Canonical corrections, source registry, publication actions with reasons |
| Support | Minimum account metadata and support actions; private notes hidden by default |
| Administrator | Role/configuration management under MFA; audited |
| Worker identities | Only their module's data/procedures; no interactive operator permissions |

Never derive operator roles from editable profile metadata or a browser-supplied flag. Require recent authentication for account deletion and sensitive account changes. Rate-limit login/recovery without leaking whether an address is registered.

### 15.3 Data minimization and retention proposals

| Data | Proposed policy | Implementation note |
|---|---|---|
| Profile/preferences | Until account deletion/inactivity policy | Avoid exact birth dates where an age band suffices |
| Eligibility attributes | Only fields needed for matching | Optional and private; do not send full profile to models unnecessarily |
| Rejected upload assets | Delete after 30 days unless appeal hold | Scheduled purge with audit |
| Accepted poster assets | Review at 90 days; retain only if necessary/permitted | Canonical text facts and attribution can survive asset deletion |
| Evidence excerpts | Retain while published plus proposed 180-day dispute window | Minimize copied text and remove accidental personal data |
| Raw model payload logs | Off by default; redacted diagnostic samples up to 7 days | Explicit access control and user data policy |
| Routine operational logs | Proposed 30 days | Redact emails, tokens, signed URLs, application notes |
| Security/admin audit | Proposed 180 days | Longer retention requires a documented reason |
| Ledger/audit after deletion | Minimized/pseudonymized as justified | Do not claim pseudonymization makes all retained data anonymous |
| Account deletion | Proposed 30-day operational target | Explain backup lifecycle and pending exceptions accurately |

These periods are product proposals, not a legal determination. Before launch, obtain a privacy review appropriate to the actual users, operating entity, sources, processors, and jurisdictions. Prepare terms, privacy notice, community rules, crawler policy, report/takedown process, and processor inventory. Establish age policy and a process for users who are not eligible to register.

Review AI-provider retention/training settings, data location, subprocessors, and deletion capabilities before sending production data. No need to upload identity documents to match public opportunities. Product notifications and marketing consent must be separately controllable.

## 16. Infrastructure and deployment

### 16.1 Environments and topology

Use local development, isolated staging, and production. Each has separate databases, object buckets, auth configuration, secrets, provider keys, and email routing. Staging uses synthetic/redacted fixtures and a restricted outbound email sink. Never copy real application notes or user documents into developer environments.

Place web/API, trusted workers, and database in a compatible region to limit latency and connection overhead. Restrict fetcher network access separately. Use TLS, managed secrets, health checks, bounded database pools, and graceful worker shutdown. Avoid running queue workers inside short-lived web request handlers.

Choose a supported Node LTS and PostgreSQL version at implementation time. Test pg-boss's required permissions, queue schema, adapter transaction support, and database connection modes against the selected managed project. Use a direct/session-compatible connection for long-running workers where appropriate; use transaction pooling only for clients whose behavior supports it. Connection mode is a deliberate compatibility decision [S15].

### 16.2 Repository structure

```text
apps/web/                  Web, API routes, member and operations UI
apps/worker/               Trusted jobs and scheduler
apps/fetcher/              Restricted HTTP/browser extraction
packages/domain/           Business services and invariants
packages/database/         Schema, SQL migrations, access helpers
packages/contracts/        API/event/model schemas
packages/ai/               Provider adapter, prompts, evaluation harness
packages/source-adapters/  Bounded source-specific extraction
packages/ui/               Shared accessible components/tokens
tests/                    Integration, concurrency, end-to-end, fixtures
ops/                      Deployment definitions and runbooks
docs/                     Decisions, API spec, data dictionary, product rules
```

This is a suggested structure, not a repository created by this task. Keep packages focused; do not add a package manager or build orchestrator solely for architectural appearance.

### 16.3 CI/CD

Pull request checks: formatting/lint, type checks, domain tests, database migration validation, authorization/concurrency integration tests, dependency/secret scanning, production build, and selected end-to-end tests. AI prompt/model changes run the labeled evaluation subset. Crawler adapter changes run source fixtures.

Build one immutable artifact per commit; promote the same artifact through staging to production. Apply backward-compatible expand/migrate/contract database changes. Web and worker versions must tolerate old/new event schemas during rollout. Do not run destructive schema changes automatically as routine app startup.

Release checklist: staging smoke test; migration/backup readiness; provider quotas; required environment variables; queue and notification health; feature flags; owner and rollback path. Deployment approval and publication are separate future actions; this planning document does not authorize a live release.

### 16.4 Rollback and portability

Keep the previous application image available and retain compatible schema columns until verified. Roll back application/worker code separately from data; never assume a schema rollback can recover deleted information. Freeze a faulty discovery adapter or model route independently with feature flags. Portability depends on SQL migrations, private object export, domain logic outside provider-specific functions, and a documented auth migration strategy.

## 17. Reliability, observability, and operations

### 17.1 Queue policy

Separate queues for user verification, source discovery, rechecks, matching enrichment, reminder planning, notification sending, and privacy erasure. Reminder and user-facing verification receive reserved concurrency so a crawl surge cannot starve them. Budget database connections across all processes before increasing worker count.

Use bounded exponential backoff with jitter, provider-aware rate limits, job expiry, heartbeats/leases, and dead-letter review. Starting transient retry pattern: up to four retries at approximately 30 seconds, 2 minutes, 10 minutes, and 30 minutes, constrained by task cutoff and provider guidance. Invalid URLs, denied policies, closed opportunities, or schema-rejected user input are terminal outcomes rather than endless retries. Never hold a database transaction open while calling an AI or email provider.

### 17.2 Metrics and alerts

| Signal | Why it matters | Starting action threshold |
|---|---|---|
| Oldest due reminder age | Deadlines may be missed | Alert above 5 minutes for 10 minutes |
| Oldest verification age | User waiting/credit not yet earned | Alert if normal queue exceeds 15 minutes |
| Notification acceptance failure | Reminders not leaving system | Alert on sustained rate increase; inspect provider status |
| Crawl parse yield/date coverage | Source adapters may have broken | Alert on material change from source baseline |
| Wrongly open/expired record reports | Trust and data quality | Priority investigation; hide affected cohort if systemic |
| Wallet/ledger mismatch | Exchange integrity | Immediate freeze of affected operation and reconciliation |
| AI spend/day and per acceptance | Unit economics or abuse | Warn at 70% and throttle at configured cap |
| DB CPU/connections/slow queries | Product and queue contention | Investigate sustained saturation before scaling |
| Unusual admin actions | Insider/account compromise | Review and revoke access as warranted |

Trace using correlation IDs from submission to fetch, model run, verification, publication, award, match, and reminder. Record counts, durations, costs, and error categories rather than sensitive full payloads. Dashboards separate system failures from expected review/rejection outcomes.

### 17.3 Backup and disaster recovery

Initial production target: database RPO no worse than 24 hours and RTO under 8 hours, tested against actual backup settings. Upgrade to finer recovery if the value of lost user changes/credits requires it. A 24-hour RPO can lose recent exchanges and reminders; the operator must reconcile external notifications and user reports after a restore. No stronger recovery claim without an exercised plan.

Back up database and object contents separately; Supabase's database backups do not include Storage objects [S16]. Keep encrypted off-site copies appropriate to the chosen plan and test restoration to an isolated environment before launch, then quarterly. After restore, reconcile notification attempts and suppress unsafe automatic replay until dedupe state is trustworthy. Test object-reference consistency and retained evidence.

### 17.4 Operations ownership

Assign a named product owner for exchange policy, engineering owner for queues/releases, curator for verification quality/source health, and support owner for reports/privacy requests. Small teams may share roles, but each issue needs one accountable owner. Maintain source review, fraud escalation, reminder failure, model outage, database restore, leaked credential, deletion request, and wrongful rejection runbooks.

## 18. Testing and AI evaluation

### 18.1 Test layers

| Layer | Important cases |
|---|---|
| Domain unit | Credit/refund rules, eligibility logic, status transitions, deadline interpretation |
| Database integration | Constraints, wallet locking, RLS/session context, outbox/consumer receipts |
| API authorization | Every role, own/other objects, invalid IDs, role spoofing, private asset access |
| Job integration | Crash/retry, expired lease, duplicate event, cancelled reminder, deadline revision |
| Source fixtures | HTML changes, deleted pages, CAPTCHA, redirects, incomplete/contradictory poster |
| End-to-end | Register → contribute → verify → earn → redeem → save → remind → mark submitted |
| Accessibility/mobile | Keyboard, screen reader, contrast, small screen, slow network, interrupted upload |
| Load | Representative mixed API + worker workload, database pool saturation, provider throttling |
| Recovery | Database and object restore, queue restart, uncertain email acceptance |
| Abuse/security | SSRF, prompt injection, image bombs, replay, race conditions, malicious links |

### 18.2 Mandatory race/failure cases

1. Two users and a crawler discover the same edition concurrently: one canonical opportunity and at most one eligible contribution award.
2. One user with one credit redeems two different matches concurrently: one succeeds, one receives insufficient-credit/state conflict.
3. Duplicate redeem request and delayed response retry: one entitlement and one debit.
4. Opportunity closes or changes eligibility between candidate selection and redemption: revalidation prevents the charge.
5. Worker crashes after provider acceptance before local commit: bounded idempotent retry/reconciliation avoids casual duplicate sends.
6. Deadline changes while a reminder is queued: old revision cannot produce a misleading ordinary reminder.
7. User marks submitted or revokes consent before send: job checks latest state and suppresses the send where still preventable.
8. Restored database contains old due reminders: recovery mode prevents blind replay.
9. Cross-user connection-pool reuse: transaction-local user context does not leak between requests.

### 18.3 AI evaluation dataset

Build a minimum 200-item labeled benchmark before broad auto-publication. Include clear valid cases, expired editions, recurring programmes, misleading posters, unusual timezones, rolling deadlines, third-party forms, scams/risk indicators, and adversarial instructions. Include different image quality and supported source formats. Keep a held-out set for release decisions; human reviewers adjudicate disagreements and preserve evidence.

Proposed launch gates: at least 95% exact-match accuracy on explicit critical deadline/edition fields in the supported held-out sample; no unsupported critical fact silently published in that release set; all known-risk cases routed appropriately; zero double-award/debit failures in concurrency suite. These are gates, not guarantees of real-world accuracy. Report sample sizes, error types, false publication/rejection rates, and uncertainty rather than a single “AI accuracy” percentage.

Start with manual review of all publications in the closed pilot. Enable auto-publication only for source/category cohorts that meet the gates. Audit a random sample of accepted records and every serious report. Model/prompt/ruleset changes require a regression comparison and canary cohort before expansion.

## 19. Capacity and cost model

### 19.1 Beta sizing scenario

| Quantity | Planning assumption | Consequence |
|---|---|---|
| Registered users | 1,000 | Small relational workload |
| Daily active users | 150 | Approximate 15% daily activity assumption |
| New user submissions | 50/day | Approximately 1,500/month |
| New crawl candidates | 150/day | Approximately 4,500/month before duplicate screening |
| Active catalog | 5,000 editions | Refreshing existing records may exceed new ingestion volume |
| Peak web activity | 20 requests/second | Load-test as a scenario; not a traffic prediction |
| Typical poster size after processing | 1 MB | 1.5 GB/month for user posters before purge/evidence additions |
| New tracked applications | 1,000/month | Up to 4,000 base deadline reminders, plus changes and task reminders |

Illustrative refresh mix: 3,000 distant-deadline entries every 48 hours = 1,500 fetches/day; 1,500 nearer entries daily = 1,500/day; 500 closing entries every 6 hours = 2,000/day. Total ≈5,000 recheck fetches/day, or 150,000/month, excluding new candidates and retries. This is why caching, conditional retrieval, and invoking AI only when meaningful content changes are central to cost control.

### 19.2 Cost equation

`monthly cost = app hosting + trusted/fetch workers + database/auth + object storage/egress + search/crawl APIs + model/OCR usage + email + monitoring + human operations`

`model cost = Σ((input_tokens × input_rate + output_tokens × output_rate) / 1,000,000) + vision/image fees + embeddings/tool fees`

Use the selected provider's actual metering units. Track each run to a submission/source; do not bill images as plain text tokens unless the provider does. `cost per accepted opportunity = total acquisition/verification spend ÷ accepted unique opportunities`; duplicates, failed fetches, and rejected candidates still cost money.

Illustration only: if one complete verification costs $0.03, 6,000 verifications cost $180; at $0.15 each, they cost $900. These are sensitivity inputs, not current model prices or measured OCCASIO costs. At the same assumed rates, re-running AI on every one of 150,000 monthly rechecks would add $4,500–$22,500. Change detection and narrow re-evaluation materially change viability.

### 19.3 Budget envelopes

These are proposed USD operating budgets, not vendor quotes. They exclude salaries, design, legal review, taxes, and paid acquisition; amounts require validation against actual plans and usage before procurement.

| Stage | Monthly envelope | Policy |
|---|---|---|
| Concierge/closed pilot | $100–$300 | Small catalog, manual review, bounded crawling |
| 1,000-user beta | $300–$1,000 | Metered AI, approximately 5,000 active entries, cached rechecks |
| 10,000-user scenario | $1,000–$4,000 | Re-estimate from measured DAU, crawl mix, model usage and send volume |

Human curation can dominate costs. At 100 manual cases/day and three minutes/case, review requires five hours/day; this is incompatible with a casually staffed side project. Reduce source scope, improve adapters, and cap intake before silently accumulating an unmanageable queue.

### 19.4 Scaling gates

Measure queue delay, database contention, CPU, fetch/model cost, and matching relevance before changing infrastructure. Increase worker concurrency within provider/source/DB limits. Split queue resources from product database when measured queue workload threatens transactional latency; a user-count milestone alone is insufficient. Add embeddings only if they improve held-out matching beyond structured filters/full-text search.

## 20. Analytics and experiments

### 20.1 Outcome metrics

Primary product metric: **weekly users who report submitting an application discovered through OCCASIO**. Label this user-reported; do not present it as organizer-verified impact. Track match usefulness and completion alongside contribution volume so the team does not optimize for a large, low-quality bank.

| Area | Metric |
|---|---|
| Activation | Verified signup → preferences set → first useful match saved |
| Supply | Unique accepted editions, acceptance rate, category/geography coverage, freshness |
| Exchange | Time to first earned credit, successful redemption rate, refund/dispute rate |
| Matching | No-match rate, dismissed matches, saved/redemption ratio, eligibility complaints |
| Follow-through | Preparing/submitted rates and time to first preparation task |
| Retention | Weekly cohort return and repeat useful matches/applications |
| Trust | Wrong deadline reports, suspected scam reports, correction resolution time |
| Efficiency | Cost/accepted edition, cost/activated user, manual minutes/acceptance |
| Notification quality | Attempt/acceptance/delivery/bounce, unsubscribes, useful actions after reminders |

### 20.2 Event taxonomy

`signup_verified`, `preferences_completed`, `submission_created`, `submission_resolved`, `credit_awarded`, `match_requested`, `match_unavailable`, `match_redeemed`, `match_feedback_given`, `opportunity_saved`, `application_preparation_started`, `application_marked_submitted`, `reminder_attempted`, `deadline_corrected`, `report_resolved`.

Product analytics must exclude chat bodies, exact sensitive eligibility attributes, application notes, and raw images. Use pseudonymous IDs, consent-aware instrumentation, and a documented event dictionary. A/B experiments must not compromise trust gates or create unequal handling of objectively incorrect charges.

### 20.3 First experiments

| Experiment | Hypothesis | Measure / stop condition |
|---|---|---|
| Starter match vs strict exchange | Seeing value improves later contribution | Activation and useful contributions; monitor duplicate/account abuse |
| Credit for material correction | Useful updates can ease duplicate saturation | Accepted fresh corrections vs trivial edit farming |
| Match card vs chat-first | Some users want fast filters more than conversation | Time to useful save and task completion |
| Preparation targets | Earlier milestones improve submission follow-through | User-reported submission and reminder fatigue |
| Narrow vs broad category launch | Smaller source scope improves trust and density | No-match rate, freshness, curator workload |

Run small qualitative pilots before interpreting low-volume statistical differences. Predefine observation windows and success criteria; do not claim causal uplift from ordinary before/after changes.

## 21. Launch, growth, and business planning

### 21.1 Cold-start plan

1. Interview intended users and curate a seed set with evidence.
2. Aim for 150–300 fresh editions across the selected categories and eligibility needs, rather than filling the bank with weakly relevant listings.
3. Recruit an invited cohort of 30–50 users through one or two reachable communities.
4. Review all new contributions and matches during the concierge period; measure preparation behavior, not just excitement.
5. Expand to 100–300 users after exchange and reminder failures are understood.
6. Enable limited automatic publishing and expand sources only when evidence quality and operating capacity support it.

The 30–50-source registry and 5,000-entry bank are later beta sizing goals, not prerequisites for a small pilot. Source partnerships, organizers, campus communities, and founder groups can be researched after the audience focus is confirmed. No outreach has been sent by this task.

### 21.2 Supply and community rules

Explain accepted categories, duplicate handling, attribution, prohibited misleading submissions, evidence expectations, report paths, and appeals. Credit awards are for useful accepted supply, not for views or sensational prize claims. Avoid leaderboards that reward raw volume before trust controls are established. Recognize contributors without exposing their private profile or contact information.

Organizer self-service should require proof of domain/control or equivalent review, and never allow organizers to silently delete critical user reports or rewrite historic decisions.

### 21.3 Revenue hypotheses

| Hypothesis | Potential value | Validation required |
|---|---|---|
| Premium convenience | Additional saved searches, planning, digest controls | Users will pay for ongoing value beyond public links |
| Institution/community plans | Cohort support and aggregate outcome reporting | Buyer demand, privacy-safe reporting, sales cycle |
| Organizer tools | Verified programme management and application readiness insights | Organizer interest and strict separation from editorial trust |
| Sponsored discovery | Transparent qualified reach | No hidden paid ranking or eligibility overrides |

Do not set a revenue forecast or final pricing without willingness-to-pay research, actual service cost, and a clear access policy. If credits can be purchased later, revisit consumer terms, refunds, abuse incentives, accounting, and the exchange identity before building payments.

### 21.4 Brand, support, and policy deliverables

Product name: **OCCASIO**. Brand identity work remains open: logo/wordmark, colors, typography, tone, iconography, accessible components, domain/trademark checks, social handles, and landing-page messaging. This plan does not create or validate those assets.

Support needs a searchable help center covering contribution rejection, duplicate credit, no available match, deadlines, refunds, notification settings, suspicious opportunities, and account deletion. Define expected response times according to staffing; do not promise 24/7 support without coverage.

## 22. Delivery roadmap and backlog

### 22.1 Planning estimate

Estimate **12–14 calendar weeks** to a controlled public beta with two experienced full-stack engineers, part-time product/design, and reliable curator support. This assumes familiar infrastructure, limited initial categories, and no major legal/source access blockers. A solo part-time build could take several months longer. Re-estimate after the first end-to-end vertical slice; no fixed launch date is committed.

| Phase | Indicative weeks | Deliverables | Exit gate |
|---|---|---|---|
| Discovery and policy | 1–2 | Interviews, rules, source review samples, user flows, prototype, labeled data start | Audience/problem supported; exchange and uncertainty rules explicit |
| Foundation | 3–4 | Repo/CI, environments, auth, schemas, ownership controls, private upload, worker connection | Private account and upload flows tested; job restart demonstrated |
| Vertical slice | 5–6 | One-source ingestion, extraction, operator review, canonical publication, award/redeem | One user can complete the core exchange with evidence and correct credit math |
| Tracker and discovery | 7–8 | Applications/tasks, reminders, source registry, bounded discovery, rechecks | Deadline change/cancel/retry tests pass; source budget enforced |
| Trust and closed pilot | 9–10 | Reports/refunds, audit, evaluation harness, analytics, pilot support | Pilot usability and quality issues addressed; selective auto-publish only if gated |
| Hardening and beta | 11–12 | Load/accessibility/security testing, restore drill, runbooks, onboarding | Launch gates pass and accountable operators assigned |
| Contingency | 13–14 | Source drift, model/provider issues, feedback fixes | Release scope reduced if necessary; avoid bypassing gates |

### 22.2 Prioritized backlog

Effort is relative: S = up to roughly 1 engineer-day; M = 2–4; L = 5–8; XL = break into smaller work before committing. These estimates exclude review/rework and should not be summed as a contractual schedule.

| ID | Priority | Work item | Dependency | Size | Acceptance focus |
|---|---|---|---|---|---|
| P-01 | P0 | Confirm audience, categories, credit rules, starter access | Founder decisions | M | Written examples of earn/spend/refund/no-match |
| P-02 | P0 | User interviews and clickable flow prototype | P-01 draft | L | Observed contribution/match/tracker usability |
| T-01 | P0 | Repository, CI, schema migration pipeline | Stack choice | M | Reproducible build and isolated staging |
| T-02 | P0 | Authentication/profile/roles | T-01 | M | Recovery and owner/role tests |
| T-03 | P0 | Canonical schema, deadlines, provenance | P-01, T-01 | L | Constraints and timezone precision fixtures |
| T-04 | P0 | Private image/link submission | T-02 | M | Safe uploads, quotas, resumable draft |
| T-05 | P0 | Queue/outbox/worker foundation | T-03 | M | Restart and duplicate event safety |
| T-06 | P0 | Restricted fetch service | T-05 | L | SSRF and untrusted browser egress tests |
| T-07 | P0 | Structured extraction and verification | T-03, T-06 | L | Evidence references, conflict handling |
| T-08 | P0 | Review console and audit | T-02, T-07 | M | Approve/reject/correct with reason |
| T-09 | P0 | Duplicate resolution/canonical merge | T-03, T-07 | L | Concurrent editions cannot double-award |
| T-10 | P0 | Wallet/ledger/entitlements/refunds | T-03, P-01 | L | Exactly one business award/debit per valid action |
| T-11 | P0 | Eligibility/filter/ranking | T-03, T-10 | L | Unknowns never silently become eligibility |
| T-12 | P0 | Grounded match conversation | T-11 | M | No invented links; no-match preserves balance |
| T-13 | P0 | Tracker and preparation tasks | T-02, T-03 | M | Private notes and user-reported submission |
| T-14 | P0 | Reminder planner/sender/webhooks | T-05, T-13 | L | Deadline changes, quiet hours, uncertain acceptance |
| T-15 | P0 | Curated source registry/adapters | T-06, T-07 | L | Approved bounded crawl, stop switch |
| T-16 | P0 | Freshness/rechecks/change propagation | T-14, T-15 | M | Stale records excluded from redemption |
| T-17 | P0 | Reports, support, privacy export/delete | T-02, T-08 | M | Ownership, deletion completion, appeal history |
| T-18 | P0 | Evaluation/monitoring/cost controls | T-07 onward | L | Quality gates, spend attribution and caps |
| T-19 | P0 | Recovery/security/load/accessibility | Core slice | L | Tested launch gates, recorded limitations |
| G-01 | P0 | Seed bank and concierge pilot | T-08, T-11 | L | Fresh relevant supply and outcome feedback |
| G-02 | P1 | Saved searches/digests | T-16 | M | Preferences respected; no duplicate alerts |
| G-03 | P1 | Calendar export and PWA polish | T-13 | M | Dates and timezone representation correct |
| G-04 | P2 | Organization/organizer tools | Pilot evidence | XL | Separate research and authorization design |

P0 is required for the scoped beta. P1 improves retention after the core works. P2 is conditional expansion. If schedule slips, cut categories, source count, or optional assistant polish before cutting authorization, evidence, transactional credit rules, or reminder correctness.

### 22.3 Parallel work allocation

Engineer A owns identity, exchange, matching API, and member UI. Engineer B owns ingestion, workers, reminders, and operations UI. Both review schema/security changes. Product/design owns policies, user research, flows, and prioritization. Curator owns source approval, labels, review queue, and user trust feedback. No lane can independently change canonical IDs, event schemas, or credit semantics without coordinated review.

## 23. Risk register and failure playbooks

### 23.1 Risk register

| Risk | Likelihood / impact hypothesis | Mitigation | Owner |
|---|---|---|---|
| Scam published as trusted | Medium / critical | Organizer evidence, risk review, reports, rapid hide | Trust owner |
| Incorrect deadline | High / high | Source precision, revisions, rechecks, conservative display | Catalog owner |
| Exchange feels unfair | High / high | Starter experiment, clear duplicate/refund rules, no-match retention | Product owner |
| Bank has poor fit | High / high | Focused cohorts, coverage metrics, saved searches | Product/curator |
| AI invents eligibility/benefit | Medium / high | Grounding, schema/rule gates, held-out evaluation | Engineering/AI owner |
| Crawler blocked or source changes | High / medium | Approved adapters, feeds, drift alerts, manual fallback | Ingestion owner |
| Crawl/AI bill spikes | Medium / high | Per-source caps, change detection, model budgets, stop switch | Engineering owner |
| Duplicate credit or spend | Medium / high | Unique constraints, locks, replay tests, reconciliation | Exchange owner |
| Reminder delayed/duplicated | Medium / high | Persistent records, dedupe, provider reconciliation, alerts | Operations owner |
| Private data exposed | Medium / critical | Ownership tests, least privilege, minimization, audit | Security owner |
| Review queue overwhelms team | High / high | Intake caps, narrow source scope, staffing thresholds | Trust/product |
| Provider outage/lock-in | Medium / medium | Adapters, exports, kill switches, degraded mode | Engineering owner |
| Weak retention | Medium / high | Concierge validation, follow-through focus, segment analysis | Product owner |

Likelihoods are initial judgments, not empirical risk estimates.

### 23.2 Failure playbooks

**Suspected scam:** hide from new matching immediately, preserve evidence, identify entitled/saved users, investigate organizer relationship, issue correction and eligible compensating credits, notify affected users with concrete facts, and audit how publication passed.

**Wrong deadline:** suspend affected matches; locate authoritative correction; update deadline revision; cancel/replan future reminders; notify affected applicants; refund only under documented policy; add the case to evaluation fixtures.

**AI outage or spend cap reached:** stop new expensive tasks, keep tracker/search/entitled details operating, show truthful pending states, prioritize existing deadline safety work, and let operators manually resolve urgent supported cases.

**Database or queue outage:** pause claims where state cannot be confirmed, alert operator, restore service, reconcile leases and transaction status, then coalesce overdue reminders. Do not repeat external side effects blindly.

**Credential leak:** revoke/rotate affected credentials, contain impacted services, preserve relevant logs, assess access and user impact, restore with least privileges, and follow the incident/privacy response process appropriate to the facts.

**Source access complaint:** pause the relevant adapter, record the complaint, review access policy and retained material, remove/correct content where appropriate, and resolve before reactivation.

## 24. Architecture decisions and unresolved choices

### 24.1 Proposed decision records

| ADR | Decision | Reason | Revisit trigger |
|---|---|---|---|
| ADR-001 | Modular monolith with workers | Small-team transaction consistency | Independent scale/team boundaries |
| ADR-002 | PostgreSQL canonical store and queue | Reduce infrastructure and preserve atomic state | Queue contention or workflow needs |
| ADR-003 | Programme/edition/source separation | Correct recurring and duplicate identities | New category semantics |
| ADR-004 | Evidence-backed deterministic publication gate | Model confidence alone cannot establish truth | Evaluated policy improvement |
| ADR-005 | Separate publication/availability/trust | Historical validity differs from current usability | New trust states |
| ADR-006 | Noncash immutable credit ledger | Explainable exchange and safe compensation | Purchased/transferred credits |
| ADR-007 | Separate restricted fetching | Untrusted URLs must not reach trusted networks | Infrastructure/security review |
| ADR-008 | No automatic application submission in MVP | Portals and consent need dedicated integrations | Demonstrated demand and supported APIs |
| ADR-009 | Scheduled database reminders plus queue | Survive restarts and deadline changes | More complex workflow orchestration |
| ADR-010 | Full-text/structured matching before vectors | Eligibility and freshness matter first | Measured semantic relevance gap |
| ADR-011 | Private operational data by default | Notes, uploads, profiles, wallets are user data | Explicit sharing features |
| ADR-012 | Humans in the quality loop | Ambiguity and fraud need escalation | Cohort-specific evidence supports automation |

### 24.2 Founder choices still open

| Choice | Proposed default | Consequence of changing it |
|---|---|---|
| Initial audience/geography | Nigeria-first acquisition, global eligible opportunities | Changes sources, language, privacy review, and GTM |
| Initial categories | Three categories listed above | Each new category adds rules and review burden |
| Starter access | One free initial match | Strict exchange may reduce activation |
| What earns credit | First accepted new edition | Correction credits require abuse rules |
| Image requirement | Optional image, required application link | Mandatory image may exclude legitimate text-only opportunities |
| What redemption unlocks | One relevant canonical record permanently | Whole-bank access weakens one-for-one semantics |
| No-match handling | Preserve credit; offer saved search | Spending anyway harms fairness |
| Notification channels | In-app and email | WhatsApp/SMS changes cost, consent, and integrations |
| Team and budget | Assumptions in sections 1/19 | Changes schedule and operating scope |
| Monetization | Free beta, validate later | Payments add policy, fraud, support, and accounting work |
| AI vendor/deployment provider | Evaluate and select before implementation | Requires actual capabilities, terms and budget review |

These defaults make the plan concrete without treating unconfirmed preferences as settled product requirements. Decisions can be made together; development can start on provider-neutral schemas, workflows, and evaluation fixtures while commercial choices remain open.

## 25. Implementation handoff and acceptance gates

### 25.1 First implementation sequence

1. Convert P-01 into versioned product rules with concrete examples, including duplicate and refund cases.
2. Create the repository, environment templates, CI, database migration baseline, and decision log.
3. Build profile/auth and private tracker ownership controls before broad data ingestion.
4. Implement one complete contribution → evidence → human approval → credit → redemption slice using fixture-backed sources.
5. Prove credit concurrency, user isolation, and deadline precision in integration tests.
6. Add restricted live fetching and model extraction with a labeled evaluation dataset.
7. Add persistent reminders and exercise failures before users rely on deadlines.
8. Add approved-source discovery and ongoing rechecks using the same publication rules.
9. Run a closed concierge pilot; measure usefulness, trust errors, operations load, and cost.
10. Open beta only when the gates below pass.

### 25.2 Definition of done for a beta release

- End-to-end exchange works with truthful statuses and no hidden charge on failure.
- Canonical records retain provenance, field uncertainty, edition, and deadline precision.
- Duplicate races cannot double-mint; concurrent redemptions cannot overspend.
- Object ownership and operator role tests pass for APIs, database paths, and storage.
- Restricted fetching passes SSRF/redirect/subresource tests and has no application secrets.
- Matching excludes known ineligibility, stale/closed records, and unknown material hard constraints before debit.
- Deadline changes, user submission, quiet hours, retries, and notification uncertainty are tested.
- AI evaluation gates pass on the supported cohort; unsupported cohorts remain reviewed.
- Source registry has approved access policies and active stop switches.
- Database and object restore have been exercised; recovery limitations are documented.
- Monitoring, cost caps, reports, privacy export/deletion, support ownership, and incident runbooks are operational.
- Mobile and accessibility tests pass for the essential flows.
- Terms, privacy, age/access, source handling, and actual processor settings have been reviewed before real-user launch.

### 25.3 Documents to maintain during implementation

This master plan is the planning baseline. As implementation starts, maintain an executable schema/migrations, OpenAPI specification, data dictionary, ADR log, source registry, model/prompt registry, labeled evaluation dataset, threat model, deployment/runbook set, analytics event dictionary, and release checklist. They should reflect the actual build and test results rather than being copied placeholders.

**Current completion:** product and engineering planning. **Not completed:** user interviews, source audits, brand design, provider procurement, repository implementation, live tests, legal review, outreach, or deployment.

## 26. Research references

Official technical references checked on 3 November 2026. These support specific platform capabilities and security considerations; OCCASIO's product rules, architecture trade-offs, targets, timeline, and budget envelopes are proposed analysis. Provider documentation and capabilities can change; verify selected versions/settings during implementation. No direct vendor price quotes were used.

- **S1 — Next.js deployment:** https://nextjs.org/docs/app/guides/deploying-to-platforms — Node deployment capabilities and multi-instance considerations.
- **S2 — Supabase database overview:** https://supabase.com/docs/guides/database/overview — Managed PostgreSQL and related services.
- **S3 — Supabase Auth:** https://supabase.com/docs/guides/auth — Identity capabilities and authorization context.
- **S4 — PostgreSQL full-text search:** https://www.postgresql.org/docs/current/textsearch.html — Search, indexing, and ranking primitives.
- **S5 — pg-boss introduction:** https://pgboss.io/introduction — Durable PostgreSQL jobs, transactions, and at-least-once handling.
- **S6 — pg-boss queues:** https://pgboss.io/api/queues — Retry, backoff, and heartbeat controls.
- **S7 — pg-boss jobs:** https://pgboss.io/api/jobs — Job execution/retry lifecycle.
- **S8 — Supabase data security:** https://supabase.com/docs/guides/database/secure-data — Data API vs trusted server access and secret handling.
- **S9 — Supabase API security:** https://supabase.com/docs/guides/api/securing-your-api — Grants, schemas, policies, and disabling product Data API access.
- **S10 — PostgreSQL row security:** https://www.postgresql.org/docs/current/ddl-rowsecurity.html — Policy behavior and owner/BYPASSRLS exceptions.
- **S11 — RFC 9309:** https://www.rfc-editor.org/rfc/rfc9309.html — Robots Exclusion Protocol and its distinction from authorization.
- **S12 — OWASP prompt injection prevention:** https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html — Untrusted source content and tool permission boundaries.
- **S13 — Resend idempotency:** https://resend.com/docs/dashboard/emails/idempotency-keys — Supported idempotency requests and the documented retention window.
- **S14 — OWASP SSRF prevention:** https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html — Network destination validation and rebinding/redirect risks.
- **S15 — Supabase database connections:** https://supabase.com/docs/guides/database/connecting-to-postgres — Connection method selection.
- **S16 — Supabase backups:** https://supabase.com/docs/guides/platform/backups — Backup options and exclusion of Storage objects.

---

OCCASIO planning baseline v0.1 — ready for founder review and implementation breakdown.
