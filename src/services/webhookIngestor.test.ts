/**
 * Webhook payload parsing.
 *
 * The projection reads a payload that arrives from outside, so the parser is
 * where a malformed number has to be caught: a zero, a negative, a NaN or an
 * absurd amount is not a movement, and it must never become a row in the
 * ledger.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { parseEnvelope, parseWalletActivity } from './webhookIngestor';

const ADDRESS = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const OTHER = '7cVfgArCheMR6CsD3b4UfWqB3wbcJgTyaQTuo1cNkD7V';

/** A well-formed activity with one transfer of `amount`. */
function activityWithAmount(amount: unknown): Record<string, unknown> {
  return {
    transactionHash: 'sig-1',
    fromAddress: ADDRESS,
    toAddress: OTHER,
    assetTransfers: [
      {
        tokenAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        fromAddress: ADDRESS,
        toAddress: OTHER,
        amount,
        metadata: { symbol: 'USDC', decimals: 6 },
      },
    ],
  };
}

test('a well-formed activity parses', () => {
  const activity = parseWalletActivity(activityWithAmount(12.5));
  assert.ok(activity);
  assert.equal(activity.transactionHash, 'sig-1');
  assert.equal(activity.assetTransfers.length, 1);
  assert.equal(activity.assetTransfers[0].amount, 12.5);
});

test('a zero amount is not a movement', () => {
  const activity = parseWalletActivity(activityWithAmount(0));
  assert.ok(activity);
  assert.equal(activity.assetTransfers.length, 0);
});

test('a negative amount is not a movement', () => {
  const activity = parseWalletActivity(activityWithAmount(-5));
  assert.ok(activity);
  assert.equal(activity.assetTransfers.length, 0);
});

test('a non-finite amount is not a movement', () => {
  const activity = parseWalletActivity(activityWithAmount(Number.NaN));
  assert.ok(activity);
  assert.equal(activity.assetTransfers.length, 0);
});

test('an absurd amount is not a movement', () => {
  const activity = parseWalletActivity(activityWithAmount(1e15));
  assert.ok(activity);
  assert.equal(activity.assetTransfers.length, 0);
});

test('a non-numeric amount is not a movement', () => {
  const activity = parseWalletActivity(activityWithAmount('12.5'));
  assert.ok(activity);
  assert.equal(activity.assetTransfers.length, 0);
});

test('an envelope without a messageId is not an envelope', () => {
  assert.equal(parseEnvelope(JSON.stringify({ eventName: 'wallet.activity' })), null);
});

test('an envelope carries the message and the event', () => {
  const parsed = parseEnvelope(
    JSON.stringify({ messageId: 'msg-1', eventName: 'wallet.activity', userId: 'dyn-1' })
  );
  assert.ok(parsed);
  assert.equal(parsed.envelope.messageId, 'msg-1');
  assert.equal(parsed.envelope.eventName, 'wallet.activity');
  assert.equal(parsed.envelope.userId, 'dyn-1');
});
