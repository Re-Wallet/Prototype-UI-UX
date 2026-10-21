import assert from 'node:assert/strict';
import test from 'node:test';

import { toPendingChargeTransactions } from './pendingCharges';
import type { PaymentLinkDto } from './walletApi';

const NOW = Date.parse('2026-10-21T12:00:00.000Z');

function link(overrides: Partial<PaymentLinkDto> = {}): PaymentLinkDto {
  return {
    id: 7,
    slug: 'abc123',
    referencePubkey: 'Ref1111111111111111111111111111111111111',
    amountUsdc: 10,
    currency: 'USDC',
    concept: 'Honorarios',
    status: 'active',
    paidAmountUsdc: 0,
    paidAt: null,
    paidByPubkey: null,
    paidTxId: null,
    paidTxSignature: null,
    expiresAt: null,
    createdAt: '2026-10-21T11:00:00.000Z',
    ...overrides,
  };
}

test('an unpaid charge becomes a pending row in the activity list', () => {
  const [row] = toPendingChargeTransactions([link()], NOW);

  assert.ok(row, 'the charge produced no row');
  assert.equal(row.id, 'link-7');
  assert.equal(row.title, 'Honorarios');
  assert.equal(row.type, 'received');
  assert.equal(row.status, 'in_progress');
  assert.equal(row.amount, 10);
  assert.equal(row.assetSymbol, 'USDC');
  assert.equal(row.date.getTime(), Date.parse('2026-10-21T11:00:00.000Z'));
  assert.deepEqual(row.pendingCharge, {
    id: 7,
    reference: 'Ref1111111111111111111111111111111111111',
    slug: 'abc123',
  });
});

test('a settled charge is not pending anymore', () => {
  const rows = toPendingChargeTransactions(
    [
      link({ status: 'paid', paidAmountUsdc: 10, paidAt: '2026-10-21T11:30:00.000Z' }),
      link({ id: 8, status: 'expired' }),
      link({ id: 9, status: 'cancelled' }),
      link({ id: 10, status: 'partial' }),
    ],
    NOW
  );

  assert.equal(rows.length, 0);
});

test('a charge whose expiry already passed is not pending anymore', () => {
  const rows = toPendingChargeTransactions(
    [link({ expiresAt: '2026-10-21T11:30:00.000Z' })],
    NOW
  );

  assert.equal(rows.length, 0);
});

test('a charge that expires later is still pending', () => {
  const rows = toPendingChargeTransactions(
    [link({ expiresAt: '2026-10-21T13:00:00.000Z' })],
    NOW
  );

  assert.equal(rows.length, 1);
});

test('an open-amount charge has no amount to show yet', () => {
  const [row] = toPendingChargeTransactions([link({ amountUsdc: null })], NOW);

  assert.equal(row.amount, 0);
  assert.equal(row.fiatAmount, 0);
});
