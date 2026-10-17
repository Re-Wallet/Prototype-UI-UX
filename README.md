# ReWallet — Prototype UI

Mobile-first wallet UI for ReWallet: read USDC balances, create and verify
incoming USDC payment requests, and sign outgoing USDC transfers on **Solana
devnet**. Built with React + TypeScript + Tailwind CSS v4.

> All wallet balances and payment confirmations are read from Solana RPC.
> Outgoing transfers and withdrawals are signed by the Dynamic embedded wallet.
> Deposits show the wallet address; the app does not simulate or automatically
> credit deposits. Solana devnet tokens have no real value. Do not use for
> production funds.

## Quick start

```bash
npm install --legacy-peer-deps
cp .env.example .env.local
# Set VITE_DYNAMIC_ENVIRONMENT_ID to your Dynamic environment ID in .env.local

npm run dev
```

Open **http://localhost:3000**.

## Dynamic authentication and Solana wallet

The app uses Dynamic's headless JavaScript SDK and its email one-time-code
authentication flow. After sign-in, it creates a Dynamic embedded Solana wallet
for the account and displays the wallet address in Settings. The environment ID
is public client configuration; set it as `VITE_DYNAMIC_ENVIRONMENT_ID`.

In the [Dynamic Console](https://console.dynamic.xyz/), enable Email under
**Log in & User Profile**, enable the Solana/SVM chain, and enable **Embedded
Wallets** for Solana. Add the app's origin (for local development,
`http://localhost:3000`) to the environment's allowed origins. This integration
uses embedded wallets only; connecting external wallets and WalletConnect are
not enabled.

