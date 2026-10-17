import assert from 'node:assert/strict';
import test from 'node:test';
import { getBase58Encoder } from '@solana/kit';

import {
  createPaymentRequest,
  encodeTransferRequest,
  formatSpecAmount,
  generateReference,
  isBase58,
  parsePaymentRequest,
} from './solana-pay';
import type { Address, TokenAmount, TokenAsset } from '../contracts/payments';

const recipient = '11111111111111111111111111111111' as Address;
const usdc: TokenAsset = {
  symbol: 'USDC',
  mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' as Address,
  program: 'spl-token',
  decimals: 6,
};

test('generates references that decode to exactly 32 bytes', () => {
  const reference = generateReference();

  assert.equal(isBase58(reference), true);
  assert.equal(getBase58Encoder().encode(reference).length, 32);
});

test('formats transfer amounts exactly from base units', () => {
  const half: TokenAmount = { base: 500_000n, decimals: 6, ui: 0.5 };
  const whole: TokenAmount = { base: 25_000_000n, decimals: 6, ui: 25 };

  assert.equal(formatSpecAmount(half, 6), '0.5');
  assert.equal(formatSpecAmount(whole, 6), '25');
  assert.throws(() => formatSpecAmount({ ...whole, base: -1n }, 6));
  assert.throws(() => formatSpecAmount(whole, 9));
});

test('encodes and parses a USDC payment request with a valid reference', () => {
  const reference = generateReference();
  const amount = { base: 25_000_000n, decimals: 6, ui: 25 };
  const url = encodeTransferRequest({
    recipient,
    amount,
    asset: usdc,
    reference,
    label: 'ReWallet',
    message: 'Invoice 123',
  }).toString();
  const parsed = parsePaymentRequest(url);

  assert.equal(parsed?.kind, 'transfer');
  if (parsed?.kind !== 'transfer') return;

  assert.equal(parsed.recipient, recipient);
  assert.equal(parsed.amount, '25');
  assert.equal(parsed.amountUi, 25);
  assert.equal(parsed.splToken, usdc.mint);
  assert.deepEqual(parsed.references, [reference]);
  assert.equal(parsed.message, 'Invoice 123');
});

test('creates a Solana Pay link and valid SVG/PNG QR codes for the recipient wallet', async () => {
  const reference = generateReference();
  const result = await createPaymentRequest({
    recipient,
    amount: { base: 25_000_000n, decimals: 6, ui: 25 },
    asset: usdc,
    reference,
    label: 'ReWallet',
    message: 'Invoice 123',
  });
  const parsed = parsePaymentRequest(result.url);
  const pngBytes = Buffer.from(result.qrDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');

  assert.equal(parsed?.kind, 'transfer');
  if (parsed?.kind !== 'transfer') return;
  assert.equal(parsed.recipient, recipient);
  assert.equal(parsed.amount, '25');
  assert.equal(parsed.splToken, usdc.mint);
  assert.deepEqual(parsed.references, [reference]);
  assert.match(result.qrSvg, /<svg/);
  assert.deepEqual([...pngBytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
});

test('rejects malformed recipients, references, amounts, and insecure transaction URLs', () => {
  const validReference = generateReference();
  const prefix = `solana:${recipient}`;

  assert.equal(parsePaymentRequest(`solana:invalid-address?reference=${validReference}`), null);
  assert.equal(parsePaymentRequest(`${prefix}?reference=not-a-valid-reference`), null);
  assert.equal(parsePaymentRequest(`${prefix}?amount=1e3`), null);
  assert.equal(parsePaymentRequest(`${prefix}?amount=1.1234567890`), null);
  assert.equal(parsePaymentRequest(`${prefix}?amount=`), null);
  assert.equal(parsePaymentRequest(`${prefix}?amount=1&amount=2`), null);
  assert.equal(parsePaymentRequest('solana:http://example.com/pay'), null);
  assert.equal(parsePaymentRequest('solana:https://%E0%A4%A'), null);
  assert.equal(parsePaymentRequest('solana:https://user:pass@example.com/pay'), null);
});
