/**
 * Session verification tests.
 *
 * Everything here is hermetic: the RSA key pair is generated in the test, the
 * token is signed in the test, and the key set is local. No network, no
 * database, no Dynamic environment.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';

import {
  collectSolanaAddresses,
  createDynamicSessionVerifier,
  dynamicJwksUrl,
  SessionVerificationError,
  type SessionVerifier,
} from './dynamicSession';

const ENVIRONMENT_ID = 'env-test-1234';
const WALLET = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
const OTHER_WALLET = '7cVfgArCheMR6CsD3b4UfWqB3wbcJgTyaQTuo1cNkD7V';

/** A locally generated signing key and the key set that resolves it. */
const { privateKey, publicKey } = await generateKeyPair('RS256');
const publicJwk: JWK = {
  ...(await exportJWK(publicKey)),
  kid: 'test-key',
  alg: 'RS256',
  use: 'sig',
};
const keyResolver = createLocalJWKSet({ keys: [publicJwk] });

const verifier: SessionVerifier = createDynamicSessionVerifier({
  environmentId: ENVIRONMENT_ID,
  keyResolver,
});

/** Sign a token with the given claims. */
async function signToken(
  claims: Record<string, unknown>,
  options: { expiresIn?: string; issuer?: string; kid?: string } = {}
): Promise<string> {
  const issuer = options.issuer ?? `app.dynamicauth.com/${ENVIRONMENT_ID}`;
  return await new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: options.kid ?? 'test-key' })
    .setSubject(typeof claims.sub === 'string' ? claims.sub : 'dyn-user-1')
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '2h')
    .sign(privateKey);
}

/** The claims a real Dynamic session carries. */
function sessionClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    environmentId: ENVIRONMENT_ID,
    scope: 'user:basic profile',
    email: 'ada@example.com',
    blockchainAccounts: [{ address: WALLET, chain: 'SOL', walletName: 'Phantom' }],
    ...overrides,
  };
}

test('a valid session yields the user and the wallets it controls', async () => {
  const token = await signToken(sessionClaims());
  const claims = await verifier.verify(token);

  assert.equal(claims.dynamicUserId, 'dyn-user-1');
  assert.equal(claims.email, 'ada@example.com');
  assert.deepEqual(claims.solanaAddresses, [WALLET]);
});

test('a session that carries the wallet in verifiedCredentials is accepted', async () => {
  const token = await signToken(
    sessionClaims({ blockchainAccounts: undefined, verifiedCredentials: [{ id: 'c1', address: WALLET, chain: 'Solana' }] })
  );
  const claims = await verifier.verify(token);

  assert.deepEqual(claims.solanaAddresses, [WALLET]);
});

test('a session for a different environment is rejected', async () => {
  const token = await signToken(sessionClaims({ environmentId: 'env-other' }));

  await assert.rejects(
    () => verifier.verify(token),
    (error: unknown) =>
      error instanceof SessionVerificationError && error.reason === 'wrong_environment'
  );
});

test('a session without the user:basic scope is rejected', async () => {
  const token = await signToken(sessionClaims({ scope: 'profile' }));

  await assert.rejects(
    () => verifier.verify(token),
    (error: unknown) =>
      error instanceof SessionVerificationError && error.reason === 'insufficient_scope'
  );
});

test('the scope check accepts a list, not only the exact string', async () => {
  const token = await signToken(sessionClaims({ scope: 'profile user:basic wallet:read' }));

  const claims = await verifier.verify(token);
  assert.equal(claims.dynamicUserId, 'dyn-user-1');
});

test('an expired session is rejected', async () => {
  const token = await signToken(sessionClaims(), { expiresIn: '-1h' });

  await assert.rejects(
    () => verifier.verify(token),
    (error: unknown) =>
      error instanceof SessionVerificationError && error.reason === 'expired_token'
  );
});

test('a token signed by another key is rejected', async () => {
  const other = await generateKeyPair('RS256');
  const token = await new SignJWT(sessionClaims())
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(`app.dynamicauth.com/${ENVIRONMENT_ID}`)
    .setIssuedAt()
    .setExpirationTime('2h')
    .sign(other.privateKey);

  await assert.rejects(
    () => verifier.verify(token),
    (error: unknown) =>
      error instanceof SessionVerificationError && error.reason === 'invalid_signature'
  );
});

test('a token signed with an unexpected algorithm is rejected', async () => {
  // `alg: none` is the classic JWT downgrade. The verifier pins RS256, so the
  // token must never be honoured.
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ ...sessionClaims(), sub: 'dyn-user-1', iss: `app.dynamicauth.com/${ENVIRONMENT_ID}` })
  ).toString('base64url');
  const unsigned = `${header}.${payload}.`;

  await assert.rejects(() => verifier.verify(unsigned));
});

test('a malformed token is rejected', async () => {
  await assert.rejects(
    () => verifier.verify('not-a-jwt'),
    (error: unknown) =>
      error instanceof SessionVerificationError && error.reason === 'malformed_token'
  );
});

test('an empty token is rejected as missing', async () => {
  await assert.rejects(
    () => verifier.verify('   '),
    (error: unknown) =>
      error instanceof SessionVerificationError && error.reason === 'missing_token'
  );
});

test('the JWKS endpoint is the one for this environment', () => {
  assert.equal(
    dynamicJwksUrl('env-abc'),
    'https://app.dynamicauth.com/api/v0/sdk/env-abc/.well-known/jwks'
  );
});

test('only the Solana addresses of a session are collected', () => {
  const addresses = collectSolanaAddresses({
    blockchainAccounts: [
      { address: WALLET, chain: 'SOL' },
      { address: '0x1234567890abcdef1234567890abcdef12345678', chain: 'EVM' },
    ],
    verifiedCredentials: [{ id: 'c1', address: OTHER_WALLET, chain: 'Solana' }],
  });

  assert.deepEqual(addresses.sort(), [WALLET, OTHER_WALLET].sort());
});

test('an address that is not base58 is not collected', () => {
  const addresses = collectSolanaAddresses({
    blockchainAccounts: [{ address: 'not-base58-0OIl', chain: 'SOL' }],
  });

  assert.deepEqual(addresses, []);
});