Implementation references: [React quickstart](https://www.dynamic.xyz/docs/javascript/reference/react-quickstart.md),
[email OTP](https://www.dynamic.xyz/docs/javascript/authentication-methods/email.md),
[Solana extensions](https://www.dynamic.xyz/docs/javascript/reference/solana/adding-solana-extensions.md),
and [embedded wallet quickstart](https://www.dynamic.xyz/docs/javascript/wallets/embedded-wallets/quickstart.md).

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  UI (React + Tailwind)          src/components/*             │
│  Header · BalanceCard · TransferFlow · DepositFlow ·         │
│  WithdrawFlow · QrScannerFlow · SettingsView · Receipts      │
└───────────────────────────┬──────────────────────────────────┘
                            │  src/adapters/index.ts (barrel)
                            ▼
┌──────────────────────────────────────────────────────────────┐
│  Solana Adapters (devnet)            src/adapters/*          │
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
the adapter barrel (`src/adapters/index.ts`) is the single entry point for
Solana reads and payment verification. There is no offline/mock chain mode.
Balances show native SOL and the aggregate USDC across the wallet's token
accounts. Recents are loaded from confirmed Solana history for the wallet and
its USDC token accounts, including incoming and outgoing movements; the history
is fetched from RPC and is not persisted in SQLite. The optional SQLite API is
separate and is not used for current wallet state or transaction history.

## Solana Pay Integration

| Feature | Component | Adapter | Status |
|---------|-----------|---------|--------|
| **Generate payment request** | `TransferFlow` | `createWebPaymentUrl()` | HTTPS app URL + QR; self-contained request data |
| **Pay a web request** | `WebPaymentPage` | Dynamic `transferAmount()` | Authenticated payer reviews amount and signs USDC transfer |
| **QR scanning** | `QrScannerFlow` | `parseWebPaymentUrl()` / `chain.parsePaymentRequest()` | Opens same-app web payment links; parses legacy Solana Pay requests |
| **Recipient validation** | `TransferFlow` | `chain.verifyRecipient(addr, asset)` | Rejects unsafe account types and requests review for off-curve wallets |
| **Balance reading** | `App` | `chain.getSolBalance()` + `chain.getBalance(wallet, USDC)` | SOL and aggregate USDC from live RPC |
| **Transaction history** | `App` | `getWalletTransactions(wallet)` | Paginated confirmed SOL and USDC inflows/outflows from RPC |
| **Outgoing USDC transfer / withdrawal** | `TransferFlow`, `WithdrawFlow` | Dynamic `transferAmount()` | Signed and submitted by the created Dynamic Solana wallet; destination must be a Solana address |
| **Receive address** | `DepositFlow` | `chain.renderQrDataUrl(address)` | Wallet address QR; balance updates are read from RPC |

On-chain transaction records retain the Solana signature and the associated
Dynamic wallet address. For web payments, the payer's Dynamic wallet signs and
the merchant's created wallet receives USDC.

### Flow: Create → Open → Pay

1. **Merchant** opens TransferFlow → "Generar link de pago" → enters amount/concept → "Confirmar"
   - Builds an HTTPS `/pay` URL carrying recipient, cluster, USDC mint, amount (if fixed), and concept.
   - QR encodes that web URL; creating it does not submit a transaction.
2. **Payer** opens the link or scans the QR, signs in with their own Dynamic account, reviews the request and live USDC balance, then signs the transfer from their Solana wallet.
3. **Merchant** refreshes the wallet history to see the confirmed incoming USDC movement.

This prototype's web link is self-contained and does not require backend link
storage. A deployed app must be reachable over HTTPS and its host must rewrite
`/pay` routes to the SPA entry point. A local `127.0.0.1` link is only usable
from the same machine. The web payment screen needs an app account and an
adequately funded wallet; a standard Solana wallet app will not treat an HTTPS
QR as a native Solana Pay request.

The configured default RPC is public Solana devnet. The app does not currently
support Solana testnet in its cluster type; use devnet for faucet-funded USDC
and SOL testing. Devnet tokens have no real value. Before handling real funds,
use a reliable RPC/indexing provider, persistent signature idempotency, and
production-grade monitoring. See
[Solana Payments](https://solana.com/docs/payments),
[Solana Pay](https://docs.solanapay.com/spec), and
[Production Readiness](https://solana.com/docs/tools/production-readiness).

## Project layout

```
src/
├── adapters/                    # Solana chain access (single entry point)
│   ├── index.ts                 # Live Solana access barrel
│   ├── solana-client.ts         # RPC client singleton + cluster config
│   ├── solana-pay.ts            # Solana Pay spec: encode/parse/QR/refs
│   ├── token.ts                 # ATA derivation, balances, recipient check
│   └── payment-verify.ts        # Verification, reference lookup, streaming
├── components/                  # UI screens and flows
│   ├── TransferFlow.tsx         # Send + Payment Link + Verify (real chain)
│   ├── QrScannerFlow.tsx        # Camera + Barcode Detection + parse
│   ├── BalanceCard.tsx          # USDC headline + SOL/USDC balances
│   ├── DepositFlow.tsx          # Solana receive address + QR
│   ├── WithdrawFlow.tsx         # Signed USDC transfer to Solana address
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
├── db/
│   ├── schema.ts                # Drizzle schema (9 tables)
│   ├── index.ts                 # SQLite connection + pragmas
│   └── migrations/              # Generated SQL migrations (committed)
├── i18n/translations.ts         # EN / ES strings
├── services/
│   ├── wallet.ts                # Optional SQLite API data access
│   ├── solanaHistory.ts         # Paginated SOL + USDC wallet history
├── types/wallet.ts              # UI domain types (Transaction, Contact, etc.)
└── App.tsx                      # Navigation + screen orchestration
server.ts                        # Optional read-only SQLite API
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
| `npm run db:studio` | Open Drizzle Studio |

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

These endpoints expose the optional SQLite-backed API only. The wallet UI does
not use them as a source of balances, transactions, or payment confirmations.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Service status and active cluster |
| GET | `/api/wallet` | Full snapshot: user, balance, transactions, contacts |
| GET | `/api/wallet/transactions` | Transaction list |
| GET | `/api/wallet/notifications` | Notifications + unread count |
| PATCH | `/api/settings/language` | Persist the user language |

## Environment

Create `.env.local` (copy from below, **do not commit**):

```env
# Solana devnet configuration
VITE_SOLANA_CLUSTER=devnet
VITE_SOLANA_RPC=https://api.devnet.solana.com
VITE_SOLANA_RPC_WS=wss://api.devnet.solana.com
VITE_PUBLIC_APP_URL=https://wallet.example.com

# Optional SQLite API configuration
VITE_API_BASE=http://localhost:3001
API_PORT=3001
DATABASE_URL=file:./data/rewallet.db

# AI (optional)
GEMINI_API_KEY=
APP_URL=http://localhost:3000
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Vite dev server (port 3000) |
| `npm run api` | Express API with watch (port 3001) |
| `npm run api:start` | Express API once (no watch) |
| `npm run build` | Production build (`dist/`) |
| `npm run preview` | Preview production build |
| `npm run lint` | TypeScript check (`tsc --noEmit`) |
| `npm test` | Solana Pay URL and payment-verification regression tests |
| `npm run clean` | Remove `dist/` and `server.js` |

## Key implementation details

### Adapter barrel (`src/adapters/index.ts`)

```typescript
// Single entry point — UI imports ONLY from here
import { chain } from '@/adapters';

chain.network()       // { cluster, rpcUrl, rpcSubscriptionsUrl }

// Payment URL/QR generation
chain.createPaymentRequest({ recipient, amount, asset, reference, label, message })
chain.generateReference()
chain.parsePaymentRequest(rawUrl)
chain.renderQrSvg(url)
chain.renderQrDataUrl(url)

// Balances (always read from the configured Solana RPC)
await chain.getBalance(owner, asset)

// Accounts
await chain.deriveAta(owner, asset)
await chain.verifyRecipient(recipient, asset)   // { ok, classified, canReceive, reason }
await chain.classifyAddress(addr)

// Verification
await chain.verifyPayment(reference, asset, recipient, expectedAmount)
await chain.findReferenceTransactions(reference)
chain.watchTokenAccount(owner, asset, onEvent, options)

// Commitment helpers
chain.meetsCommitment(observed, required)
chain.createInMemoryLedger()   // Utility only; production needs persistent idempotency
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
6. Returns `PaymentReceipt` with signature, slot, commitment, amount, and verified payer address

## Roadmap (remaining)

1. **History persistence** — persist verified on-chain transactions without treating unverified activity as a receipt
2. **Deposit monitoring** — detect incoming transfers and verify confirmations without requiring manual balance refresh
3. **Transaction requests** — backend `/api/solana-pay/tx` endpoint for Solana Pay transaction-request flows
4. **Handle resolution** — indexer-backed `@handle → address` lookup
5. **MariaDB** — swap Drizzle driver and run production schema
6. **Webhooks** — Helius/QuickNode webhooks for real-time balance updates instead of polling
7. **Fee abstraction** — sponsor priority fees so users never need SOL

## License

Apache-2.0