# ReWallet — Prototype UI

Mobile-first wallet prototype for ReWallet: receive, send, charge, and pay with
USDC on **Solana devnet**. Built with React + TypeScript + Tailwind CSS v4,
backed by a local SQLite database via Drizzle ORM and a thin Express API.

> **Current state (2026-10-15):** Solana Pay is **fully wired** — the UI uses real
> devnet RPC calls via `@solana/kit` adapters. Payment requests, QR codes,
> QR scanning, balance reads, payment verification, and recipient validation
> all hit the chain. Local ledger remains as fallback for offline/demo mode.

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

Demo user: `@cata_soto` — balance USD 423.25 (local ledger), 5 transactions,
4 contacts with Solana addresses, 2 payment links, 2 QR scans, 3 notifications.

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
                            ▲
                            │  src/adapters/index.ts (barrel)
┌───────────────────────────┴──────────────────────────────────┐
│  Solana Adapters (devnet/mock)       src/adapters/*          │
│  solana-client · solana-pay · token · payment-verify         │
└──────────────────────────────────────────────────────────────┘
                            │  @solana/kit + devnet RPC
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  Solana devnet (api.devnet.solana.com)                       │
└──────────────────────────────────────────────────────────────┘
```

**Key principle:** UI never talks to Drizzle or `@solana/*` directly. Screens
consume domain types in `src/types/wallet.ts` and `src/contracts/payments.ts`;
the repository bridges to the API; the adapter barrel (`src/adapters/index.ts`)
is the **single entry point** for all chain access, with a `mock`/`devnet`
mode switch via `VITE_USE_CHAIN`.

## Solana Pay Integration (Working End-to-End)

| Feature | Component | Adapter | Status |
|---------|-----------|---------|--------|
| **Generate payment request** | `TransferFlow` | `chain.createPaymentRequest()` | ✅ Real `solana:` URL + QR SVG |
| **QR code rendering** | `TransferFlow` | `chain.renderQrSvg()` / `renderQrDataUrl()` | ✅ Real QR codes |
| **QR scanning** | `QrScannerFlow` | `chain.parsePaymentRequest()` + Barcode Detection API | ✅ Camera → parsed transfer/tx request |
| **Payment verification** | `TransferFlow` | `chain.verifyPayment(ref, asset, recipient)` | ✅ Reference → receipt on-chain |
| **Recipient validation** | `TransferFlow` | `chain.verifyRecipient(addr, asset)` | ✅ Blocks token-account/mint/program |
| **Balance reading** | `BalanceCard` | `chain.getBalances(wallet, [USDC, SOL])` | ✅ Real devnet balances |
| **Reference generation** | `TransferFlow` | `chain.generateReference()` | ✅ 32-byte base58 per payment |

### Flow: Create → Scan → Pay → Verify

1. **Merchant** opens TransferFlow → "Generar link de pago" → enters amount/concept/client → "Generar"
   - Creates unique `reference` via `generateReference()`
   - Builds `solana:<merchant>?amount=X&spl-token=USDC_MINT&reference=REF&label=ReWallet&message=concept&memo=client` via `createPaymentRequest()`
   - Renders QR SVG via `renderQrSvg()`
   - Shows "Copiar Link" / "WhatsApp" share buttons

2. **Payer** opens QrScannerFlow → "Activar cámara" → points at QR
   - Barcode Detection API (Chrome/Edge) reads QR continuously
   - `parsePaymentRequest()` validates Solana Pay spec
   - Shows parsed: recipient, amount, asset, message, references
   - "Confirmar" acknowledges scan

3. **Payer** opens QR in Phantom (devnet) → approves → transaction lands on devnet

4. **Merchant** taps "Verificar pago en devnet"
   - `verifyPayment({ reference }, usdcDevnet, merchantWallet)` queries `getSignaturesForAddress(reference)`
   - Inspects transaction via `getTransaction` → confirms USDC credit to merchant's ATA
   - Returns `PaymentReceipt` with signature, slot, commitment, amount
   - UI adds `received` transaction to list

## Project layout

```
src/
├── adapters/                    # Solana chain access (single entry point)
│   ├── index.ts                 # Barrel export + mode switch (mock/devnet)
│   ├── solana-client.ts         # RPC client singleton + cluster config
│   ├── solana-pay.ts            # Solana Pay spec: encode/parse/QR/refs
│   ├── token.ts                 # ATA derivation, balances, recipient check
│   └── payment-verify.ts        # Verification, reference lookup, streaming
├── components/                  # UI screens and flows
│   ├── TransferFlow.tsx         # Send + Payment Link + Verify (real chain)
│   ├── QrScannerFlow.tsx        # Camera + Barcode Detection + parse
│   ├── BalanceCard.tsx          # USD balance + SOL/USDC devnet badges
│   ├── DepositFlow.tsx          # Deposit methods (mock)
│   ├── WithdrawFlow.tsx         # Withdraw methods (mock)
│   ├── Header.tsx
│   ├── BottomNav.tsx
│   ├── Keypad.tsx
│   ├── CoinIcon.tsx
│   ├── RecentTransactions.tsx
│   ├── AllTransactionsModal.tsx
│   ├── TransactionReceiptModal.tsx
│   ├── NotificationToast.tsx
│   ├── PhoneFrame.tsx
│   └── SettingsView.tsx
├── contracts/                   # Pure types, zero SDK imports
│   ├── payments.ts              # PaymentIntent, Receipt, Reference, errors
│   ├── tokens.ts                # TokenAsset, mint registry, conversions
│   └── identity.ts              # Handle resolution types
├── data/mockData.ts             # Offline fallback snapshot
├── db/
│   ├── schema.ts                # Drizzle schema (9 tables)
│   ├── index.ts                 # SQLite connection + pragmas
│   ├── seed.ts                  # Devnet demo data (idempotent)
│   └── migrations/              # Generated SQL migrations (committed)
├── i18n/translations.ts         # EN / ES strings
├── services/
│   ├── wallet.ts                # Business logic + DB ↔ UI mappers
│   └── walletRepository.ts      # UI-facing repository (API or mock)
├── types/wallet.ts              # UI domain types (Transaction, Contact, etc.)
└── App.tsx                      # Navigation + screen orchestration
server.ts                        # Express API over the service layer
drizzle.config.ts                # Drizzle Kit config (SQLite dialect)
```

## Database

SQLite through Drizzle ORM. Schema mirrors a production MariaDB model with
SQLite-compatible types (REAL for decimals, INTEGER epoch for timestamps, TEXT
for enums and JSON).

| Table | Purpose |
|-------|---------|
| `users` | Wallets, balances, handle, KYC status |
| `contacts` | Per-user address book (includes `publicKey` for Solana) |
| `transactions` | deposit / withdrawal / sent / received + Solana traceability |
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

Create `.env.local` (copy from below, **do not commit**):

```env
# Solana devnet configuration
VITE_SOLANA_CLUSTER=devnet
VITE_SOLANA_RPC=https://api.devnet.solana.com
VITE_SOLANA_RPC_WS=wss://api.devnet.solana.com

# Enable devnet mode (real chain reads via @solana/kit)
VITE_USE_CHAIN=true

# Merchant wallet for payment requests (devnet address that receives)
VITE_MERCHANT_WALLET=7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU

# API configuration
VITE_USE_API=true            # true → read from server.ts (real DB data)
VITE_API_BASE=http://localhost:3001
API_PORT=3001
DATABASE_URL=file:./data/rewallet.db

# AI (optional)
GEMINI_API_KEY=
APP_URL=http://localhost:3000
```

### Mode matrix

| `VITE_USE_CHAIN` | `VITE_USE_API` | Behavior |
|------------------|----------------|----------|
| `false` (default) | `false` | **Full mock** — no network, all data from `mockData.ts` |
| `true` | `false` | **Chain reads only** — real devnet balances/verify, UI data from mock |
| `true` | `true` | **Full devnet** — chain reads + real DB data via API (default now) |

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Vite dev server (port 3000) |
| `npm run api` | Express API with watch (port 3001) |
| `npm run api:start` | Express API once (no watch) |
| `npm run build` | Production build (`dist/`) |
| `npm run preview` | Preview production build |
| `npm run lint` | TypeScript check (`tsc --noEmit`) |
| `npm run clean` | Remove `dist/` and `server.js` |

## Key implementation details

### Adapter barrel (`src/adapters/index.ts`)

```typescript
// Single entry point — UI imports ONLY from here
import { chain } from '@/adapters';

// Mode switch
chain.isLive()        // true when VITE_USE_CHAIN=true
chain.mode()          // 'mock' | 'devnet'
chain.network()       // { cluster, rpcUrl, rpcSubscriptionsUrl }

// Payment requests (always real — pure encoding)
chain.createPaymentRequest({ recipient, amount, asset, reference, label, message, memo })
chain.generateReference()
chain.parsePaymentRequest(rawUrl)
chain.renderQrSvg(url)
chain.renderQrDataUrl(url)

// Balances (mock returns deterministic fake; devnet hits RPC)
await chain.getBalance(owner, asset)
await chain.getBalances(owner, [usdcDevnet, solAsset])

// Accounts
await chain.deriveAta(owner, asset)
await chain.verifyRecipient(recipient, asset)   // { ok, classified, canReceive, reason }
await chain.classifyAddress(addr)

// Verification
await chain.verifyPayment({ reference }, asset, recipient)
await chain.findReferenceTransactions(reference)
chain.watchTokenAccount(owner, asset, onEvent, options)

// Commitment helpers
chain.meetsCommitment(observed, required)
chain.createInMemoryLedger()   // Prevents double-count in session
```

### Supported assets (devnet)

Only **USDC** is available on devnet (Circle's `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`).
USDT, PYUSD, USDG are mainnet-only — registry in `src/contracts/tokens.ts`.

### Token program awareness

The adapter derives ATAs with the **correct token program** per mint:
- `spl-token` (Tokenkeg...) → USDC, USDT
- `token-2022` (TokenzQdB...) → PYUSD, USDG

Using the wrong program produces a different, unusable address.

### Verification strategy (per Solana docs)

1. `getSignaturesForAddress(reference)` — finds txs mentioning the reference
2. `getTransaction(sig, { encoding: 'jsonParsed' })` — inspects pre/post token balances
3. Computes `delta` on merchant's ATA → confirms credit
4. Checks `confirmationStatus` ≥ `confirmed` (default) or `finalized`
5. Validates `mint` matches expected asset (prevents fake "USDC")
6. Returns `PaymentReceipt` with signature, slot, commitment, amount, memo

## Roadmap (remaining)

1. **Real signing** — integrate Privy/Phantom wallet adapter for actual transaction signing (currently payer scans QR in external wallet)
2. **Transaction requests** — backend `/api/solana-pay/tx` endpoint for withdrawals (Solana Pay transaction request flow)
3. **Handle resolution** — indexer-backed `@handle → address` lookup
4. **MariaDB** — swap Drizzle driver and run production schema
5. **Auth** — wallet signature login (Sign-In With Solana) + session handling
6. **Webhooks** — Helius/QuickNode webhooks for real-time balance updates instead of polling
7. **Fee abstraction** — sponsor priority fees so users never need SOL

## License

Apache-2.0