# ReWallet — Prototype UI

Mobile-first wallet prototype for ReWallet: receive, send, charge, and pay with
USDC. Built with React + TypeScript + Tailwind CSS v4, backed by a local SQLite
database via Drizzle ORM and a thin Express API.

> **Prototype scope.** Everything runs against **Solana devnet** and a local
> SQLite file. No real funds, no private keys, no on-chain writes yet. Balances
> are simulated by the local ledger so the full UI can be exercised end to end.

## Quick start

```bash
npm install --legacy-peer-deps

# 1. Create the local database and seed demo data
npm run db:push          # or: npm run db:generate && npm run db:migrate
npm run db:seed

# 2. Start the API (port 3001) and the UI (port 3000)
npm run api              # terminal 1
npm run dev              # terminal 2
```

Open **http://localhost:3000**.

Demo user: `@cata_soto` — balance USD 423.25, 5 transactions, 4 contacts,
2 payment links, 2 QR scans, 3 notifications.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  UI (React + Tailwind)          src/components/*             │
│  Header · BalanceCard · TransferFlow · DepositFlow ·         │
│  WithdrawFlow · QrScannerFlow · SettingsView · Receipts      │
└───────────────────────────┬──────────────────────────────────┘
                            │  src/services/walletRepository.ts
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  Prototype API (Express)                server.ts            │
│  /api/wallet · /api/transactions · /api/payment-links        │
└───────────────────────────┬──────────────────────────────────┘
                            │  src/services/wallet.ts
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  Drizzle ORM + SQLite              src/db/{schema,index}.ts  │
│  data/rewallet.db (git-ignored)                              │
└──────────────────────────────────────────────────────────────┘
```

The UI never talks to Drizzle directly. Screens consume the domain types in
`src/types/wallet.ts`; the repository bridges to the API and falls back to
`src/data/mockData.ts` when the API is offline, so the prototype always renders.

## Project layout

```
src/
├── components/          # UI screens and flows
├── data/mockData.ts     # offline fallback snapshot
├── db/
│   ├── schema.ts        # Drizzle schema (9 tables)
│   ├── index.ts         # SQLite connection + pragmas
│   ├── seed.ts          # devnet demo data
│   └── migrations/      # generated SQL migrations (committed)
├── i18n/translations.ts # EN / ES strings
├── lib/devnet.ts        # cluster config, explorer URLs, USDC helpers
├── services/
│   ├── wallet.ts        # business logic + DB ↔ UI mappers
│   └── walletRepository.ts  # UI-facing repository (API or mock)
├── types/wallet.ts      # domain contracts
└── App.tsx              # navigation and screen orchestration
server.ts                # Express API over the service layer
drizzle.config.ts        # Drizzle Kit config (SQLite dialect)
```

## Database

SQLite through Drizzle ORM. The schema mirrors a production MariaDB model with
SQLite-compatible types (REAL for decimals, INTEGER epoch for timestamps, TEXT
for enums and JSON).

| Table | Purpose |
|-------|---------|
| `users` | Wallets, balances, handle, KYC status |
| `contacts` | Per-user address book |
| `transactions` | deposit / withdrawal / sent / received |
| `payment_links` | Charge links with Solana Pay reference |
| `qr_scans` | Scanned QR tracking |
| `user_settings` | Language, currency, security (1:1 with users) |
| `fiat_rates` | USDC → fiat conversion history |
| `notifications` | In-app notifications |
| `audit_log` | Change audit trail |

### Database scripts

| Script | Description |
|--------|-------------|
| `npm run db:generate` | Generate a migration from `schema.ts` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:push` | Push schema directly (interactive TTY) |
| `npm run db:seed` | Seed devnet demo data (idempotent) |
| `npm run db:studio` | Open Drizzle Studio |
| `npm run db:reset` | Drop `data/`, re-push schema, re-seed |

### Migrating to MariaDB

The schema is written so the move is mechanical:

| SQLite (prototype) | MariaDB (production) |
|--------------------|----------------------|
| `REAL` | `DECIMAL(18,6)` |
| `INTEGER` timestamp | `TIMESTAMP` |
| `TEXT` enum | native `ENUM(...)` |
| `TEXT` json | `JSON` |
| `better-sqlite3` | `mysql2` driver |

Change the driver in `src/db/index.ts` and the `dialect` in
`drizzle.config.ts`, then regenerate migrations.

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Service status and active cluster |
| GET | `/api/wallet` | Full snapshot: user, balance, transactions, contacts |
| GET | `/api/wallet/transactions` | Transaction list |
| GET | `/api/wallet/notifications` | Notifications + unread count |
| POST | `/api/transactions` | Record a transaction and adjust balance |
| POST | `/api/payment-links` | Create a charge link |
| POST | `/api/payment-links/:id/simulate-payment` | Simulate a client payment |
| PATCH | `/api/settings/language` | Persist the user language |

## Environment

Copy `.env.example` to `.env.local`:

```env
VITE_SOLANA_CLUSTER=devnet
VITE_SOLANA_RPC=https://api.devnet.solana.com
VITE_SOLANA_RPC_WS=wss://api.devnet.solana.com
VITE_MERCHANT_WALLET=7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU

VITE_USE_API=false            # true → read from server.ts instead of mock data
VITE_API_BASE=http://localhost:3001
API_PORT=3001
DATABASE_URL=file:./data/rewallet.db
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Vite dev server (port 3000) |
| `npm run api` | Express API with watch (port 3001) |
| `npm run build` | Production build |
| `npm run lint` | TypeScript check (`tsc --noEmit`) |

## Roadmap

1. **Solana Pay wiring** — replace simulated signing with `@solana/pay` transfer
   requests, `watchReference` for payment confirmation, and a backend
   transaction-request endpoint for withdrawals.
2. **Real balance source** — derive balances from the chain (Helius/QuickNode
   webhooks) instead of the local ledger column.
3. **Handle resolution** — indexer-backed `@handle → address` lookup.
4. **MariaDB** — swap the Drizzle driver and run the production schema.
5. **Auth** — wallet signature login (Sign-In With Solana) and session handling.
