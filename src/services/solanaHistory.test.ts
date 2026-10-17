import assert from 'node:assert/strict';
import test from 'node:test';
import type { Address } from '../contracts/payments';
import { parseWalletTransaction } from './solanaHistory';

const owner = 'B4iJDSHPm1hsWDd4Y8dUwA9x29nKC11TtZrYi1Psg1vw' as Address;
const recipient = '11111111111111111111111111111111';
const ata = 'J6e8PXMLRC5NSD79D3FQEbzP4w4BFUaUizthgHiATuFN';
const recipientAta = '11111111111111111111111111111112';
const usdcMint = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const signatureInfo = { signature: 'signature-1', blockTime: 1_760_000_000 };

test('parses native SOL and USDC outgoing movements without counting the network fee', () => {
  const transactions = parseWalletTransaction({
    transaction: {
      message: {
        accountKeys: [{ pubkey: owner }, { pubkey: recipient }, { pubkey: ata }, { pubkey: recipientAta }],
      },
    },
    meta: {
      err: null,
      fee: 5_000,
      preBalances: [5_000_000_000, 1_000_000_000, 2_039_280, 2_039_280],
      postBalances: [3_999_995_000, 2_000_000_000, 2_039_280, 2_039_280],
      preTokenBalances: [
        { accountIndex: 2, mint: usdcMint, owner, uiTokenAmount: { amount: '20000000', decimals: 6 } },
      ],
      postTokenBalances: [
        { accountIndex: 2, mint: usdcMint, owner, uiTokenAmount: { amount: '15000000', decimals: 6 } },
        { accountIndex: 3, mint: usdcMint, owner: recipient, uiTokenAmount: { amount: '5000000', decimals: 6 } },
      ],
    },
  }, owner, signatureInfo);

  assert.equal(transactions.length, 2);
  assert.deepEqual(
    transactions.map(({ assetSymbol, type, amount }) => ({ assetSymbol, type, amount })),
    [
      { assetSymbol: 'SOL', type: 'withdrawal', amount: 1 },
      { assetSymbol: 'USDC', type: 'sent', amount: 5 },
    ]
  );
});

test('parses incoming USDC and ignores failed transactions', () => {
  const incoming = parseWalletTransaction({
    transaction: {
      message: {
        accountKeys: [{ pubkey: owner }, { pubkey: ata }, { pubkey: recipientAta }],
      },
    },
    meta: {
      err: null,
      fee: 5_000,
      preBalances: [5_000_000_000, 2_039_280, 2_039_280],
      postBalances: [4_999_995_000, 2_039_280, 2_039_280],
      preTokenBalances: [
        { accountIndex: 2, mint: usdcMint, owner: recipient, uiTokenAmount: { amount: '2000000', decimals: 6 } },
      ],
      postTokenBalances: [
        { accountIndex: 1, mint: usdcMint, owner, uiTokenAmount: { amount: '2000000', decimals: 6 } },
        { accountIndex: 2, mint: usdcMint, owner: recipient, uiTokenAmount: { amount: '0', decimals: 6 } },
      ],
    },
  }, owner, signatureInfo);

  assert.equal(incoming.length, 1);
  assert.equal(incoming[0].type, 'received');
  assert.equal(incoming[0].amount, 2);

  const failed = parseWalletTransaction({
    transaction: { message: { accountKeys: [{ pubkey: owner }] } },
    meta: { err: { InstructionError: [0, 'Custom'] } },
  }, owner, signatureInfo);
  assert.deepEqual(failed, []);
});
