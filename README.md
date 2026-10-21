# ReWallet — USDC payments on Solana

ReWallet is a consumer payments app for **USDC on Solana**: create an account
with an email, get a wallet, and move money with the flows people already know —
**cobrar** (charge with a QR/link), **pagar** (pay a request), **depositar**
(receive), and **retirar** (send out). No seed phrases, no browser extensions:
the wallet is embedded and the account is an email one-time code.

This repository is the working prototype: a React + TypeScript mobile-first UI,
an Express API with a **PostgreSQL ledger on Neon**, and a Dynamic.xyz webhook
pipeline that turns on-chain movements into balances, history, and
notifications. Live updates ride **Neon Realtime** (logical replication over
WebSocket): the database tells the UI *when* to look, and the chain still tells
it *how much*. Everything runs against **Solana devnet** (test tokens, no real
value).

> **Status:** hackathon prototype of a consumer payments app, running end to
> end on **Solana devnet** against real infrastructure — Dynamic embedded
> wallets, a PostgreSQL ledger on Neon, and live row changes over Neon
> Realtime. Sign-up, charging, paying, depositing, withdrawing, history,
> receipts, notifications and balances all work; a background sweeper
> reconciles any movement the webhook missed. The in-app survey is collected
> but not persisted yet — see [Roadmap](#roadmap-to-beta).
>
> A public landing page lives in [`landing/`](landing/): the product story,
> live Dynamic metrics, FAQ, and a **"Quiero ser partner"** call to action
> that books a courtesy meeting.

---

## Product features

### Cobrar — Accept USDC with a QR or link

The merchant sets an amount and a concept, and gets a shareable payment page
plus a QR that encodes it. No transaction is signed to create a charge.

**User flow**

1. Transfer → **Cobrar por QR**.
2. Enter the amount to charge (keypad) → **Continuar a Detalles**.
3. Optionally add a concept ("Honorarios diseño…") → **Confirmar**.
4. The screen renders the **QR card** (white card with amount and concept),
   the **web link**, and share buttons (**Copiar Link**, **WhatsApp**).
5. The cross on the generated QR returns straight to home.

**How it is built**

| Step | Code |
|------|------|
| Amount + concept form, QR render, link + share UI | `src/components/TransferFlow.tsx` (`link_amount` → `link_details` subflows) |
| Payment URL construction (`/pay?recipient&mint&cluster&amount&message`) | `src/services/webPaymentLink.ts` |
| QR rendering | `src/adapters/solana-pay.ts` (`chain.renderQrDataUrl`) |
| Payment page route | `src/components/WebPaymentPage.tsx` (mounted at `/pay`) |

The link is **self-contained** — it carries the request in its own query
params, so charging works without server-side link storage. A deployed host
must rewrite `/pay` to the SPA entry point over HTTPS.

### Pagar — Pay a request from a link or QR

The payer opens the link (or scans the QR), signs in with their own ReWallet
account, reviews the request, and signs the USDC transfer with their embedded
wallet.

**User flow**

1. Open the link / scan the QR → `/pay`. **The page is public**: a payer
   opens it on another device, without an account, and sees the request —
   never a login wall. To pay, the page asks for an email code inline and
   creates the payer's embedded wallet on the spot.
2. The page shows: **Pagar a** (the collector's registered email, falling back
   to a shortened address), **Cadena/Moneda** (`Solana/USDC`), and the amount —
   a centered **USD {amount}** figure for fixed charges, an input for
   merchant-defined free amount.
3. The payer's live USDC balance is displayed; paying more than the balance or
   paying yourself is blocked.
4. **Pagar** → the wallet signs via Dynamic and submits to Solana.
5. Both sides see the movement: the payer as a completed send, the collector
   through the webhook pipeline (history + in-app notification).

**How it is built**

| Step | Code |
|------|------|
| URL parsing → typed `WebPaymentIntent` | `src/services/webPaymentLink.ts` |
| Payment page UI, balance check, self-payment guard | `src/components/WebPaymentPage.tsx` |
| Collector identity (email) | `GET /api/wallet/identity` (`src/services/walletApi.ts`) |
| Cluster alignment + signing | `chain.ensureDynamicNetwork()` → Dynamic `transferAmount()` |
| Confirmation for the collector | `POST /api/webhooks/dynamic` → `src/services/webhookIngestor.ts` |

### Depositar — Receive USDC into your wallet

Every account owns a Solana address. The deposit screen shows it as a QR and
as text with a copy button; sending USDC to it on the configured network is
enough. The balance updates automatically once the network confirms — there is
no manual refresh button.

**How updates arrive**

1. The Dynamic webhook reports the incoming movement for the registered wallet.
2. A periodic **sweeper** (`src/services/historySync.ts`, every 2 minutes by
   default) backfills anything the webhook missed, by reading confirmed
   on-chain history for the wallet's addresses.
3. `GET /api/wallet/balances` serves the balance from a 15-second server cache
   over a **paced** RPC budget (one in-flight request, 400 ms spacing) — the
   UI never hammers the public RPC.

**Code:** `src/components/DepositFlow.tsx`, `src/services/balanceCache.ts`,
`src/services/historySync.ts`.

### Retirar — Send USDC to any Solana address

The user enters an amount, picks a destination, and signs. Same signing path
as paying a request, but the destination is typed, pasted, scanned from a QR,
or chosen from recent recipients — never yourself (self-transfers are blocked
at every entry point).

**User flow**

1. Home → **Retirar**.
2. Amount: keypad + a **0 → MAX slider** (drag or tap MAX). Over-balance is
   blocked with "Balance insuficiente".
3. Destination: paste an address (**Pegar**), scan a QR (**ScanLine**, address
   mode), or pick a recent recipient. Your own wallet never appears in the
   list.
4. **Enviar** → Dynamic signs and submits; the transaction appears as
   *pending* immediately from the local ledger, and the webhook flips it to
   *completed* with a notification.

**Code:** `src/components/WithdrawFlow.tsx`,
`src/components/QrScannerFlow.tsx` (`mode="address"`),
`POST /api/wallet/transactions/pending`.

### Encuesta — Conocernos en 30 segundos

The home screen carries a short, anonymous survey: four questions about what
the user does with their dollars today, what stops them from using crypto
wallets, and how much they would move in the first month. It is the fastest
way to learn who the product is for — and it runs where the user already is:
one tap on the home card, one screen, done.

**User flow**

1. Home → the **ANONYMOUS** card (*Tell us about you & your needs*).
2. Tap **Answer** → the four questions open on a single scrollable screen —
   no wizard, no page turns. Q1 and Q3 take one option, Q2 accepts several,
   Q4 is optional.
3. **Send answers** → a thank-you state. The card stays enabled, so the
   survey can be answered again without reloading the app.

**How it is built**

| Step | Code |
|------|------|
| Answer keys, required questions, wire payload | `src/services/survey.ts` |
| Home card + single-screen sheet | `src/components/HomeSurveyCard.tsx`, `src/components/HomeSurveyModal.tsx` |
| ES/EN copy | `src/i18n/surveyCopy.ts` |
| Storage | `POST /api/landing/survey` → `landing_survey_responses` |

The answers belong to the account that is already signed in — the email comes
from the session, the user never types it — but the survey never touches the
balance, the wallet address, or the transaction history. The payload is
already shaped exactly like the endpoint body, so turning persistence on is a
single call inside `submitSurvey()`.

> **Not persisted yet.** The prototype collects and validates the answers in
> the UI; `submitSurvey()` logs the payload instead of posting it. The
> endpoint and the table are already in place.

### Also in the app

| Feature | Where | Notes |
|---------|-------|-------|
| **Transferir (P2P)** | `TransferFlow` | Same send path to contacts/recent recipients, with a note field |
| **Notificaciones** | `NotificationsView` + `GET /api/wallet/notifications` | Fed by the webhook (sent/received movements); unread badge in the header |
| **Comprobante (receipt)** | `TransactionReceiptModal` | Cadena/Moneda, Emisor/Receptor by **email**, explorer link, download/share |
| **Actividad** | `AllTransactionsModal` | Full history from the local ledger (RPC fallback) |
| **Perfil** | `SettingsView` | Email, wallet, language toggle (ES/EN), logout pinned at the bottom |
| **Onboarding** | `DynamicAccountGate` | Email OTP + language picker; embedded Solana wallet created by Dynamic |
| **Reportar un problema** | `BugReportButton` + `BugReportSheet` | Floating entry on every screen: describes the issue and opens a pre-filled GitHub issue (title, body, `bug` label) with the build, platform, network and wallet attached |

### The landing metric strip

The landing proves the product with numbers instead of adjectives, and every
number comes from a source that can be checked:

| Metric | Source | How it is counted |
|--------|--------|-------------------|
| Transacciones | ledger | Distinct on-chain movements (`reference_id`), not rows |
| Volumen | ledger | USDC moved, counted once per movement |
| Billeteras creadas | Dynamic | `wallets.allTime` |
| Tasa de éxito | ledger | completed / (completed + failed) |
| Tiempo de operación | ledger | webhook received → movement projected |

Two counting rules matter, and both were verified against the data. A
transfer is stored **twice** (the sender and the receiver share the
`reference_id`), so the volume is computed over distinct movements — summing
the raw table would double every transfer. And `confirmed_at` is the
*chain's* timestamp, not the moment the app learned about the movement, so
the settlement time is measured on the webhook pipeline instead.

`GET /api/landing/metrics` serves both sources in one payload — Dynamic's
topline plus the ledger counters — cached in process and snapshotted in the
database, so a database hiccup never puts zeros on a public page.

---

## Quick start

```bash
npm install --legacy-peer-deps
cp .env.example .env.local   # then set the variables below
npm run api                  # API + webhook server on :3001 (keep this terminal open)
npm run dev                  # UI on :3000
```

Apply the schema once before the first API start:

```bash
npm run db:push
```

Open **http://127.0.0.1:3000**.

### Package manager

**npm is the only supported package manager.** `--legacy-peer-deps` is
required: `@ecies/ciphers@0.2.6` requires `@noble/ciphers@^1.0.0` while
`@dynamic-labs-wallet/forward-mpc-shared` needs `^0.4.1`; the explicit
`@noble/ciphers: 1.3.0` devDependency satisfies the former at the root and npm
nests `0.4.1` under the latter. Do not "clean this up". `npm ci` works from a
clean checkout. `npm ls` reports one `invalid` optional peer (`esbuild` between
Vite and `drizzle-kit`) — expected and harmless; Vite 8 builds through
rolldown.

### Dynamic setup (required)

1. In the [Dynamic Console](https://console.dynamic.xyz/): enable **Email**
   login, the **Solana/SVM** chain, and **Embedded Wallets** for Solana. Add
   `http://127.0.0.1:3000` to allowed origins.
2. Set `VITE_DYNAMIC_ENVIRONMENT_ID` in `.env.local`.
3. **Point Dynamic's devnet network at `https://api.devnet.solana.com`.** The
   bundled "devnet" entry ships with no public endpoint; if left empty,
   Dynamic may resolve it to an SVM L2 (e.g. Eclipse) while this app reads
   Solana devnet — the mismatch only surfaces at signing time as
   `Attempt to debit an account but found no record of a prior credit`.
   Hard-reload the browser after changing it.

| Cluster | Genesis hash |
|---------|--------------|
| devnet | `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` |
| mainnet-beta | `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` |
| Eclipse | `EAQLJCV2mh23BsK2P9oYpV5CHVLDNHTxYss3URrNmg3s` |

4. Create a **webhook** in the Dynamic console pointing to
   `POST /api/webhooks/dynamic` on your API, and copy its signing secret to
   `DYNAMIC_WEBHOOK_SECRET`. Without it, balances and history still work via
   the sweeper, but confirmations and notifications are delayed.

Users must exist in the local `users` table (seeded) for the webhook to
project their movements — see [Known limitations](#known-limitations).

### Realtime and the network

The push channel rides a **WebSocket to Neon's Realtime socket**, and that
socket is reached over **IPv4 or IPv6**. A network that resolves the host to
an IPv6 address it cannot route to will refuse the WebSocket
(`NS_ERROR_WEBSOCKET_CONNECTION_REFUSED` in Firefox, which does not fall
back to IPv4 for WebSockets the way Node and Chrome do).

The app is built for that: the bridges report whether the subscription is
actually `live`, and the poll **tightens to 10 seconds when the push is not
working** and relaxes to 60 when it is. The UI stays responsive even where
the socket is unreachable, and the browser console says which case it is
(`connection_ready` / `subscription_live` versus `connection_lost`).

### Neon setup (required)

The ledger runs on **Neon Postgres** and the UI learns about changes over
**Neon Realtime** (logical replication over WebSocket).

1. `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` (direct, for Drizzle
   Kit) — the direct endpoint is the one migrations and `db:push` need.
2. Apply the schema: `npm run db:push` (or `npm run db:migrate`).
3. **Create the Realtime publication.** Without it there is nothing to
   subscribe to, and the app silently falls back to polling: the balance
   looks live but no change is ever pushed.

   ```sql
   CREATE PUBLICATION neon_realtime FOR TABLE
     transactions, payment_links, users, notifications;
   ```

   `SHOW wal_level;` must answer `logical`. The publication lives in the
   database, not in this repository: recreate it on every new branch.
4. Realtime credentials: `NEON_REALTIME_URL`, `NEON_REALTIME_SECRET`,
   `NEON_REALTIME_DB` and `VITE_NEON_REALTIME_URL` (the client URL).

> **The publication is the piece that is easy to miss.** A missing one does
> not fail loudly: the app keeps working, it just stops being real-time and
> falls back to the 20-second poll — which looks alive until you are waiting
> for a charge to settle.

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  UI — React + Tailwind v4 (phone-frame prototype)              │
│  src/components/*                                              │
│  TransferFlow (cobrar/transferir) · WithdrawFlow · DepositFlow │
│  WebPaymentPage (/pay) · QrScannerFlow · NotificationsView ·   │
│  TransactionReceiptModal · SettingsView · DynamicAccountGate   │
└──────────────┬───────────────────────────────┬─────────────────┘
               │ src/adapters/index.ts         │ HTTP (src/services/walletApi.ts)
               ▼                               ▼
┌──────────────────────────────┐  ┌─────────────────────────────────────┐
│  Solana adapters (devnet)    │  │  API — Express (server.ts, :3001)   │
│  balance reads · ATA math ·  │  │  /api/webhooks/dynamic  (HMAC,      │
│  QR encode/parse · cluster   │  │    idempotent ledger projection)    │
│  alignment guard             │  │  /api/wallet/*  balances · history ·│
└──────┬──────────────┬────────┘  │    pending · notifications ·        │
       │ RPC          │ Dynamic   │    contacts · identity              │
       ▼              ▼ SDK       │  sweeper: history backfill          │
┌────────────┐ ┌────────────────┐ └──────────────┬──────────────────────┘
│ Solana     │ │ Dynamic        │                ▼
│ devnet RPC │ │ embedded       │  ┌─────────────────────────────────────┐
│ (paced,    │ │ wallet         │  │  PostgreSQL on Neon (Drizzle, pg)   │
│  cached)   │ │ (email OTP)    │  │  users · transactions · contacts ·  │
└────────────┘ └────────────────┘  │  notifications · webhook_events · … │
                                   └──────────────┬──────────────────────┘
                                                  │ logical replication
                                                  ▼
                                   ┌─────────────────────────────────────┐
                                   │  Neon Realtime (WebSocket)          │
                                   │  row changes → UI invalidations     │
                                   └─────────────────────────────────────┘
```

**Principles**

- The UI never talks to Drizzle or `@solana/*` directly. Chain access goes
  through the adapter barrel (`src/adapters/index.ts`); persistence and the
  ledger go through `src/services/walletApi.ts` → Express.
- Two independent cluster sources (app config vs Dynamic's active network) are
  reconciled by `chain.ensureDynamicNetwork()` before every signature, and it
  **fails closed** on mismatch (genesis-hash prefix, not label).
- There is no mock chain mode. Balances, history, and receipts come from
  Solana; the PostgreSQL ledger is a **projection** of it, not a substitute.
- **The DB says *when*; the chain says *how much*.** Realtime events invalidate
  the server-side balance cache and trigger a client refetch — but the balance
  number itself is always read from the chain, never derived from the ledger
  (which cannot see movements that did not pass through ReWallet).

### How a payment settles end-to-end

```
Payer signs (Dynamic) ──► Solana devnet
        │
        ├─► sender UI: POST /api/wallet/transactions/pending   (row: pending)
        │
        └─► Dynamic webhook ──► POST /api/webhooks/dynamic
                 │  HMAC-SHA256 over raw body (x-dynamic-signature-256)
                 │  dedupe on webhook_events.message_id
                 │  resolve subject wallets → registered users
                 ▼
            upsertTransactions (user_id, reference_id)   (pending → completed)
                 ▼
            insertNotification  (sender + recipient copies)
                 ▼
            balance cache invalidated (server)  ── shared funnel, webhook + sweeper
                 ▼
            Neon Realtime pushes row changes ──► UI invalidates + refetches balance
                 ▼
            both apps: history row flips to completed, bell badge increments
```

The **sweeper** (default 300 s, self-rescheduling `setTimeout` with adaptive
backoff ×2 up to 30 min on RPC rate-limits) replays confirmed on-chain history
for every registered wallet through the same upsert path, so a missed webhook
delays but never loses a movement. Balance reads are server-side with a 15 s
cache and a paced RPC budget (`RPC_PACE_MS`); sending flows bypass the cache
with `?fresh=1`. Every write that touches the ledger also invalidates the
affected wallet's balance cache, so the next read reflects the movement.

---

## Where the fees land

`transferAmount()` builds the transaction so **the payer pays everything**:

| Cost | Paid by |
|------|---------|
| Transaction fee (~0.000005 SOL) | Payer |
| ATA creation rent (~0.00148844 SOL), only when the recipient has no token account | Payer |

A merchant with an empty wallet can still issue a charge link and get paid:
creating the recipient's token account is permissionless, so the payer funds
it. Rent is ~298× the network fee — fee sponsorship that only covers gas does
not remove the need for SOL.

## Project layout

```
landing/                        # public marketing site (static, no build step)
│   ├── index.html              # hero, metrics, features, FAQ, partner CTA
│   ├── script.js               # metrics, headline rotator, demo button
│   └── style.css               # the whole visual system
server.ts                       # Express API: webhook, wallet, sweeper, SPA host
drizzle.config.ts               # Drizzle Kit (PostgreSQL dialect)
neon.ts                         # Realtime config (allowed origins)
src/
├── adapters/                   # Solana access — the only chain entry point
│   ├── index.ts                # barrel consumed by the UI (chain.*)
│   ├── solana-client.ts        # RPC client + cluster config
│   ├── solana-pay.ts           # payment URL/QR encode-parse
│   ├── token.ts                # ATA derivation, balances, recipient checks
│   ├── dynamic-network.ts      # Dynamic vs app cluster alignment (fails closed)
│   └── payment-verify.ts       # reference lookup, receipt verification
├── components/                 # screens (see Product features)
│   ├── LiveTransactionsBridge.tsx  # Neon Realtime → React query invalidation
│   ├── HomeSurveyCard.tsx     # the survey card on the home screen
│   ├── HomeSurveyModal.tsx    # the survey, four questions on one screen
│   ├── BugReportButton.tsx    # floating "report a problem" entry
│   ├── BugReportSheet.tsx     # the report form → a pre-filled GitHub issue
│   ├── DynamicSignIn.tsx      # email OTP sign-in (full screen or inline)
│   └── SolanaAssetsCard.tsx   # the SOL/USDC breakdown of the balance
├── contracts/                  # pure types + mint registry (no SDK imports)
├── db/
│   ├── schema.ts               # 12 tables (ledger projection + app data)
│   ├── index.ts                # pg pool connection
│   └── migrations/             # generated SQL (committed)
├── i18n/
│   ├── translations.ts         # ES/EN strings
│   ├── surveyCopy.ts           # ES/EN copy for the survey flow
│   ├── bugReportCopy.ts        # ES/EN copy for the bug report flow
│   └── language.ts             # persisted language (gate ↔ app)
├── services/
│   ├── walletApi.ts            # UI → API client (fail-soft)
│   ├── wallet.ts               # data access: ledger, notifications, contacts
│   ├── transactionMapper.ts    # DB row → UI transaction (shared REST/live)
│   ├── webhookIngestor.ts      # HMAC verify, dedupe, movement + notification projection
│   ├── balanceCache.ts         # paced RPC + 15 s cache for SOL/USDC
│   ├── rpcThrottle.ts          # process-wide RPC rate-limit state
│   ├── realtimeServer.ts       # @neon/realtime server-side subscribe
│   ├── realtimeClient.ts       # browser Realtime client
│   ├── historySync.ts          # sweeper: on-chain history → ledger
│   ├── webPaymentLink.ts       # /pay URL build/parse
│   ├── survey.ts               # in-app survey: answer keys, validation, wire payload
│   ├── bugReport.ts            # in-app bug report: GitHub issue payload
│   ├── dynamicWallet.ts        # ensures the signed-in account owns a Solana wallet
│   └── solanaHistory.ts        # paginated RPC history (fallback/backfill source)
└── App.tsx                     # navigation + screen orchestration
```

## Database

PostgreSQL on **Neon** through Drizzle ORM (`pg` / node-postgres), with
PostgreSQL-native types (`DECIMAL` decimals, `TIMESTAMPTZ` timestamps, `JSONB`
payloads). The ledger tables (`transactions`, `notifications`,
`webhook_events`) are a **projection of Solana** — authoritative data is
on-chain; the DB makes history, notifications, and balances fast and
idempotent.

The connection uses a small pool (`max: 5`, 30 s idle timeout, 10 s connect
timeout). Read replicas, branching, and logical replication (Realtime) are
provided by Neon.

| Table | Purpose |
|-------|---------|
| `users` | Accounts: pubkey, handle, email, balances mirror, KYC status |
| `transactions` | Projected movements (deposit/withdrawal/sent/received) + signatures, idempotent on `(user_id, reference_id)` |
| `notifications` | In-app feed rows, linked to transactions |
| `webhook_events` | Raw webhook deliveries, deduped on Dynamic's `message_id` |
| `contacts` | Per-user address book |
| `payment_links` | Charge links: one row per charge, with the on-chain reference, settled exactly once |
| `qr_scans` | Scanned-QR tracking |
| `user_settings` | Language/currency/security (1:1) |
| `fiat_rates` | USDC → fiat history |
| `audit_log` | Change trail |

| Script | Description |
|--------|-------------|
| `npm run db:generate` | Generate a migration from `schema.ts` |
| `npm run db:push` | Push schema directly (interactive TTY) |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:backfill` | Replay on-chain history into the ledger |
| `npm run db:studio` | Drizzle Studio |

### Real-time propagation

Writes to the ledger are streamed to clients with **Neon Realtime** (logical
replication over WebSocket). The browser subscribes to the rows it renders
(`LiveTransactionsBridge`); when a row changes, the React query is invalidated
and refetched, and the balance cache is invalidated server-side so the next
balance read hits the chain.

This is the "DB says *when*, chain says *how much*" split: the database is an
**event source**, never the balance oracle. A balance derived purely from the
ledger would drift, because it cannot see movements that never touched
ReWallet (external transfers, airdrops, another device).

> **History:** the prototype originally ran on SQLite with a polling sweeper
> and client-side refetches. The migration to PostgreSQL (Neon) and Realtime
> kept the schema and idempotency keys (`(user_id, reference_id)`) unchanged —
> only the driver and the propagation channel changed. The sweeper is now a
> reconciliation job, not the update path.

## API

All routes are served by `server.ts` (default `http://127.0.0.1:3001`).
The UI calls them through `src/services/walletApi.ts`, which fails soft so the
app keeps working on-chain data alone.

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/webhooks/dynamic` | Dynamic webhook (HMAC-SHA256 verified, idempotent) |
| GET | `/api/health` | Status + active cluster |
| GET | `/api/wallet` | Full snapshot: user, balances, transactions, contacts |
| GET | `/api/wallet/transactions?wallet=` | Projected history (RPC fallback lives client-side) |
| POST | `/api/wallet/transactions/pending` | Record a just-signed transfer as pending |
| GET | `/api/wallet/balances?wallet=&fresh=1` | Cached SOL/USDC; `fresh=1` bypasses the cache |
| GET | `/api/wallet/notifications?wallet=` | Feed + unread count |
| POST | `/api/wallet/notifications/read` | Mark all as read |
| GET/POST | `/api/wallet/contacts` | Address book read / save recipient |
| GET | `/api/wallet/identity?address=` | Registered email/handle for a pubkey |
| PATCH | `/api/settings/language` | Persist the user's language |
| GET | `/api/landing/metrics` | Landing metric strip: Dynamic topline (users/wallets/sessions) plus the ledger counters (transactions/volume/success rate/processing time) |
| POST | `/api/landing/survey` | Stores a survey response (name, lastName, email, q1..q4). The form now lives in the app (home screen), not in the landing. |

## Environment

`.env.local` (**do not commit**):

```env
# ── Required (client) ─────────────────────────────────────────────
VITE_DYNAMIC_ENVIRONMENT_ID=your_dynamic_environment_id

# ── Required (server) — ledger ────────────────────────────────────
# PostgreSQL connection string (Neon pooled endpoint recommended).
DATABASE_URL=postgresql://user:pass@host/db?sslmode=require
# Direct (unpooled) endpoint, used by migrations/Drizzle Kit.
DATABASE_URL_UNPOOLED=postgresql://user:pass@host/db?sslmode=require

# ── Required (server) for real-time confirmations ─────────────────
# Signing secret of the Dynamic webhook; HMAC-SHA256 over the raw body.
DYNAMIC_WEBHOOK_SECRET=your_dynamic_webhook_secret
# Neon Realtime: WebSocket URL (server + client) and server signing secret.
NEON_REALTIME_URL=wss://<branch>-neonrealtimesocket.<region>.aws.neon.tech/
NEON_REALTIME_SECRET=nrt_live_...
VITE_NEON_REALTIME_URL=$NEON_REALTIME_URL   # Vite expands $VAR; secret stays server-only
NEON_REALTIME_DB=neondb                     # database name signed into the JWT

# ── Optional (server): landing metrics ────────────────────────────
# Dashboard API token with scope environment.analytics.read, used to fill
# the landing metric strip. Without it the strip animates zeros.
DYNAMIC_API_TOKEN=

# ── Optional (client) ─────────────────────────────────────────────
# Public origin for shareable /pay links; empty = window.location.origin.
VITE_PUBLIC_APP_URL=
VITE_SOLANA_CLUSTER=devnet          # devnet | mainnet-beta
VITE_SOLANA_RPC=                    # empty = public cluster endpoint
VITE_SOLANA_RPC_WS=

# ── Optional (server) ─────────────────────────────────────────────
API_PORT=3001
API_HOST=127.0.0.1
SOLANA_RPC_URL=https://api.devnet.solana.com   # balance cache source
USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
RPC_PACE_MS=400                     # spacing between RPC reads
BALANCE_CACHE_TTL_MS=15000          # balance cache lifetime
SWEEPER_INTERVAL_MS=300000          # history reconciliation cadence (default 300s)
SWEEPER_DISABLED=1                  # set to disable the sweeper
DYNAMIC_METRICS_TTL_MS=300000       # landing metrics snapshot TTL
LEDGER_METRICS_TTL_MS=300000        # ledger metrics snapshot TTL
DYNAMIC_ENVIRONMENT_ID=             # default: VITE_DYNAMIC_ENVIRONMENT_ID
```

`.env.example` mirrors this block. Copy it and fill the values in.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Vite dev server (:3000) |
| `npm run api` | Express API with watch (:3001) |
| `npm run api:start` | Express API once (no watch) |
| `npm run build` | Production build (`dist/`) |
| `npm run preview` | Preview production build |
| `npm run lint` | TypeScript check (`tsc --noEmit`) |
| `npm test` | Regression tests (see limitations) |
| `npm run db:*` | Drizzle generate/push/migrate/studio + `db:backfill` |

## Deployment

ReWallet has two running shapes: **local**, as two Node processes, and
**public**, as a Cloudflare Worker serving the SPA and the API from one origin.
This section is the runbook for both, and it says plainly what is not ready
yet.

> **The API is not safe to publish today.** As of this commit it authenticates
> nobody: every user-scoped route is scoped by a client-supplied
> `?wallet=<base58>` parameter, and CORS answers `*`. That is fine on
> `127.0.0.1` and unsafe anywhere else. **Phase 0 below is the gate** — it
> closes before any public deploy, on any host.

### Where this is going, and why

The prototype is a monolith on purpose: one process that proves the product
loop before infrastructure work. The good news is that the pieces that make a
serverless runtime hard are *already not here*:

| Serverless-hostile thing | Where it is today | Why it is not a problem |
|---|---|---|
| Long-lived process | the sweeper (`server.ts`) | a job → belongs in a **Cron Trigger** |
| In-memory session state | none | the session lives in **Dynamic**; the server only verifies it |
| Server-side WebSocket | none | Neon Realtime is **browser-direct**; the server only seals a capability |
| Native modules | none in the request path | `better-sqlite3` appears only in a one-off migration script |
| Key custody | none | the server derives ATAs (a PDA), it never signs |
| File system state | none | the ledger is **Neon Postgres** |

What is left is a stateless JSON API, a static bundle, and one scheduled job.
That is a Worker.

**Target shape**

```
                    ┌──────────────────────────────────────────┐
  browser  ───────► │  Cloudflare Worker  (rewallet)           │
                    │                                          │
                    │   /api/*        → fetch handler          │──►  Neon Postgres
                    │   /*  (SPA)     → Static Assets binding  │      (drizzle + neon-http)
                    │   scheduled()   → history sweeper         │──►  Solana devnet RPC
                    └───────────────┬──────────────────────────┘
                                    │
                    Cloudflare: custom domain · TLS · WAF rate limits
                                 Workers Logs + Traces
```

**Cloudflare products used, and why**

| Product | Role | Why this one |
|---|---|---|
| **Workers** | the API runtime | one small stateless handler, no container to run |
| **Workers Static Assets** | the SPA | one origin for the UI *and* the API → no CORS in production |
| **Cron Triggers** | the history sweeper | a job belongs in a scheduler, not in a request |
| **Workers Logs + Traces** | observability | the only way to answer "it does not work" for a real user |
| **Custom domain + DNS** | the stable origin | payment links carry the hostname; a tunnel restart kills shared links |
| **WAF / rate limiting** | the abuse limit | the authoritative edge limit for the RPC-amplifying routes |

**Deliberately not used:** D1 (the ledger is on Neon and moving it would
rewrite the product), R2 (no uploads), Durable Objects (no shared state to
coordinate — the only stateful thing is a cron), **Containers** (it would run
the existing `server.ts` unchanged, but the port is ~1 day of work, it is
beta, it costs more, and it keeps the process model this project is trying to
leave behind).

### Phase plan

| Phase | What | Status |
|---|---|---|
| **0. Blindaje** | server-side session auth, CORS allowlist, rate limits, security headers | **in progress** |
| **1. Runtime** | Worker entry point, `drizzle-orm/neon-http`, sweeper as a Cron Trigger with a batch cursor, runtime `/api/config`, delete `/api/tunnel` | planned |
| **2. Performance** | route-level code splitting, WebP/AVIF for `landing/`, edge cache for the landing metrics | planned |
| **3. DevOps** | `wrangler.toml`, staging/production envs, secrets, CI, migrations in CI, observability, custom domain | planned |
| **4. Go-live** | Dynamic allowed origins, webhook re-registration, end-to-end smoke test, monitoring | planned |

### Phase 0 — the gate that closes first

Publishing the current API would let anyone, from any web page, read a user's
wallet snapshot (e-mail, phone, balance, history, contacts) and create a
payment link in their name. The threat model, ordered by damage:

| Vector | Today | Phase 0 |
|---|---|---|
| `POST /api/payment-links` with a victim's public pubkey | link de cobro falso → phishing | rejected unless the session proves the wallet |
| `GET /api/wallet?wallet=X` | PII leak; the pubkeys are public and enumerable | `401` without a session, `403` for a foreign wallet |
| `Access-Control-Allow-Origin: *` | turns the above into drive-by from any page | explicit allowlist |
| `POST /api/payment-links/claim` (up to 7 paced RPC reads) | spam exhausts the shared RPC quota → real users' balance reads start failing with 429 | rate limited |
| no CSP / HSTS / `X-Frame-Options` | clickjacking over a signature-requesting UI | security headers |
| `GET /api/wallet/identity` | returns the account e-mail to any caller | returns the display name only |

**How the session works.** The browser already has a session: Dynamic. The
SDK exposes it as `client.token`, an RS256 JWT whose claims carry the user's
Solana addresses (`blockchainAccounts[]` / `verifiedCredentials[]`) and the
`scope` claim. The server verifies that token **locally** against Dynamic's
JWKS (`https://app.dynamicauth.com/api/v0/sdk/{environmentId}/.well-known/jwks`),
requires `user:basic` in the scope, and then resolves the user through the
session's own Solana address → `users.publicKey` → `users.id`.

That last step matters: **no schema change and no migration.** The `users`
table gains no Dynamic column, because the session already carries the
address that identifies the row. The identity comes from a *signed* claim, not
from a parameter the caller chose.

The payer flow stays public on purpose — a payer may not be signed in — and
relies on on-chain verification: `/api/payment-links/by-reference/:reference`,
`/api/payment-links/by-slug/:slug` and `/api/payment-links/claim` verify the
transfer on-chain before a link settles.

### Deploying locally (the team workflow)

Local development is a first-class path, not a casualty of the Cloudflare work.
Two processes, and the Vite proxy makes the browser see a single origin:

```bash
npm install --legacy-peer-deps
cp .env.example .env.local      # your own values, see below
npm run db:push                 # apply the schema to YOUR branch
npm run api                     # terminal 1 — API + webhook server on :3001
npm run dev                     # terminal 2 — UI on :3000
```

Open **http://127.0.0.1:3000**. The Vite dev server proxies `/api` to
`:3001` (`vite.config.ts`), so there is no CORS in local development.

**Per teammate, so nobody touches the production database:**

1. **Your own Neon branch.** Create one, copy its pooled and unpooled
   connection strings into your `.env.local`, and run `npm run db:push`
   against it. Remember to recreate the Realtime publication on the new
   branch (see [Neon setup](#neon-setup-required)) — a missing publication
   fails *silently*, and the app just looks like it stopped being real-time.
2. **Your own Dynamic environment.** A separate environment id in the Dynamic
   console with `http://127.0.0.1:3000` in the allowed origins. Set
   `VITE_DYNAMIC_ENVIRONMENT_ID` to it. Do not share a Dynamic environment
   between machines: its allowed-origins list and its webhook are per
   environment, and fighting over them wastes an afternoon.
3. **Your own webhook**, or none at all. Without a webhook the balances still
   work through the sweeper, but confirmations arrive late. If you set
   `ALLOW_UNSIGNED_WEBHOOK=1` locally, remember it is a **dev-only** flag: the
   webhook fails closed when `DYNAMIC_WEBHOOK_SECRET` is missing, and that
   guard must never be turned off in a deployed environment.
4. **Turn the sweeper off** with `SWEEPER_DISABLED=1` while you are iterating
   on the UI — it competes for the same public RPC quota you are debugging
   against.

**Testing the payer flow from a second device** (the flow that matters most:
someone opens `/pay/<slug>` on their phone, not your laptop) needs a tunnel,
because `127.0.0.1` on their phone is their own machine:

```bash
cloudflared tunnel --url http://127.0.0.1:3000
```

The Vite config already allows `*.trycloudflare.com` hosts. Two things to know:
the hostname changes on every restart, so payment links you already shared
break; and the API is only reachable if the tunnel points at the port that
serves it. This is precisely what the custom domain in Phase 3 removes.

**Verifying a change end to end.** The `audit:*` scripts run against a live
server and check the flows the unit tests cannot reach:

| Script | Checks |
|---|---|
| `npm run audit:api` | every endpoint answers with the expected shape |
| `npm run audit:load` | the first-load path |
| `npm run audit:parity` | the UI and the API agree |
| `npm run audit:flow` | the payment-link flow |
| `npm run audit:claim` | the claim/settle path |

`npm test` (unit) + `npm run lint` (types) + the audit scripts (behaviour)
are the three gates a change has to pass.

### Deploying to Cloudflare

> **Not yet.** This is the Phase 3/4 runbook, written down before it is
> built so the decisions are reviewable.

**Environments.** Two, each with its own everything:

| | staging | production |
|---|---|---|
| Neon | its own branch | its own branch |
| Dynamic | its own environment id | its own environment id |
| `wrangler` env | `--env staging` | `--env production` |
| domain | `staging.<domain>` | `<domain>` |

Secrets are **never** in the repository. `wrangler secret put` per
environment:

| Secret | Used for |
|---|---|
| `DATABASE_URL` | the ledger (pooled endpoint) |
| `DYNAMIC_WEBHOOK_SECRET` | the webhook HMAC |
| `NEON_REALTIME_SECRET` | sealing the browser's live-query capability |
| `DYNAMIC_API_TOKEN` | the landing metric strip |
| `DYNAMIC_ENVIRONMENT_ID` | the JWKS path and the environment checks |

**The database driver.** Phase 1 moves the ledger from `pg` (a TCP pool) to
`drizzle-orm/neon-http`. Over HTTP, one query is one HTTP round trip: no
connection to set up per request, which is exactly what a serverless runtime
charges you for. Hyperdrive + `pg` is the alternative, and it was rejected for
two reasons: the client must be created *inside* the handler (the current
module-level `new Pool()` in `src/db/index.ts` would have to move), and its
query cache does **not** invalidate on a write — unacceptable for a live
ledger, where a stale balance is a wrong balance.

**Migrations run in CI, never in the Worker.** Drizzle Kit is a Node tool; the
Worker has no shell and no direct connection. The pipeline is:

```
lint → test → build → migrate (Node, DATABASE_URL_UNPOOLED) → deploy
```

Migrations are **forward-only** and must be backward-compatible
(expand/contract): rolling the Worker back to a previous version does **not**
roll the schema back, so the old code has to keep working against the new
schema. Never a destructive migration in the same deploy that changes
behaviour.

**Observability.** `observability.enabled` and `observability.traces.enabled`
both on, and structured JSON logs — the current `console.error` calls with
emoji prefixes are not greppable. Then, in order: a health monitor on the
existing `GET /api/health`, an alert on Workers error 1102 (resource limit)
and 1027 (daily request limit), and Workers Analytics for the funnel.

**Rollout.** Workers versions and gradual deployments: ship to 5 %, watch the
traces, then 25 %, then 100 %. A Worker rollback is instant and does not touch
the database. Workers Previews give every PR its own URL.

**Go-live checklist.** In order, because a wrong order costs a day:

1. Custom domain live and serving the SPA.
2. **The production origin added to Dynamic's allowed origins** — the sign-in
   fails without it, and nothing else explains why.
3. The Dynamic webhook re-registered against the stable origin
   (`POST /api/webhooks/dynamic`). It acknowledges in under 15 s and retries
   only twice, so a wrong URL is auto-disabled.
4. `ALLOW_UNSIGNED_WEBHOOK` **not** set, `DYNAMIC_WEBHOOK_SECRET` set.
5. Migrations applied, Realtime publication present on the production branch.
6. A full smoke test on a real device: sign in → charge → pay from another
   device → the balance moves.
7. Monitoring live before the first user is invited.

### Limits that shape the design

Platform limits (Cloudflare, verified 2026-10) and what they mean here:

| Limit | Value | Consequence for ReWallet |
|---|---|---|
| Requests/day (Free) | 100,000 | the poll is 2 endpoints per tick → 120 req/h/user healthy, 720 degraded. Free ≈ 833 user-hours/day healthy, **139 degraded** |
| CPU/request (Free) | 10 ms | a cold cache turns a read into several round trips — the `X-DB-Queries` header is the metric to watch |
| CPU/request (Paid) | 5 min (30 s default) | $5/month removes the ceiling; worth it before the first paying user |
| Cron wall time | 15 min | the sweeper must get a batch cursor — see below |
| Static Asset file | 25 MiB | `landing/` is ~4.4 MB of PNG today; WebP/AVIF is a Phase 2 item |
| Worker size / startup | 64 MiB / 1 s | the current bundle is ~2 MB — no problem |

Two measurements from this repository that the design depends on:

- **The sweeper does not fit a Cron Trigger at scale.** `syncAllWallets(500)`
  scans *every* user with 500 ms of spacing every 300 s: ~50 s + RPC at 100
  users, ~8–12 min at 1000. Phase 1 gives it a batch cursor (for example 50
  wallets per run) and moves `expireStalePaymentLinks()` into its own
  DB-only cron.
- **The bundle is the biggest speed problem, and it is not a Cloudflare
  problem.** 1.9 MB / 474 KB gzip in the main chunk, plus ~4.4 MB of PNG in
  `landing/`. On a mid-range phone that is seconds of first paint before any
  JavaScript runs. Phase 2 splits the bundle by route — `/pay` first, because
  that is the route a payer opens on a phone — and converts the images.

### Runbook

| Situation | Action |
|---|---|
| "It does not work" for a user | Workers Logs → find the request → check `X-DB-Queries`; the in-app bug report opens a GitHub issue with the build, screen and wallet attached |
| Balances are stale | the webhook may have failed (Dynamic auto-disables after 2 retries) or the sweeper is backing off on RPC 429 — check `SWEEPER_INTERVAL_MS` and the RPC provider |
| The app fell back to the 10-second poll | the Neon Realtime socket is unreachable; the app still works, just slower |
| Error 1027 | the daily request limit was hit (Free plan) — shorten the poll or move to Paid |
| Error 1102 | a Worker hit a resource limit — usually the sweeper; give it a batch cursor |
| A bad deploy | roll back the Worker version; the database is untouched, and the migrations were backward-compatible by rule |
| A leaked link | the link is single-use and settles once; a leaked secret is a different problem — rotate the Dynamic webhook secret |

## Known limitations

Deliberate prototype constraints — tracked, not accidental:

- **The survey is not persisted yet.** The answers are collected and validated
  in the app, but `submitSurvey()` only logs them; the POST to
  `/api/landing/survey` is the one call that turns it on.
- **Sweeper is a reconciliation job.** The ledger updates itself through the
  webhook and Neon Realtime; the sweeper (300 s, adaptive backoff) exists to
  repair a missed delivery, not to drive the UI.
- **Devnet only.** USDC mint `4zMMC9…ncDU`; public RPC endpoints are
  rate-limited and have no SLA (the sweeper backs off on 429).
- **i18n is partial.** Onboarding, home chrome, and settings are ES/EN;
  several flows hardcode Spanish.

## Roadmap to beta

The prototype is a **monolith on purpose** — one process that proves the
product loop before infrastructure work. The path to the first beta users:

1. ~~**PostgreSQL ledger**~~ — **done:** the ledger runs on Neon Postgres;
   the webhook projection and idempotency keys carried over unchanged.
2. ~~**Real-time propagation**~~ — **done:** Neon Realtime streams row changes
   to the UI; the sweeper was demoted to a reconciliation job.
3. ~~**User registration at sign-up**~~ — **done:** the `users` row is created
   on first Dynamic login, so every account is projectable by the webhook
   from day one.
4. ~~**Single-use payment links**~~ — **done:** every charge persists a
   `payment_links` row with its on-chain reference, and the link settles
   exactly once; the webhook and the sweeper both reconcile through it.
5. **Survey persistence** — post the in-app survey answers to
   `landing_survey_responses`. The payload already matches the endpoint
   body, so this is the `submitSurvey()` call plus the name/apellido
   decision (the account may not carry a last name, and the column is
   `NOT NULL` today).
6. **The bell goes real-time** — the notifications feed has no live
   subscription, so the 20-second poll is the only thing that updates it.
   Refreshing the notifications when the transactions bridge sees new rows
   closes the gap: the webhook that writes a notification always writes the
   transaction too, so the same event drives both.
7. **The poll becomes reconciliation** — with Realtime pushing the
   movements and the charges, the 20-second poll is only the floor under
   them. Drop it to 60s, and eventually let it sleep while the live
   subscription reports itself as healthy (the SDK exposes
   `connection_ready` / `subscription_live` / `queryUnavailable`).
8. **A stable public origin** — the payment links carry the tunnel's
   hostname, so a tunnel restart kills the links that were already shared.
   A named tunnel with a fixed domain (or a real host) removes both that
   and the manual re-registration of the Dynamic webhook. The custom domain
   in [Deployment](#deployment) is the version of this that also carries the
   Worker, the API and the assets on one origin.
9. **A public deployment** — the API authenticates nobody today, so it stays
   on `127.0.0.1`. [Phase 0](#phase-0--the-gate-that-closes-first) closes
   that hole, and [Deployment](#deployment) carries the phased plan from there
   to a Worker, a Cron Trigger and a stable origin.

## License

Apache-2.0
