/**
 * The two base58 rules, held together.
 *
 * The client checks an address with the Solana kit's rule (a real 32-byte
 * decode) and the server checks it with a structural rule (base58 alphabet,
 * 32-44 characters). Two copies of a rule is two chances to drift, and the
 * drift that hurts is the server being *stricter* than the client: the
 * client would send an address the server refuses, and the user would see a
 * rejection with no explanation.
 *
 * So the invariant this test pins is one-directional: everything the
 * adapter accepts, the server accepts too.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { isBase58 } from '../../adapters/solana-pay';
import { BASE58_RE } from './address';

/**
 * Real addresses: the two accounts in the ledger, the USDC mint and the
 * Token program. Every one of them is a valid Solana address.
 */
const VALID_ADDRESSES = [
  '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
  '5ZAwwBGV1JM9siEUnYrbChET8b7bZuxxrrRFKj72tMLb',
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
];

test('the server accepts every address the adapter accepts', () => {
  for (const address of VALID_ADDRESSES) {
    assert.ok(isBase58(address), `the adapter should accept ${address}`);
    assert.ok(BASE58_RE.test(address), `the server should accept ${address}`);
  }
});

test('the server rejects what base58 cannot encode', () => {
  // Base58 has no 0, O, I or l. An address carrying one is not an
  // address, and both rules have to say so.
  for (const address of [
    '0WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
    'OWzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
    'IWzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
    'lWzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
  ]) {
    assert.equal(isBase58(address), false, `the adapter should reject ${address}`);
    assert.equal(BASE58_RE.test(address), false, `the server should reject ${address}`);
  }
});

test('the server rejects an address that is too short or too long', () => {
  assert.equal(BASE58_RE.test('abc'), false);
  assert.equal(BASE58_RE.test('a'.repeat(45)), false);
});
