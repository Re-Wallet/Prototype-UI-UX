import assert from 'node:assert/strict';
import test from 'node:test';

import type { Address, Reference, TokenAsset } from '../contracts/payments';
import { amountFromBase } from '../contracts/tokens';
import { verifyPayment } from './payment-verify';
import { resetClients } from './solana-client';
import { deriveAta } from './token';
import { generateReference } from './solana-pay';

const recipient = '11111111111111111111111111111111' as Address;
const payer = 'Vote111111111111111111111111111111111111111' as Address;
const asset: TokenAsset = {
  symbol: 'USDC',
  mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' as Address,
  program: 'spl-token',
  decimals: 6,
};
const signature = '1'.repeat(64);

async function verifyWithRpc(
  options: { amount: string; commitment: string },
  expectedAmount: bigint
) {
  const reference = generateReference();
  const ata = await deriveAta(recipient, asset);
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (_input, init) => {
    const request = JSON.parse(String(init?.body)) as { id: string; method: string };
    const result = request.method === 'getSignaturesForAddress'
      ? [{
          signature,
          slot: 123,
          err: null,
          blockTime: 1_800_000_000,
          confirmationStatus: options.commitment,
        }]
      : {
          slot: 123,
          blockTime: 1_800_000_000,
          meta: {
            err: null,
            fee: 5_000,
            preBalances: [1, 1, 1],
            postBalances: [1, 1, 1],
            preTokenBalances: [
              { accountIndex: 0, mint: asset.mint, owner: recipient, uiTokenAmount: { amount: '0', decimals: 6, uiAmount: 0, uiAmountString: '0' } },
              { accountIndex: 2, mint: asset.mint, owner: payer, uiTokenAmount: { amount: '50000000', decimals: 6, uiAmount: 50, uiAmountString: '50' } },
            ],
            postTokenBalances: [
              { accountIndex: 0, mint: asset.mint, owner: recipient, uiTokenAmount: { amount: options.amount, decimals: 6, uiAmount: Number(options.amount) / 1_000_000, uiAmountString: options.amount } },
              { accountIndex: 2, mint: asset.mint, owner: payer, uiTokenAmount: { amount: String(50_000_000n - BigInt(options.amount)), decimals: 6, uiAmount: 0, uiAmountString: '0' } },
            ],
            innerInstructions: [],
            logMessages: [],
            rewards: [],
            status: { Ok: null },
          },
          transaction: {
            message: {
              accountKeys: [
                { pubkey: ata, signer: false, writable: true, source: 'transaction' },
                { pubkey: reference, signer: false, writable: false, source: 'transaction' },
                { pubkey: payer, signer: true, writable: true, source: 'transaction' },
              ],
              instructions: [],
              recentBlockhash: '11111111111111111111111111111111',
            },
            signatures: [signature],
          },
          version: 'legacy',
        };

    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: request.id,
      result,
    }), { headers: { 'content-type': 'application/json' } });
  };

  resetClients();
  try {
    return await verifyPayment(
      {
        reference: reference as Reference,
        expectedRecipient: recipient,
        expectedAmount: amountFromBase(expectedAmount, asset),
      },
      asset,
      recipient
    );
  } finally {
    resetClients();
    globalThis.fetch = originalFetch;
  }
}

test('verifies the recipient ATA by transaction account index and honors confirmed status', async () => {
  const result = await verifyWithRpc({ amount: '25500000', commitment: 'confirmed' }, 25_000_000n);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.receipt.amount.base, 25_500_000n);
  assert.equal(result.receipt.counterparty, payer);
  assert.equal(result.receipt.status, 'confirmed');
});

test('does not accept an underpayment', async () => {
  const result = await verifyWithRpc({ amount: '24999999', commitment: 'confirmed' }, 25_000_000n);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.reason, /Underpaid/);
});

test('does not accept a merely processed transaction', async () => {
  const result = await verifyWithRpc({ amount: '25000000', commitment: 'processed' }, 25_000_000n);

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 'processed');
});
