# Cloudflare deploy readiness — documentation + Phase 0 hardening

**Objective**: document the Cloudflare deployment plan in the README (including the local team workflow), then implement Phase 0 of that plan — server-side session authentication, CORS tightening, rate limiting, and security headers — so the API can be exposed publicly.

**Branch**: `feat/cloudflare-deploy-readiness` (from `main`)
**Delivery strategy**: `ask-on-risk` — work-unit commits of ~400 authored changed lines; the PR shape is the user's decision at the end.
**Test runner**: `npm test` (`node --import tsx --test`, 8 files, 37 tests) + `npm run lint` (`tsc --noEmit`)

## Specs

### S1 — Deployment plan documented in the README

The user asked: *"lo colocaras en el readme"*.

The README must gain a deployment section that a teammate can act on without asking questions. It must state the target architecture, the phased plan, the operational runbook, and the known constraints. Every command it shows must be real and match `package.json`.

**Acceptance**
- README has a top-level deployment section reachable from its table of contents.
- It names the concrete Cloudflare products used (Workers, Workers Static Assets, Cron Triggers, Workers Logs/Traces, custom domain) and the ones deliberately NOT used, with the reason.
- It states the verified platform limits that constrain the design (Workers Free 100k req/day + 10 ms CPU; Paid 5 min CPU; Cron 15 min wall time; Static Assets 25 MiB/file; Worker 64 MiB / 1 s startup).
- It carries the measured numbers from the current codebase (bundle 1.9 MB / 474 KB gzip; ~4.4 MB of PNG in `landing/`; poll = 2 endpoints per tick at 60 s live / 10 s degraded; 23 API routes; 0 authenticated; sweeper = all users at 500 ms spacing every 300 s).
- It documents the driver decision (`drizzle-orm/neon-http` over Hyperdrive + `pg`) with the reason: one HTTP round trip per query, no per-request connection setup, and no query cache that fails to invalidate on write.
- It documents the migration rule: Drizzle migrations run from Node in CI against `DATABASE_URL_UNPOOLED`, never from the Worker, and must be backward-compatible (expand/contract) because a code rollback does not revert the schema.
- It documents the secrets list, the environment split (staging/production, each with its own Neon branch and Dynamic environment), and the go-live checklist (Dynamic allowed origins, webhook re-registration, stable origin).
- It states that `VITE_PUBLIC_APP_URL` is build-time and that a runtime config endpoint is the Fase 1 replacement.

### S2 — The team can still deploy locally

The user asked: *"dejando tambien las opciones para que el equipo pueda desplegarlo localmente como equipo de trabajo se entiende?"*.

Local development must remain a first-class, documented path — not a casualty of the Cloudflare work. A teammate must be able to run the whole stack on their own machine without touching the production database.

**Acceptance**
- The README documents the two-process local model (`npm run api` + `npm run dev`) and the Vite `/api` proxy that makes it same-origin.
- It documents the tunnel-based preview for testing the payer flow from a second device, and states that the tunnel hostname changes on restart.
- It documents the per-teammate setup: own `.env.local` with their own Neon branch and their own Dynamic environment id, `npm run db:migrate` against that branch, and the `SWEEPER_DISABLED=1` escape hatch.
- It documents the "no public deployment without Phase 0" rule so nobody publishes the unprotected API by accident.
- It names the `audit:*` scripts as the team's end-to-end verification against a running local server.

### S3 — Phase 0: server-side session authentication

The user asked: *"una vez dejemos documentado en el readme comenzamos con la fase 0 eso tenemos que terminarlo cuanto antes"*.

Every API route that reads or writes a user's data must require a validated session, and the session — not a client-supplied parameter — must decide whose data is touched.

**Design constraints (verified against the installed SDK, `@dynamic-labs-sdk/client` v1.41)**
- The browser session credential is `client.token` (a getter over `state.token`). `useUser()` does NOT expose it.
- The credential is an RS256 JWT whose claims include `sub` (Dynamic user id), `sid`, `iss`, `aud`, `exp`, `environmentId`, `email`, `scope`, `blockchainAccounts[]` (`{address, chain}`) and `verifiedCredentials[]` (`{id, address, chain}`).
- Server validation is local RS256 verification against `https://app.dynamicauth.com/api/v0/sdk/{environmentId}/.well-known/jwks`. The scope claim must contain `user:basic` (whitespace-separated membership, not equality).
- The `users` table has no Dynamic column, so identity is resolved through the session's Solana address → `users.publicKey` → `users.id`. **No schema change and no migration.**

