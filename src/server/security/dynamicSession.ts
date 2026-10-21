/**
 * Dynamic session verification.
 *
 * The browser already holds a session: Dynamic signs one. This module turns
 * that signed token into the facts the API is allowed to trust — which user
 * is calling, and which Solana addresses that user actually controls.
 *
 * Why the signature is the whole security boundary
 * -------------------------------------------------
 * Every user-scoped route used to be scoped by a `?wallet=<base58>` query
 * parameter, validated only by a regular expression. A parameter is a
 * *request*, not an *identity*: anybody can put somebody else's address in
 * it. The Dynamic token is signed by Dynamic, so the address inside it is a
 * *claim* the server can verify instead of a value the caller chose.
 *
 * The key set is fetched per environment id, so a token minted by a different
 * Dynamic environment cannot verify against this one even if it is copied
 * verbatim. That is what binds the session to this deployment.
 *
 * The claims we read
 * ------------------
 * - `sub` — Dynamic's user id.
 * - `scope` — a whitespace-separated permission list. `user:basic` is the
 *   minimum a session needs to be a person.
 * - `environmentId` / `iss` — which Dynamic environment minted the token.
 * - `blockchainAccounts[]` / `verifiedCredentials[]` — the addresses the user
 *   controls, each with its chain.
 * - `email` — the account e-mail, when the token carries it.
 *
 * There is deliberately no `dynamicUserId` column on `users`: the session
 * already carries the Solana address, and that address is what the ledger is
 * keyed by. Adding a column would mean a migration and a population path for
 * a fact we already have.
 */

import { errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';

import { BASE58_RE } from './address';
import { createCachingJwksResolver, SessionUnavailableError } from './jwks';

/** Where Dynamic publishes the signing keys for an environment. */
const DEFAULT_JWKS_BASE = 'https://app.dynamicauth.com/api/v0/sdk';

/** The scope a session must carry to be treated as a person. */
const REQUIRED_SCOPE = 'user:basic';

/**
 * Whether the missing-environment misconfiguration has already been reported.
 *
 * Once per process, like the client's missing-client warning: a long-lived
 * process says it one time, and a serverless isolate says it one time per
 * isolate, which is the right granularity there.
 */
let warnedAboutMissingEnvironment = false;

/** Why a session could not be established. Safe to surface to the client. */
export type SessionFailureReason =
  | 'missing_token'
  | 'malformed_token'
  | 'invalid_signature'
  | 'expired_token'
  | 'wrong_environment'
  | 'insufficient_scope'
  | 'auth_unavailable';

/** A session that could not be verified. */
export class SessionVerificationError extends Error {
  readonly reason: SessionFailureReason;

  constructor(reason: SessionFailureReason, message: string) {
    super(message);
    this.name = 'SessionVerificationError';
    this.reason = reason;
  }
}

/** What the API is allowed to trust once a session is verified. */
export interface DynamicSessionClaims {
  /** Dynamic's user id (the `sub` claim). */
  dynamicUserId: string;
  /** The account e-mail, when the session carries one. */
  email: string | null;
  /** Every Solana address this session proves the caller controls. */
  solanaAddresses: string[];
}

/** Verifies a session token. */
export interface SessionVerifier {
  verify(token: string): Promise<DynamicSessionClaims>;
}

export interface SessionVerifierOptions {
  /** The Dynamic environment id this deployment belongs to. */
  environmentId: string;
  /**
   * Override the key resolver. Production uses the remote JWKS; tests inject
   * a local key set so the whole path is exercised without a network.
   */
  keyResolver?: JWTVerifyGetKey;
  /** Override the JWKS endpoint. */
  jwksUrl?: string;
  /** Seconds of clock skew tolerated on `exp` and `nbf`. */
  clockToleranceSeconds?: number;
}

/** The JWKS endpoint for a Dynamic environment. */
export function dynamicJwksUrl(environmentId: string): string {
  return `${DEFAULT_JWKS_BASE}/${environmentId}/.well-known/jwks`;
}

/**
 * Build the verifier for this deployment.
 *
 * The key set is cached for ten minutes and refreshed on demand when a token
 * arrives with an unknown `kid`, so a key rotation by Dynamic does not
 * require a redeploy. When the endpoint is unreachable the cached set keeps
 * working for a while, and a cold isolate reports the dependency as
 * unavailable rather than as a rejected session.
 */
export function createDynamicSessionVerifier(options: SessionVerifierOptions): SessionVerifier {
  const { environmentId, clockToleranceSeconds = 5 } = options;

  const keyResolver =
    options.keyResolver ??
    createCachingJwksResolver({ url: options.jwksUrl ?? dynamicJwksUrl(environmentId) });

  return {
    async verify(token: string): Promise<DynamicSessionClaims> {
      const raw = typeof token === 'string' ? token.trim() : '';
      if (!raw) {
        throw new SessionVerificationError('missing_token', 'No session token was provided.');
      }

      let payload: JWTPayload;
      try {
        ({ payload } = await jwtVerify(raw, keyResolver, {
          // Pin the algorithm. A token that asks for `none`, or for an HMAC
          // signed with the public key, must never be honoured.
          algorithms: ['RS256'],
          clockTolerance: clockToleranceSeconds,
        }));
      } catch (error) {
        throw toVerificationError(error);
      }

      const subject = typeof payload.sub === 'string' ? payload.sub.trim() : '';
      if (!subject) {
        throw new SessionVerificationError('malformed_token', 'The session carries no subject.');
      }

      if (!isForEnvironment(payload, environmentId)) {
        throw new SessionVerificationError(
          'wrong_environment',
          'The session belongs to a different Dynamic environment.'
        );
      }

      const scopes = typeof payload.scope === 'string' ? payload.scope.split(/\s+/).filter(Boolean) : [];
      if (!scopes.includes(REQUIRED_SCOPE)) {
        throw new SessionVerificationError(
          'insufficient_scope',
          'The session does not carry the user:basic scope.'
        );
      }

      return {
        dynamicUserId: subject,
        email: typeof payload.email === 'string' ? payload.email : null,
        solanaAddresses: collectSolanaAddresses(payload),
      };
    },
  };
}

/**
 * Map a `jose` failure onto the reason vocabulary.
 *
 * The reason is safe to return to the client: it says what was wrong with the
 * credential, never anything about the account behind it.
 */
function toVerificationError(error: unknown): SessionVerificationError {
  if (error instanceof SessionUnavailableError) {
    // The key set could not be fetched. That is a broken dependency, not a
    // rejected credential, and the API answers 503 for it.
    throw error;
  }
  if (error instanceof errors.JWTExpired) {
    return new SessionVerificationError('expired_token', 'The session has expired.');
  }
  if (error instanceof errors.JWSSignatureVerificationFailed) {
    return new SessionVerificationError('invalid_signature', 'The session signature does not verify.');
  }
  if (error instanceof errors.JWTClaimValidationFailed) {
    return new SessionVerificationError('malformed_token', 'The session claims are not valid.');
  }
  if (error instanceof errors.JOSEAlgNotAllowed) {
    return new SessionVerificationError('invalid_signature', 'The session uses a rejected algorithm.');
  }
  if (error instanceof errors.JWSInvalid || error instanceof errors.JWTInvalid) {
    return new SessionVerificationError('malformed_token', 'The session token could not be read.');
  }
  return new SessionVerificationError('malformed_token', 'The session token could not be verified.');
}

/**
 * Is this token for our environment?
 *
 * The signature already binds it — the key set belongs to one environment —
 * so this is the second lock on the same door. The comparison is **exact**:
 *
 * - The `environmentId` claim, when present, has to equal ours.
 * - Otherwise the issuer's last path segment has to equal ours. A substring
 *   match would accept a token from an environment whose id merely
 *   *contains* ours (`env-1` against `env-12`), which is exactly the
 *   cross-environment acceptance this check exists to prevent.
 * - With neither a claim nor a usable issuer, the token is rejected: a
 *   session that cannot say which environment minted it is not one this
 *   deployment should honour.
 */
function isForEnvironment(payload: JWTPayload, environmentId: string): boolean {
  if (!environmentId) {
    // A deployment with no environment id cannot verify any session. That is
    // a misconfiguration, not a rejected credential, so it says so out loud
    // instead of quietly failing every request.
    if (!warnedAboutMissingEnvironment) {
      warnedAboutMissingEnvironment = true;
      console.error(
        '[auth] no Dynamic environment id is configured; every session will be rejected.'
      );
    }
    return false;
  }

  const claimed = typeof payload.environmentId === 'string' ? payload.environmentId : '';
  if (claimed) return claimed === environmentId;

  const issuer = typeof payload.iss === 'string' ? payload.iss : '';
  if (!issuer) return false;

  const segment = issuer.split('/').filter(Boolean).pop() ?? '';
  return segment === environmentId;
}

/**
 * Collect the Solana addresses the session proves the caller controls.
 *
 * When any entry names its chain, only the Solana entries are taken. When no
 * entry names a chain, every base58 address is taken: the session is already
 * proven to belong to this user, and the ledger only knows Solana addresses
 * anyway.
 */
export function collectSolanaAddresses(payload: JWTPayload): string[] {
  const entries: unknown[] = [
    ...(Array.isArray(payload.blockchainAccounts) ? payload.blockchainAccounts : []),
    ...(Array.isArray(payload.verifiedCredentials) ? payload.verifiedCredentials : []),
  ];
  if (entries.length === 0) return [];

  const named = entries.filter((entry) => {
    const chain = (entry as { chain?: unknown }).chain;
    return typeof chain === 'string' && chain.trim().length > 0;
  });
  const pool = named.length > 0 ? named : entries;

  const addresses = new Set<string>();
  for (const entry of pool) {
    const record = entry as { address?: unknown; chain?: unknown };
    if (named.length > 0) {
      const chain = typeof record.chain === 'string' ? record.chain : '';
      if (!/^sol(ana)?$/i.test(chain.trim())) continue;
    }
    const address = typeof record.address === 'string' ? record.address.trim() : '';
    if (BASE58_RE.test(address)) addresses.add(address);
  }
  return [...addresses];
}
