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

### Before the first payment: point Dynamic at real Solana devnet

This is the setup step most likely to send you down a wrong path. In the
Dynamic console, the Solana network labelled **devnet** ships with **no public
endpoint** ("This network has no public endpoint. Add your own."). If you leave
it empty, Dynamic resolves that network to whatever endpoint is configured
elsewhere — commonly an SVM L2 such as Eclipse — while this app talks to
`api.devnet.solana.com`.

The two disagree and the mismatch surfaces only at signing time, as
`Attempt to debit an account but found no record of a prior credit`, even
though the payer holds SOL and USDC. Network **names** are not network
identities; see [Network alignment](#network-alignment-dynamic-vs-app).

Set the devnet network RPC to `https://api.devnet.solana.com`, then hard-reload
the browser — Dynamic caches network configuration on the client.

Verify before funding anything:

| Cluster | Genesis hash |
|---------|--------------|
| mainnet-beta | `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` |
| devnet | `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` |
| testnet | `4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY` |
| Eclipse | `EAQLJCV2mh23BsK2P9oYpV5CHVLDNHTxYss3URrNmg3s` |

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
│  solana-client · solana-pay · token · payment-verify ·      │
│  dynamic-network (cluster alignment guard)                   │
└──────────────┬───────────────────────────────┬───────────────┘
               │ @solana/kit + devnet RPC      │ Dynamic SDK (transferAmount)
               ▼                               ▼
┌──────────────────────────────┐  ┌────────────────────────────┐
│  Solana devnet               │  │  Dynamic embedded wallet   │
│  api.devnet.solana.com       │  │  provider → active cluster │
└──────────────────────────────┘  └────────────────────────────┘
        two independent cluster sources — reconciled before signing
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

Note the two separate paths to the network: this app reads through
`@solana/kit`, while signing happens inside the Dynamic SDK. They resolve the
cluster independently, which is why `dynamic-network` sits between them.

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
| **Network alignment** | all signing paths | `chain.ensureDynamicNetwork()` | Fails closed when Dynamic's active cluster diverges from the app's |
| **Fee attribution** | all signing paths | Dynamic `transferAmount()` | Payer pays the network fee and the recipient's ATA rent |

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

## Network alignment (Dynamic vs app)

Two independent sources decide which Solana cluster a payment runs against:

| Source | Origin | Used by |
|--------|--------|---------|
| The app | `VITE_SOLANA_CLUSTER` via `resolveNetworkConfig()` | Balance reads, recipient checks, link creation |
| Dynamic | `walletProvider.getActiveNetworkId()` | `transferAmount()` — builds and signs the transaction |

`walletAccount` selects the provider but does **not** select the network. A
Dynamic environment with several SVM networks enabled can be connected to one of
them while the app validates against another, and nothing in either SDK objects.
The result is a transaction whose fee payer is an account with no balance on the
network actually used.

`src/adapters/dynamic-network.ts` closes that gap. Before any of the three
signing paths (`WebPaymentPage.handlePay`, `TransferFlow.handleExecuteSend`,
`WithdrawFlow.handleSend`), `chain.ensureDynamicNetwork()` compares the two and
**fails closed**:

```typescript
const alignment = await chain.ensureDynamicNetwork(walletAccount);
if (!alignment.ok) throw new Error(alignment.alignment.reason!);
```

Two details that matter:

- **Genesis hash is the primary signal, not the cluster label.** Dynamic labels
  an SVM L2 as `devnet`; the app also calls Solana devnet `devnet`. A
  label-only comparison reports them as aligned while funds sit on a chain the
  transaction never reaches.
- **Dynamic truncates genesis hashes to 31 characters.** Comparison uses a
  prefix match with a 20-character floor, which still separates Solana devnet
  from Eclipse — their hashes diverge at the second character.

When alignment cannot be confirmed the adapter returns `matchedBy: 'unknown'`
and refuses to sign. It will attempt a programmatic `switchActiveNetwork()` when
the provider exposes one and a matching network is configured.

### Where the fee lands

`transferAmount()` builds the transaction so that **the payer pays everything**:

| Cost | Paid by | Notes |
|------|---------|-------|
| Transaction fee (~0.000005 SOL) | Payer | `feePayer` is the payer's own account |
| ATA creation rent (~0.00148844 SOL) | Payer | Only when the recipient has no token account |

This is why a merchant with a completely empty wallet can issue a payment link
and still get paid: creating the recipient's associated token account is
permissionless, so the payer funds it on the merchant's behalf. No fee-abstraction
layer is required for that flow.

Note the scale difference. Rent is ~298x the network fee, so the dominant cost of
a payment to a first-time recipient is account creation, not gas. Fee sponsorship
that covers only the network fee does not remove the need for SOL.

## Project layout

```
src/
├── adapters/                    # Solana chain access (single entry point)
│   ├── index.ts                 # Live Solana access barrel
│   ├── solana-client.ts         # RPC client singleton + cluster config
│   ├── solana-pay.ts            # Solana Pay spec: encode/parse/QR/refs
│   ├── token.ts                 # ATA derivation, balances, recipient check
│   ├── dynamic-network.ts       # Dynamic-vs-app cluster alignment guard
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
│   └── tokens.ts                # TokenAsset, mint registry, conversions
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

Create `.env.local` (**do not commit**). These are the variables the code
actually reads:

```env
# Required
VITE_DYNAMIC_ENVIRONMENT_ID=your_dynamic_environment_id

# Public origin for shareable payment pages. Leave empty locally: the app then
# builds links from window.location.origin, which only resolves on the machine
# that generated them.
VITE_PUBLIC_APP_URL=

# Solana cluster. "devnet" (default) or "mainnet-beta".
VITE_SOLANA_CLUSTER=devnet

# RPC overrides. Empty falls back to the public cluster endpoints, which are
# rate-limited and have no SLA — use a dedicated provider beyond a demo.
VITE_SOLANA_RPC=
VITE_SOLANA_RPC_WS=

# Optional, read-only SQLite API only (npm run api)
API_PORT=3001
API_HOST=127.0.0.1
DATABASE_URL=./data/rewallet.db
```

> **`.env.example` is out of date.** It still carries `GEMINI_API_KEY` and
> `APP_URL` from an AI-Studio template — neither is imported anywhere in this
> repo — and it omits the three Solana network variables above. Copy the block
> from this section instead, or fix `.env.example` before relying on it.

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

## Known limitations

These are real and deliberately left in place; they are not bugs to fix later.

- **A payment link is replayable.** The `/pay` URL carries recipient, mint,
  cluster, amount and message — but no reference, nonce, id or expiry. Nothing
  distinguishes payment A from payment B toward the same address, and the only
  replay guard (`isSelfPayment`) is client-side within one session. Enforcing
  single use requires persisting `payment_links`, which is already modelled in
  `src/db/schema.ts` and never written.
- **Fee data is designed but unused.** `transactions.fee_usdc` and
  `fee_payer` (default `'protocol'`) exist in the schema and are never written.
  `i18n.translations.ts` carries a `chargeFee` string that is never rendered.
  This is unimplemented intent, not a bug.
- **The SQLite API is unreachable from the UI.** `server.ts` exposes five
  endpoints on port 3001; no code under `src/` calls them. The database has the
  schema applied and zero rows, so four of the five endpoints return 404. Start
  it only if you want to develop against it.
- **i18n covers half the app.** `TransferFlow`, `WithdrawFlow`, `DepositFlow`,
  `TransactionReceiptModal` and `AllTransactionsModal` hardcode Spanish strings
  and never read the translations module.
- **`npm test` does not run** on Node 22.21 — the built-in runner fails with
  `Missing internal module 'internal/deps/brace-expansion'` before loading any
  test file. Pre-existing and unrelated to application code.

## Roadmap (remaining)

1. **Single-use links** — persist `payment_links` and attach a per-link on-chain
   reference, so a link settles once and reconciles against a specific payment
2. **Fee abstraction** — let a payer settle in USDC without holding SOL. The
   network fee is sponsorable; account-creation rent is not, and it is ~298x
   larger
3. **History persistence** — persist verified on-chain transactions without
   treating unverified activity as a receipt
4. **Deposit monitoring** — detect incoming transfers and verify confirmations
   without requiring a manual balance refresh
5. **RPC provider** — move off the public devnet endpoint, which is rate-limited
   and has no SLA
6. **MariaDB** — swap the Drizzle driver and run the production schema

## License

Apache-2.0