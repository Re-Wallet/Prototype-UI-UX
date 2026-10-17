import assert from 'node:assert/strict';
import test from 'node:test';
import type { Address } from '../contracts/payments';
import { createWebPaymentUrl, parseWebPaymentUrl } from './webPaymentLink';

const recipient = 'B4iJDSHPm1hsWDd4Y8dUwA9x29nKC11TtZrYi1Psg1vw' as Address;
const mint = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' as Address;

test('creates an HTTPS route with payment details and round-trips it', () => {
  const payment = {
    recipient,
    amount: 2.5,
    mint,
    cluster: 'devnet' as const,
    message: 'Testing invoice #5',
  };
  const url = createWebPaymentUrl(payment, 'https://wallet.example');

  assert.match(url, /^https:\/\/wallet\.example\/pay\?/);
  assert.deepEqual(parseWebPaymentUrl(url), payment);
});

test('supports open amount requests and rejects malformed or unsupported links', () => {
  const url = createWebPaymentUrl({
    recipient,
    amount: null,
    mint,
    cluster: 'devnet',
    message: '',
  }, 'http://127.0.0.1:3000');

  assert.equal(parseWebPaymentUrl(url)?.amount, null);
  assert.equal(parseWebPaymentUrl(`${url}&amount=1e3`), null);
  assert.equal(parseWebPaymentUrl(`${url}&amount=0.0000001`), null);
  assert.equal(parseWebPaymentUrl(url.replace('cluster=devnet', 'cluster=mainnet-beta')), null);
  assert.equal(parseWebPaymentUrl('https://wallet.example/not-pay?recipient=x'), null);
});

test('requires HTTPS for non-local web payment links', () => {
  assert.throws(() => createWebPaymentUrl({
    recipient,
    amount: 1,
    mint,
    cluster: 'devnet',
    message: '',
  }, 'http://wallet.example'), /HTTPS/);
});
