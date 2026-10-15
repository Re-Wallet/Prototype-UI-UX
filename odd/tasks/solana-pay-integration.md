# ODD Feature: Solana Pay Integration — Wire UI to Real Adapters

**Created**: 2026-10-15  
**Status**: In Progress  
**Branch**: feature/solana-pay-integration (to be created)

## Context

The prototype has a complete, well-structured adapter layer in `src/adapters/` following the Solana Pay spec and Solana payments documentation:
- `solana-client.ts` — RPC client configuration (devnet/mainnet via env)
- `solana-pay.ts` — URL encoding/parsing, QR generation per spec
- `token.ts` — ATA derivation, balance reading, recipient verification
- `payment-verify.ts` — Payment verification, reference lookup, transaction inspection
- `index.ts` — Barrel export with `mock`/`devnet` mode switch via `VITE_USE_CHAIN`

Contracts in `src/contracts/` define pure types for payments and tokens.

**However**, the UI components (`TransferFlow`, `QrScannerFlow`, `walletRepository`) still use mock data and simulated flows. The adapters are not connected to the UI.

## Goal

Wire the UI to the real Solana adapters so the prototype works against **Solana devnet** with real:
- Payment request generation (transfer requests + QR codes)
- QR scanning → Solana Pay URL parsing
- Balance reads from chain
- Payment verification via reference tracking
- Recipient validation before sending

## Tasks

### 1. Environment & Configuration
- [ ] Create `.env.local` with devnet RPC endpoints (Helius/QuickNode/Alchemy if available, else public)
- [ ] Set `VITE_USE_CHAIN=true` to enable devnet mode
- [ ] Set `VITE_SOLANA_CLUSTER=devnet`
- [ ] Verify `resetClients()` works for runtime cluster switching

### 2. TransferFlow → Real Solana Pay
- [ ] Replace mock payment link generation with `chain.createPaymentRequest()` from adapters
- [ ] Use real `generateReference()` for each payment intent
- [ ] Display real QR codes from `renderQrSvg`/`renderQrDataUrl`
- [ ] Store payment intent in local state with reference for later verification
- [ ] Remove mock `INITIAL_CONTACTS`/`INITIAL_USER` imports; use wallet repository

### 3. QrScannerFlow → Real Solana Pay Parsing
- [ ] Replace simulated detection with real camera + `parsePaymentRequest()`
- [ ] Handle both transfer requests and transaction requests
- [ ] On parsed transfer request: navigate to TransferFlow amount screen with pre-filled recipient/amount/asset
- [ ] On parsed transaction request: show link details and open in wallet

### 4. Wallet Repository → Real Data
- [ ] Enable `VITE_USE_API=true` and start API server (`npm run api`)
- [ ] Run `npm run db:push && npm run db:seed` for devnet demo data
- [ ] Verify `httpWalletRepository` fetches real snapshot
- [ ] Remove `mockWalletRepository` fallback or keep as last resort

### 5. Balance Reading from Chain
- [ ] In `BalanceCard` / wallet snapshot: call `chain.getBalances()` for user's SOL + USDC
- [ ] Show real devnet balances (will be 0 initially — that's fine)
- [ ] Add loading state while fetching

### 6. Payment Verification Flow
- [ ] After sending payment (via wallet), store reference + intent locally
- [ ] Use `chain.verifyPayment()` to watch for confirmation
- [ ] Update transaction status in UI when verified (pending → confirmed)
- [ ] Use `createInMemoryLedger()` to prevent double-counting

### 7. Recipient Validation
- [ ] Before sending: call `chain.verifyRecipient()` to check address class
- [ ] Show clear error if recipient is a token account / mint / program
- [ ] Only allow SOL to wallets, tokens to matching ATAs

## Acceptance Criteria

- [ ] `npm run dev` + `npm run api` starts without errors
- [ ] TransferFlow "Generar link de pago" produces real `solana:` URLs with valid QR codes
- [ ] QrScannerFlow scans a real Solana Pay QR and parses it correctly
- [ ] BalanceCard shows real devnet balances (0 USDC, 0 SOL for new wallet)
- [ ] Payment verification works: scan QR → send from Phantom → UI shows confirmed
- [ ] No mock data imports in production code paths (mock only for offline fallback)

## Files Likely to Change

| File | Change |
|------|--------|
| `src/components/TransferFlow.tsx` | Wire to `chain.createPaymentRequest`, `chain.generateReference` |
| `src/components/QrScannerFlow.tsx` | Wire to `chain.parsePaymentRequest` |
| `src/components/BalanceCard.tsx` | Wire to `chain.getBalances` |
| `src/services/walletRepository.ts` | Enable API mode, remove mock fallback |
| `.env.local` | Devnet RPC config |
| `src/App.tsx` | Pass chain adapter to flows, manage payment intents |
| `src/adapters/index.ts` | Verify exports, add any missing helpers |

## Notes

- The adapters are designed for **devnet first**. Mainnet is a config change.
- Mock mode (`VITE_USE_CHAIN` not `true`) must keep working for offline demos.
- Payment intents need local persistence (localStorage or DB) to survive reloads for verification.
- The `@solana/kit` types in adapters are narrow (`PaymentRpcApi`) — verify all used methods are typed.