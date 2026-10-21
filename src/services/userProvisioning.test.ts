/**
 * The deterministic half of the user provisioning.
 *
 * The insert itself needs a database, so it is covered by the audit scripts
 * against a running server. What is covered here is the part that decides
 * what the user sees: the handle.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveDesiredHandle } from './userProvisioning';

const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';

test('the profile handle wins', () => {
  const handle = deriveDesiredHandle(WALLET, {
    handle: 'ada.lovelace',
    email: 'ada@example.com',
  });
  assert.equal(handle, 'ada.lovelace');
});

test('a handle is lower cased and stripped of what a link cannot carry', () => {
  const handle = deriveDesiredHandle(WALLET, { handle: '  Ada Lovelace!  ' });
  assert.equal(handle, 'ada-lovelace');
});

test('a handle is capped so it fits the column', () => {
  const handle = deriveDesiredHandle(WALLET, { handle: 'a'.repeat(80) });
  assert.equal(handle.length, 32);
});

test('the e-mail is the fallback when there is no handle', () => {
  const handle = deriveDesiredHandle(WALLET, { email: 'ada.lovelace@example.com' });
  assert.equal(handle, 'ada.lovelace');
});

test('the wallet is the last resort, so a handle always exists', () => {
  const handle = deriveDesiredHandle(WALLET, {});
  assert.equal(handle, `user-${WALLET.slice(0, 6).toLowerCase()}`);
});

test('a handle that sanitizes to nothing falls through to the next source', () => {
  const handle = deriveDesiredHandle(WALLET, { handle: '!!!', email: 'ada@example.com' });
  assert.equal(handle, 'ada');
});