**Acceptance**
- A request without a session credential to a user-scoped route gets `401` and a JSON error body; it must not reach the database.
- A request with a valid session whose Solana address set does not contain the requested wallet gets `403`; it must not reach the database.
- A request with a valid session for wallet W may read and write W's data, and the user id is resolved from the session's own address, never from a client-supplied parameter alone.
- An expired, malformed, wrongly-signed, wrongly-issued, or wrong-environment token is rejected; the JWKS lookup is cached and refreshes when a signing key rotates.
- The public routes used by the payer flow (`/api/payment-links/by-reference/:reference`, `/api/payment-links/by-slug/:slug`, `/api/payment-links/claim`, `/api/landing/survey`) keep working without a session.
- The Dynamic webhook keeps working and is not affected by the session requirement.
- The verification is unit-tested with a locally generated RSA keypair and a locally signed token — no network, no database, no live Dynamic environment.

### S4 — Phase 0: CORS without a wildcard

`Access-Control-Allow-Origin: *` currently makes every other defect remotely exploitable from any page.

**Acceptance**
- No response carries a wildcard origin. The allowed origin list is explicit and comes from configuration.
- The `Authorization` header is allowed in preflight.
- A preflight from a disallowed origin is refused.
- The local Vite proxy and the documented tunnel origins keep working.

### S5 — Phase 0: rate limiting

`/api/payment-links/claim` performs up to 7 paced Solana RPC reads per call, so an unauthenticated caller can exhaust the shared RPC quota and make real users' balance reads fail with 429.

**Acceptance**
- A configurable limiter applies to the expensive and write routes.
- Exceeding the limit returns `429` with a JSON error body and a `Retry-After` header.
- The Dynamic webhook is exempt (it has its own signature verification and its own retry budget).
- The limiter is documented as per-isolate and therefore approximate, with the Cloudflare WAF rate-limiting rule named as the authoritative edge limit.

### S6 — Phase 0: security headers

Express sets no security headers. A wallet UI that requests transaction signatures must not be frameable.

**Acceptance**
- Responses carry `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` and `Strict-Transport-Security`.
- The CSP does not break the app: the Dynamic iframe, the Neon Realtime WebSocket endpoint, and the Solana RPC endpoint are explicitly allowed.

### S7 — The public identity endpoint stops leaking e-mail

`GET /api/wallet/identity` returns `{email, handle}` for any address. The payer page needs the merchant's display name, not their e-mail address.

**Acceptance**
- The endpoint returns the display name and no account e-mail.
- The payer flow still renders the merchant identity.

### S8 — Verification

**Acceptance**
- `npm run lint` (`tsc --noEmit`) passes.
- `npm test` passes, including the new Phase 0 tests.
- The new tests fail against the pre-change behaviour (RED) and pass after (GREEN), and that RED→GREEN evidence is recorded in this document.
- The `express.json` `verify` callback that preserves the raw body for the webhook HMAC is untouched; the webhook signature check still passes its existing test coverage.

## Tasks

| ID | Task | Specs | Route | Status | Commit |
|----|------|-------|-------|--------|--------|
| T1 | Document the deployment plan and the local team workflow in the README | S1, S2 | inline | done | `5c53aa3` |
| T2 | Extract the Express app so it can be tested; export `app`, guard `listen` | S3 | inline | done | `74d020f`, this commit |
| T3 | Session verification module (JWKS + RS256 + claims) with dependency injection | S3 | inline | done | `74d020f` |
| T4 | Session middleware: extract credential, resolve the user's Solana addresses, resolve `userId` | S3 | inline | done | `74d020f` |
| T5 | Apply the session requirement to every user-scoped route | S3, S7 | inline | done | this commit |
| T6 | Client sends the session credential; identity endpoint stops leaking e-mail | S3, S7 | inline | done | this commit |
| T7 | CORS allowlist, rate limiter, security headers | S4, S5, S6 | inline | done | `6c4d0b0` |
| T8 | Tests: RED→GREEN for the session gate, CORS, rate limit, headers | S3, S4, S5, S6, S7, S8 | inline | done | `74d020f`, `6c4d0b0`, this commit |
| T9 | Full suite + typecheck; work-unit commits; native review assessment | S8 | inline | done | this commit |

