import assert from 'node:assert/strict';
import test from 'node:test';

import { buildLandingMetricsResponse } from './ledgerMetrics';

const dynamic = {
  users: 4,
  wallets: 4,
  sessions: 40,
  fetchedAt: '2026-10-21T00:00:00.000Z',
};

const ledger = {
  transactions: 41,
  volumeUsdc: 170.66,
  successRate: 100,
  avgProcessingMs: 1086,
  fetchedAt: '2026-10-21T00:00:00.000Z',
};

test('keeps the Dynamic fields untouched and adds the ledger ones', () => {
  const payload = buildLandingMetricsResponse(dynamic, ledger);

  assert.equal(payload.users, 4);
  assert.equal(payload.wallets, 4);
  assert.equal(payload.sessions, 40);
  assert.equal(payload.fetchedAt, dynamic.fetchedAt);

  assert.equal(payload.transactions, 41);
  assert.equal(payload.volumeUsdc, 170.66);
  assert.equal(payload.successRate, 100);
  assert.equal(payload.avgProcessingMs, 1086);
});

test('serves zeros for the ledger when the snapshot is not available yet', () => {
  const payload = buildLandingMetricsResponse(dynamic, null);

  assert.equal(payload.users, 4);
  assert.equal(payload.transactions, 0);
  assert.equal(payload.volumeUsdc, 0);
  assert.equal(payload.successRate, 0);
  assert.equal(payload.avgProcessingMs, 0);
});

test('rounds the volume and the rate to what a page can display', () => {
  const payload = buildLandingMetricsResponse(dynamic, {
    ...ledger,
    volumeUsdc: 170.6649,
    successRate: 98.7654,
  });

  assert.equal(payload.volumeUsdc, 170.66);
  assert.equal(payload.successRate, 98.77);
});
