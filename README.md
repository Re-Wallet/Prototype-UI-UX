# ReWallet — USDC payments on Solana

ReWallet is a consumer payments app for **USDC on Solana**: create an account
with an email, get a wallet, and move money with the flows people already know —
**cobrar** (charge with a QR/link), **pagar** (pay a request), **depositar**
(receive), and **retirar** (send out). No seed phrases, no browser extensions:
the wallet is embedded and the account is an email one-time code.

This repository is the working prototype: a React + TypeScript mobile-first UI,
an Express API with a SQLite ledger, and a Dynamic.xyz webhook pipeline that
turns on-chain movements into balances, history, and notifications. Everything
runs against **Solana devnet** (test tokens, no real value).

> **Status:** functional prototype heading to private beta. The current stack
> (SQLite + polling sweeper) is the monolith that migrates to PostgreSQL with
> real-time updates before beta — see [Roadmap to beta](#roadmap-to-beta).

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

1. Open the link / scan the QR → `/pay` → sign in with email OTP.
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

### Also in the app

| Feature | Where | Notes |
|---------|-------|-------|
| **Transferir (P2P)** | `TransferFlow` | Same send path to contacts/recent recipients, with a note field |
| **Notificaciones** | `NotificationsView` + `GET /api/wallet/notifications` | Fed by the webhook (sent/received movements); unread badge in the header |
| **Comprobante (receipt)** | `TransactionReceiptModal` | Cadena/Moneda, Emisor/Receptor by **email**, explorer link, download/share |
| **Actividad** | `AllTransactionsModal` | Full history from the local ledger (RPC fallback) |
| **Perfil** | `SettingsView` | Email, wallet, language toggle (ES/EN), logout pinned at the bottom |
| **Onboarding** | `DynamicAccountGate` | Email OTP + language picker; embedded Solana wallet created by Dynamic |

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
│ (paced,    │ │ wallet         │  │  SQLite via Drizzle (data/rewallet) │
│  cached)   │ │ (email OTP)    │  │  users · transactions · contacts ·  │
└────────────┘ └────────────────┘  │  notifications · webhook_events · … │
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
  Solana; the SQLite ledger is a **projection** of it, not a substitute.

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
            both apps: history row flips to completed, bell badge increments
```

The **sweeper** (`SWEEPER_INTERVAL_MS`, default 120 s) replays confirmed
on-chain history for every registered wallet through the same upsert path, so
a missed webhook delays but never loses a movement. Balance reads are
server-side with a 15 s cache and a paced RPC budget (`RPC_PACE_MS`), and
sending flows bypass the cache with `?fresh=1`.

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
server.ts                       # Express API: webhook, wallet, sweeper, SPA host
drizzle.config.ts               # Drizzle Kit (SQLite dialect)
src/
├── adapters/                   # Solana access — the only chain entry point
│   ├── index.ts                # barrel consumed by the UI (chain.*)
│   ├── solana-client.ts        # RPC client + cluster config
│   ├── solana-pay.ts           # payment URL/QR encode-parse
│   ├── token.ts                # ATA derivation, balances, recipient checks
│   ├── dynamic-network.ts      # Dynamic vs app cluster alignment (fails closed)
│   └── payment-verify.ts       # reference lookup, receipt verification
├── components/                 # screens (see Product features)
├── contracts/                  # pure types + mint registry (no SDK imports)
├── db/
│   ├── schema.ts               # 10 tables (ledger projection + app data)
│   ├── index.ts                # SQLite connection + pragmas
│   └── migrations/             # generated SQL (committed)
├── i18n/
│   ├── translations.ts         # ES/EN strings
│   └── language.ts             # persisted language (gate ↔ app)
├── services/
│   ├── walletApi.ts            # UI → API client (fail-soft)
│   ├── wallet.ts               # data access: ledger, notifications, contacts
│   ├── webhookIngestor.ts      # HMAC verify, dedupe, movement + notification projection
│   ├── balanceCache.ts         # paced RPC + 15 s cache for SOL/USDC
│   ├── historySync.ts          # sweeper: on-chain history → ledger
│   ├── webPaymentLink.ts       # /pay URL build/parse
│   └── solanaHistory.ts        # paginated RPC history (fallback/backfill source)
└── App.tsx                     # navigation + screen orchestration
```

## Database

SQLite through Drizzle ORM, mirroring the production MariaDB model with
SQLite-compatible types (`REAL` decimals, epoch `INTEGER` timestamps, `TEXT`
enums/JSON). The ledger tables (`transactions`, `notifications`,
`webhook_events`) are a **projection of Solana** — authoritative data is
on-chain; the DB makes history, notifications, and balances fast and
idempotent.

| Table | Purpose |
|-------|---------|
| `users` | Accounts: pubkey, handle, email, balances mirror, KYC status |
| `transactions` | Projected movements (deposit/withdrawal/sent/received) + signatures, idempotent on `(user_id, reference_id)` |
| `notifications` | In-app feed rows, linked to transactions |
| `webhook_events` | Raw webhook deliveries, deduped on Dynamic's `message_id` |
| `contacts` | Per-user address book |
| `payment_links` | Charge links (schema ready; see limitations) |
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

### Migration path to PostgreSQL

The schema is intentionally portable; the beta migration swaps the driver,
not the model:

| SQLite (prototype) | PostgreSQL (beta) |
|--------------------|-------------------|
| `REAL` | `DECIMAL(18,6)` |
| `INTEGER` epoch timestamp | `TIMESTAMPTZ` |
| `TEXT` enum | native `ENUM(...)` |
| `better-sqlite3` | `pg` (+ connection pool) |
| in-process sweeper interval | `LISTEN/NOTIFY` + scheduled jobs |

Change the driver in `src/db/index.ts`, the `dialect` in `drizzle.config.ts`,
regenerate migrations, and replace the polling sweeper with webhook-driven
real-time updates (see [Roadmap to beta](#roadmap-to-beta)).

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

## Environment

`.env.local` (**do not commit**):

```env
# ── Required (client) ─────────────────────────────────────────────
VITE_DYNAMIC_ENVIRONMENT_ID=your_dynamic_environment_id

# ── Required (server) for real-time confirmations ─────────────────
# Signing secret of the Dynamic webhook; HMAC-SHA256 over the raw body.
DYNAMIC_WEBHOOK_SECRET=your_dynamic_webhook_secret

# ── Optional (client) ─────────────────────────────────────────────
# Public origin for shareable /pay links; empty = window.location.origin.
VITE_PUBLIC_APP_URL=
VITE_SOLANA_CLUSTER=devnet          # devnet | mainnet-beta
VITE_SOLANA_RPC=                    # empty = public cluster endpoint
VITE_SOLANA_RPC_WS=

# ── Optional (server) ─────────────────────────────────────────────
API_PORT=3001
API_HOST=127.0.0.1
DATABASE_URL=./data/rewallet.db
SOLANA_RPC_URL=https://api.devnet.solana.com   # balance cache source
USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
RPC_PACE_MS=400                     # spacing between RPC reads
BALANCE_CACHE_TTL_MS=15000          # balance cache lifetime
SWEEPER_INTERVAL_MS=120000          # history backfill cadence
SWEEPER_DISABLED=1                  # set to disable the sweeper
```

> **`.env.example` is out of date** (it still carries template variables).
> Copy the block above instead.

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

## Known limitations

Deliberate prototype constraints — tracked, not accidental:

- **Links are replayable.** `/pay` carries recipient/mint/cluster/amount/message
  but no reference or expiry; nothing binds a link to a single settlement.
  `payment_links` is modelled in the schema for the beta fix.
- **User provisioning is manual.** The webhook and ledger only project
  movements for pubkeys present in `users` (seeded for the prototype). Beta
  registers the user row at sign-up.
- **SQLite + polling.** One process, one file. The sweeper (2 min) plus the
  15 s balance cache are the prototype's stand-ins for a real database with
  real-time propagation.
- **Devnet only.** USDC mint `4zMMC9…ncDU`; public RPC endpoints are
  rate-limited and have no SLA.
- **i18n is partial.** Onboarding, home chrome, and settings are ES/EN;
  several flows hardcode Spanish.
- **`npm test` fails on Node 22.21** before loading any test file
  (`Missing internal module 'internal/deps/brace-expansion'`) — pre-existing
  runner issue, unrelated to application code.

## Roadmap to beta

The prototype is a **monolith on purpose** — one process that proves the
product loop before infrastructure work. The path to the first beta users:

1. **PostgreSQL ledger** — swap SQLite for Postgres (schema already portable,
   see [Migration path](#migration-path-to-postgresql)); the webhook
   projection and idempotency keys carry over unchanged.
2. **Real-time propagation** — replace the polling sweeper and client
   refetches with `LISTEN/NOTIFY` → SSE to the UI: balances, history rows, and
   notification badges update as the webhook lands, with the sweeper demoted
   to an audit/repair job.
3. **User registration at sign-up** — insert the `users` row on first Dynamic
   login so every account is projectable by the webhook from day one.
4. **Single-use payment links** — persist `payment_links` with an on-chain
   reference per charge so a link settles once and reconciles exactly.
5. **Mainnet + production RPC** — move off public devnet endpoints to a
   dedicated provider; enable mainnet USDC.
6. **Fee abstraction** — sponsor the network fee so payers can settle in
   USDC without holding SOL (rent remains payer-funded by design).

## License

Apache-2.0