**Route note**: every task runs inline. No Writer trigger fires (no parallelism: one unit of behaviour; no context backstop: the parent already holds the full map from the exploration phase). The 4-file rule was satisfied by two read-only explorer delegations before this document was written.

## Log

### L1 — 2026-10-21
> "estamos listo para desplegar este sistema en cloduflare?"

### L2 — 2026-10-21
> "este despliegue es para una wallet en devnet para ir a buscar los primerosusuarios lo que busco seguridad, rapidez y eficiencia antes de ejecutar codigo, analiza bien como se desplegaria esto respecto a casos de usos reales y enginners en dev ops"

### L3 — 2026-10-21
> "lo colocaras en el readme y posterior a ello preparemos para desplegar, pero dejando tambien las opciones para que el equipo pueda desplegarlo localmente como equipo de trabajo se entiende? una vez dejemos documentado en el readme comenzamos con la fase 0 eso tenemos que temrinarlo cuanto antes ... utilizaremos odd para aplicar eso lo necesito sin cometer errores, siendo un senior enginner software con conocimientos en web3 seguridad devops y producto + funcionamiento ... lo podemos lograr vamos por ello!"

### Analysis — deployment assessment (2026-10-21)

**Verdict**: the application is eligible for Cloudflare; the blocker is not the platform. The API has zero authentication, so it cannot be exposed publicly on ANY host until Phase 0 lands.

**Evidence gathered**
- `npm run lint` clean, `vite build` succeeds, `npm test` = 37/37 pass.
- 23 routes in `server.ts`; `app` is not exported and `app.listen` runs at module scope (`server.ts:903`), so the app cannot be imported by a test today.
- Every user-scoped route resolves the caller from a client-supplied `wallet` query/body field via `getUserIdByPubkey` / `getUserByPubkey`. No ownership proof anywhere except `POST /api/wallet/transactions/pending` (signature ownership, `server.ts:361`).
- CORS is `Access-Control-Allow-Origin: *` (`server.ts:119-124`); Express sets no security headers.
- `POST /api/payment-links/claim` (`server.ts:702`) performs up to 7 paced Solana RPC reads — the amplification vector.
- `GET /api/wallet/identity` (`server.ts:613`) returns the account e-mail with no ownership check.
- `POST /api/payment-links` (`server.ts:472`) accepts the recipient wallet from the body → impersonation vector.
- The Dynamic webhook (`server.ts:144`) fails closed when `DYNAMIC_WEBHOOK_SECRET` is unset, and its HMAC depends on the `express.json` `verify` callback preserving `req.rawBody` (`server.ts:108-115`).
- No key custody on the server: `src/adapters/token.ts` derives an ATA (a PDA), it does not sign. `better-sqlite3` appears only in `src/scripts/migrateTransactionsFromSqlite.ts`, never in the request path.
- Neon Realtime is browser-direct: the server only seals a short-lived capability (`src/services/realtimeServer.ts`), so no server-side WebSocket is required.
- No `users` row is created anywhere in this repository; registration lives outside it. This is why Phase 0 resolves identity through the session's Solana address instead of adding a `dynamicUserId` column.

**Platform constraints that shape the plan (verified against Cloudflare docs, 2026-10)**
- Workers Free: 100k requests/day, 10 ms CPU/request, 50 subrequests, 6 simultaneous open connections. Paid: $5/month base, 5 min CPU (30 s default).
- Cron Trigger: 15 min wall time; 30 s CPU when the interval is under one hour, 15 min when it is one hour or more.
- Static Assets: 25 MiB per file, 100k files. Worker: 64 MiB, 1 s startup.
- Request math for this app: the poll is 2 endpoints per tick → 120 req/h/user with Realtime healthy, 720 req/h/user degraded. Free tier ≈ 833 user-hours/day healthy, ≈139 degraded. If Realtime breaks with 15+ concurrent users, the account hits Error 1027.
- Sweeper math: `syncAllWallets(500)` scans every user with 500 ms spacing every 300 s → ~50 s + RPC at 100 users, ~8–12 min at 1000 users. It does not fit a Cron Trigger at scale and needs a batch cursor.

**Decisions taken**
1. Target runtime: Cloudflare Workers + Workers Static Assets, Neon over HTTP (`drizzle-orm/neon-http`), Cron Trigger for the sweeper, custom domain for a stable origin. Not Containers: the app is already effectively stateless and the only stateful piece is a job.
2. Driver: `neon-http` over Hyperdrive + `pg`. Hyperdrive requires creating the client inside the handler (the current module-level `new Pool()` in `src/db/index.ts` would have to move), and its query cache does not invalidate on write — unacceptable for a live ledger.
3. Phase 0 identity: validate the Dynamic JWT locally against JWKS, then resolve the user through the session's Solana address. No schema change, no migration, no dependency on the external registration path.
4. JWT verification uses `jose` rather than hand-rolled crypto. A hand-rolled RS256 verifier is exactly the kind of code that produces CVEs.
5. Phase 0 keeps the payer flow public. A payer may not be signed in; `/api/payment-links/by-*` and `/api/payment-links/claim` stay open and are protected by the on-chain verification, not by a session.

**Explicit non-goals for this work unit**: the Workers port itself (Fase 1), the Cron/sweeper cursor, `wrangler.toml`, CI, the custom domain, and the actual deployment. Those are documented in the README and planned, not implemented, in this change.

### Progress — 2026-10-21 (work unit 1)

- **T1 done.** The README gained a `## Deployment` section (+287 lines) between `## Scripts` and `## Known limitations`. It covers: why the target is a Worker (the table of the serverless-hostile things this app does *not* have), the target shape diagram, the Cloudflare products used and the ones deliberately not used, the phase plan with Phase 0 marked in progress, the Phase 0 threat model, the local team workflow (per-teammate Neon branch, Dynamic environment, sweeper off, tunnel, the `audit:*` scripts), the Cloudflare runbook (environments, secrets, driver decision, migrations in CI, observability, rollout, go-live checklist), the platform limits with this repository's measurements, and the operational runbook. `## Roadmap to beta` gained item 9 pointing at it.
- The API table in the README still describes the pre-Phase-0 surface. It is updated with the Phase 0 commit, not this one, so the documentation never claims a protection that is not in the tree yet.
- **Engram mirror pending.** `mem_save` for this document failed twice with "could not confirm Engram session registration". The Engram server itself is healthy (`mem_doctor` reports 9/10 checks ok; the single error is an unrelated `sync_target_closed_space` finding for other projects). The file is the source of truth; the mirror is retried in the next work unit.

### Progress — 2026-10-21 (work unit 2 — Phase 0)

**T2–T8 done. Risk: item 2** (the API now authenticates its callers; the failure mode of a wrong gate is locking a user out of their own wallet, not a leak).

**What changed**

| File | Change |
|---|---|
| `src/server/security/dynamicSession.ts` | RS256 verification against Dynamic's JWKS, environment binding, `user:basic` scope, Solana address collection |
| `src/server/security/session.ts` | `requireSession` (401), `requireOwnedWallet` (400/403), token extraction from the bearer header or a JWT-shaped cookie |
| `src/server/security/cors.ts` | origin allowlist with one wildcard host label; wildcard `*` removed |
| `src/server/security/rateLimit.ts` | sliding-window limiter keyed on `CF-Connecting-IP` |
| `src/server/security/headers.ts` | CSP with `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS |
| `src/server/security/index.ts` | the barrel |
| `server.ts` | the security layer, 13 gated routes, the identity endpoint, the rate limits, `app` exported, `listen` guarded |
| `src/services/walletApi.ts` | sends `client.token` as a bearer credential; `WalletIdentity` no longer has an `email` |
| `src/components/WebPaymentPage.tsx` | shows the merchant's `handle` instead of their e-mail |
| `package.json` | `jose` dependency; the new test files in the `test` script |

**RED evidence (the base commit, `main` at `12dde60`)**

The base server was started from a detached worktree and probed with a
**real** registered pubkey. The response was `HTTP 200` with the user's full
profile — `id, name, handle, email, phone, avatarBg, avatarEmoji, country,
publicKey, walletAddress, language, balanceUsdc, balanceSol, kycStatus`,
plus `balance`, `transactions` and `contacts` — with
`Access-Control-Allow-Origin: *` and **no** `X-Frame-Options`, **no**
`Content-Security-Policy` and **no** `X-Content-Type-Options`. The response
carried `X-DB-Queries: 4`: the request reached the database.

**GREEN evidence (this branch)**

| Probe | Base | Now |
|---|---|---|
| `GET /api/wallet?wallet=<real pubkey>`, no session | `200` + full profile, 4 DB queries | `401 {"reason":"missing_token"}`, **0 DB queries** |
| Same, with a bogus bearer token | `200` + full profile | `401 {"reason":"malformed_token"}`, 0 DB queries |
| `GET /api/wallet/identity?address=not-base58` (public) | `400` | `400` (still reachable — not gated) |
| `Origin: https://evil.example` | `Access-Control-Allow-Origin: *` | no allow-origin header |
| `Origin: http://127.0.0.1:3000` | `Access-Control-Allow-Origin: *` | `Access-Control-Allow-Origin: http://127.0.0.1:3000` + `Vary: Origin` |
| Security headers on every response | none | CSP (`frame-ancestors 'none'`), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS in production |

**Test suite**: `npm test` → **102 tests, 102 pass, 0 fail** (37 before, 65
new). `npm run lint` (`tsc --noEmit`) → clean. The new tests are hermetic:
the RSA key pair is generated in the test, the token is signed in the test,
the key set is local, and the integration test never reaches the database.

**Bugs found and fixed while writing the tests** (all were mine, all caught by
the suite before the commit):

1. `originMatches` split the whole origin on `*`, so a wildcard in the *host*
   never matched. It now splits scheme, host and port, and matches the host
   label.
2. The environment check accepted a token whose `environmentId` claim named
   another environment, because the issuer check rescued it. The claim is
   now strict when it is present.
3. Two test helpers destructured the recorded status code, capturing it
   before the middleware ran — so a 204 and a 429 both read as 200. The
   helpers return a live recorder now.
4. The integration test left the Postgres pool open, so the test process
   never exited and `npm test` hung. The test now touches no database at all.

**Not done in this work unit** (and why)

- The `users` table is unchanged and no migration ran: the session carries
  the Solana address, and that address is what the ledger is keyed by.
- The Dynamic webhook is untouched, and its HMAC still reads the raw body
  captured by the `express.json` `verify` callback.
- The CSP is asserted by tests but has **not** been validated in a browser
  against the live Dynamic iframe. That is a go-live checklist item, not a
  claim this change makes.
- The JWKS is fetched live in production. The environment binding and the
  scope check are verified against a local key set; the live JWKS endpoint
  has to be confirmed in staging.

### Progress — 2026-10-21 (work unit 3 — native review and corrections)

**The native review ran on the whole Phase 0 range** (`5c53aa3..fc54bec`),
risk `high`, four lenses (risk, resilience, readability, reliability), with the
user's explicit consent. The first pass was refused twice on the readability
lens: once for citing three line ranges in a single `location` field, once
for narrating instead of emitting the JSON. The third attempt was admitted.

**Result**: 3 findings corroborated, 1 escalated with unknown causality, the
rest refuted. The native transaction ended in `stop` /
`native_stop_required` with the action *informational* — delivery stays a
human decision, but the corroborated findings are real defects in this
change, so they were fixed.

| Finding | Severity | Disposition | Fix |
|---|---|---|---|
| R2-005 — `isForEnvironment` matched the issuer by **substring**, so an environment whose id *contains* ours (`env-1` vs `env-12`) would have been accepted | corroborated | security | The claim is compared exactly; the issuer is compared by its **last path segment**, exactly; a token that names no environment is rejected |
| R4-1 — a JWKS fetch failure answered `401` to every logged-in user, which reads as "your session expired" and triggers a re-login storm | corroborated | resilience | New `src/server/security/jwks.ts`: the key set is cached for 10 minutes, **keeps working for a day after a failed refresh**, and a cold isolate raises `SessionUnavailableError` → the API answers **503 `auth_unavailable`**, not 401 |
| R4-2 — the rate limiter's `prune()` scanned the whole table on every request once it was over the cap, so a flood of unique callers turned one request into an O(n) sweep | corroborated | DoS | The global prune is gone. The table is evicted least-recently-seen first, and the eviction is amortized: a request removes what it added, never the whole table |
| R2-002 — four rate-limit tiers used unexplained magic numbers (10/30/60/120) | escalated, causality unknown | readability | The tiers are named constants and each one carries the reason for its value (what the route *costs*, not what it returns). The finding was filed CRITICAL by a readability lens; by the severity rules it is at most WARNING — no observable harm, no regression — but the point is fair and cheap to honour |

Also honoured from the non-blocking readability findings, because they were
cheap and correct: the `BASE58_RE` rule now lives in one module
(`src/server/security/address.ts`) instead of three copies; the middleware's
doc comment described the check order backwards and now states the real one
(authenticate → parse the address → check ownership); the client's
`sessionToken()` reports a missing Dynamic client once instead of swallowing
it silently; and the CSP's `style-src 'unsafe-inline'` weakening is now
stated in the README instead of hiding in a comment.

**After the corrections**: `npm test` → **113 tests, 113 pass, 0 fail** (65
new since the base, 76 since Phase 0), `npm run lint` → clean. The three new
tests that pin the corrections: a sibling environment whose id contains ours
is rejected, a failed JWKS refresh keeps serving the cached key set, and a
session service that is down answers 503 rather than 401.

### Progress — 2026-10-21 (work unit 4 — the review of the corrections)

The correction batch was reviewed too, with the user's explicit consent and
the same four lenses. The reviewer was refused twice before it landed (a
citation with three ranges in one field, then a capture whose `subject_hash`
did not match the provider's — my own error, the transport caught it).

**Result**: 1 corroborated, 2 escalated as inconclusive, 5 advisory.

| Finding | Severity | Disposition | Fix |
|---|---|---|---|
| R3-002 — the new JWKS resolver dropped the 5-second fetch timeout the baseline resolver had, so a hanging endpoint holds the request open | corroborated | resilience | The fetch is bounded by an `AbortController` with the same 5-second limit, and the timeout is configurable |
| R3-001 / R4 — removing the global prune also removed the release of **idle** callers' timestamps | escalated, causality unknown | memory | `pruneExpiredCallers()` is back as a **bounded** sweep: it walks at most 64 entries and stops at the first live one, because the table is ordered least-recently-seen first. A caller that stopped calling no longer holds its timestamps for the life of the process, and a request still never scans the whole table |
| R2-JWKS-UNEXPLAINED_CONSTANTS | WARNING | readability | The three windows now carry the reason for their value: 10 minutes to avoid a fetch per request, a day so an outage does not take the app down, 30 seconds so an outage costs one failed fetch per half-minute instead of one per request |
| R2-JWKS-COMPLEX_STATE | WARNING | readability | `lastSuccessAt` was always equal to `fresh.at`; it is gone, so the resolver keeps one clock instead of two |
| R2-RATELIMIT_EVICTION_COMMENT | SUGGESTION | readability | The comment said "a request removes at most the entries it added", which was not true; it now says what the loops actually do |
| R2-DYNAMIC_SESSION_ENV_GUARD | SUGGESTION | readability | A missing environment id is a misconfiguration, not a rejected credential, so it is now logged once instead of failing every session quietly |
| R2-WALLET_API_WARNING_STATE | SUGGESTION | readability | The one-shot client warning re-arms when the client becomes available, so a late-initialising SDK still gets reported if it fails later |

**After the second round**: `npm test` → **117 tests, 117 pass, 0 fail**,
`npm run lint` → clean. Four new tests pin the new behaviour: a hanging key
set is abandoned, the sweep releases the idle callers, the sweep stops at the
first live caller, and the sweep is bounded.

### Progress — 2026-10-21 (work unit 5 — the third review, and the last one)

The second correction batch was reviewed a third time, with the user's
consent. **This was the last review round of this work unit**: after it, only
a real blocker moves the code, and the rest is documented rather than chased.

**Result**: 1 corroborated (CRITICAL), 2 WARNING, 4 SUGGESTION.

| Finding | Severity | Fix |
|---|---|---|
| R3-001 — `fetchTimeoutMs` was not validated, so a zero or a negative value aborted every fetch and made the resolver report the session service as unavailable forever: a misconfiguration that looked like a total authentication outage | corroborated | The timeout is raised to a floor of 100 ms, and a non-finite value falls back to the default. The fetch is also raced against the timer, so a fetch that ignores the abort signal cannot hold the request open either |
| R2-001 | WARNING | The sweep cap now says why it is 64: the sweep stops at the first live entry, so it walks one or two entries in practice |
| R2-002 | WARNING | The "bounded twice over" comment was wrong — the sweep is best-effort and runs after the eviction. It now says that |
| R2-003 / R2-004 / R3-003 / R3-004 | SUGGESTION / WARNING | One pattern for both warnings: report once per process, and never re-arm. The two modules said it the same way, and the serverless granularity is now documented instead of accidental |
| R3-002 | WARNING | `pruneExpiredCallers` is no longer part of the public barrel, and its precondition — the map is ordered least-recently-seen first — is documented |
| R3-005 | SUGGESTION | The sweep stops at the first live entry, so the cost in practice is one iteration, not 64. Now stated in the comment |
| R3-006 | SUGGESTION | Two new tests: a fetch that ignores the abort signal still loses the race, and a timeout below the floor is raised instead of aborting every fetch |

**After the third round**: `npm test` → **119 tests, 119 pass, 0 fail**,
`npm run lint` → clean.

### Progress — 2026-10-21 (work unit 5 closed — the review is approved)

The corrected candidate was recovered into a fresh lineage (the commit had
been amended, so the provider authorised a `scope_changed` recovery) and
reviewed with the four lenses. **Result: approved**, and the acknowledgement
burned the authority (`gentle-ai.review-acknowledged/v1`, `authority: burned`).

Five advisory findings came back as **informational** — they open no
correction, they do not reopen the review, and the provider says so
explicitly: *"Treat them as separate later work, never as a reason to re-run
review on this candidate."* They are listed here so they are not lost:

| Finding | Severity | Note |
|---|---|---|
| R2-RATELIMIT_SWEEP_COMMENT | WARNING | The comment says both loops "remove what the table grew"; the sweep is capped at 64, so it may leave expired callers behind when there are many. The wording overstates it |
| R3-001 | WARNING | `fetchTimeoutMs` has no **upper** bound: an enormous value effectively disables the timeout |
| R3-002 | WARNING | `pruneExpiredCallers` is exported and its correctness depends on the least-recently-seen ordering, which is not checked at runtime |
| R3-003 | SUGGESTION | The timeout error reports the adjusted value, so a caller that passed `0` sees "100ms" |
| R3-004 | SUGGESTION | `pruneExpiredCallers` is exported mainly for testing; it could stay internal |

**The work unit is closed.** `npm test` → **119 tests, 119 pass, 0 fail**;
`npm run lint` → clean; the native review is approved and acknowledged.

### Where the whole change landed

| Commit | What |
|---|---|
| `5c53aa3` | the deployment runbook and the local team workflow in the README |
| `74d020f` | the Dynamic session verification and the wallet gate |
| `6c4d0b0` | the CORS allowlist, the rate limiter and the security headers |
| `fc54bec` | the wiring: 13 gated routes, the identity endpoint, the client credential |
| `84be1ce` | the first corrections: the exact environment binding, the cached key set, the amortized eviction |
| `558230a` | the second corrections: the bounded fetch, the idle-caller release |

**What is NOT done, on purpose**: the Workers port itself (Fase 1), the Cron
sweeper with its batch cursor, `wrangler.toml`, CI, the custom domain, and
the deployment. Those are documented in the README and planned. The advisory
findings above are later work, not a reason to re-run this review.

**Engram mirror: pending.** `mem_save` failed three times in this session
with "could not confirm Engram session registration". The Engram server
itself is healthy (`mem_doctor`: 9/10 checks ok, and the one error is an
unrelated `sync_target_closed_space` finding for other projects). This file
is the source of truth and it is committed; the mirror is retried whenever the
session registration recovers.

---

# Work unit 6 — production readiness

The user asked for a final, complete pass over everything discovered, so the
next phase goes straight to deploying the first prototype: fix or mitigate
every defect, optimize the code and the repository, and leave the launch
blockers written down.

## Specs

### S9 — A new user gets a ledger row

The application has **no path that creates a `users` row**. The table has two
rows, both seeded by hand. A user who signs in with Dynamic gets a Dynamic
wallet, and then:

- `GET /api/wallet` resolves the wallet to a user id and finds nothing →
  `404 "No wallet data is available"`.
- The `wallet.activity` webhook for that address finds no registered wallet →
  the movement is not projected, so **the payment never appears**.

The README asserts the opposite ("the `users` row is created on first
Dynamic login"). That claim is false in this repository, and it is the single
biggest reason the app would look broken to every user who is not one of the
two seeded rows.

**Acceptance**
- A session-verified endpoint creates the row on the caller's first sign-in,
  with `publicKey` taken from the **session** and never from the request body.
- It is idempotent: calling it again refreshes the mutable profile fields
  instead of failing.
- The `handle` is unique (`uk_users_handle`), derived from the Dynamic
  profile, and disambiguated deterministically when it collides.
- The client calls it once the session and the Solana wallet are both
  available, and a failure is visible rather than silent.
- The webhook's "no registered wallet" outcome is recorded honestly instead
  of being marked as a successful projection.

### S10 — The money paths hold up

**Acceptance**
- A payment link only settles on a transaction that is `confirmed` or
  `finalized`; a merely `processed` transaction is retried, not rejected as
  a mismatch.
- The webhook rejects a transfer amount that is not a positive, finite,
  bounded number.
- A webhook delivery that was not projected stays reprojectable: the
  `messageId` dedupe distinguishes "already processed" from "already seen",
  so a redelivery after a failure converges.
- `/api/payment-links/claim` refuses an expired link.
- `GET /api/wallet` reports the balance read from the chain, not from a
  column the server never writes.

### S11 — The repository is clean and the documentation is true

**Acceptance**
- The five advisory findings from the review are resolved: the fetch timeout
  has a maximum, the sweep comment says what the sweep does, the timeout
  error names the value the caller passed, and the exported sweep helper
  documents its precondition (and stays out of the public barrel).
- The service exports with no importer are removed, and the unused import in
  `server.ts` is gone.
- Every comment, doc comment and README claim that contradicts the code is
  corrected.
- `package.json` carries the metadata a real project carries: name, version,
  description, license, repository, engines.
- The two copies of the base58 rule cannot drift apart: a contract test
  pins the server's rule to the adapter's.

### S12 — The launch blockers that are not code are written down

**Acceptance**
- The README's go-live checklist names the RPC provider, the Dynamic
  origins and webhook, the stable origin, and the privacy notice, with what
  each one blocks.

## Tasks

| ID | Task | Specs | Route | Status |
|----|------|-------|-------|--------|
| T10 | Provision the user row on the first sign-in | S9 | inline | pending |
| T11 | Harden the three money paths | S10 | inline | pending |
| T12 | Clean the repository and make the docs true | S11 | inline | pending |
| T13 | Write down the non-code launch blockers | S12 | inline | pending |
| T14 | Final native review of the whole feature | S9–S12 | inline | pending |

## Log

### Analysis — 2026-10-21 (the read-only audit)

A read-only audit of the three money/identity paths and the repository
hygiene returned two further **CRITICAL** findings that the security review
had not reached, because it had only covered the Phase 0 surface:

1. **A webhook delivery whose projection found no registered wallet was
   marked processed.** The `messageId` dedupe is permanent, so the movement
   was dropped from the webhook path for good, with only the sweeper as a
   recovery route.
2. **The projection has no database transaction.** A failure after the
   transaction upsert left a committed row, an unwritten notification, and a
   delivery already consumed.

Plus: `confirmTransferToRecipient` settled a transaction that was only
`processed` (never `finalized`); the webhook accepted any numeric amount;
`/api/wallet` reported a balance from a column the server never writes (so
it was permanently zero); an expired link could still be claimed; and
`referenceId` collapsed two same-symbol movements in one transaction.

**Decisions taken**

- The projection is made **reprojectable** instead of transactional. The
  ledger upsert and the link settlement are already idempotent, so making
  the delivery dedupe distinguish "processed" from "seen" lets Dynamic's own
  redelivery converge a failed projection. Threading a transaction executor
  through four write functions in the same PR as a provisioning change would
  put more risk in the ledger than the defect it removes. **This is a known,
  documented gap with a Fase 1 follow-up**, not a silent one.
- The `referenceId` format is **not** changed. The webhook and the sweeper
  must build the same key or the send-time `pending` row and the projection
  would address different rows. A rare double-transfer of the same symbol in
  one transaction is documented instead.
- The duplicated base58 rule is held together by a **contract test**, not by
  a refactor across the client/server boundary.
- `GET /api/wallet` keeps its shape and reads the balance from the chain, so
  there is one source of truth for money.







