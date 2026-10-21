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

import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';

/** Where Dynamic publishes the signing keys for an environment. */
const DEFAULT_JWKS_BASE = 'https://app.dynamicauth.com/api/v0/sdk';

/** A base58 Solana address: 32-44 characters, no 0 O I l. */
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** The scope a session must carry to be treated as a person. */
const REQUIRED_SCOPE = 'user:basic';

/** Why a session could not be established. Safe to surface to the client. */
export type SessionFailureReason =
  | 'missing_token'
  | 'malformed_token'
  | 'invalid_signature'
  | 'expired_token'
  | 'wrong_environment'
  | 'insufficient_scope';

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
 * The JWKS is cached by `jose` for ten minutes and refreshed on demand when
 * a token arrives with an unknown `kid`, so a key rotation by Dynamic does
 * not require a redeploy.
 */
export function createDynamicSessionVerifier(options: SessionVerifierOptions): SessionVerifier {
  const { environmentId, clockToleranceSeconds = 5 } = options;

  const keyResolver =
    options.keyResolver ??
    createRemoteJWKSet(new URL(options.jwksUrl ?? dynamicJwksUrl(environmentId)), {
      cacheMaxAge: 10 * 60 * 1000,
      cooldownDuration: 30 * 1000,
      timeoutDuration: 5 * 1000,
    });

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
 * so this is the second lock on the same door. When the token names its
 * environment, that name has to be ours. The issuer is only consulted when
 * the token does not carry the claim, and then it is matched by containment,
 * because Dynamic has used more than one issuer shape.
 */
function isForEnvironment(payload: JWTPayload, environmentId: string): boolean {
  const claimed = typeof payload.environmentId === 'string' ? payload.environmentId : '';
  if (claimed) return claimed === environmentId;

  const issuer = typeof payload.iss === 'string' ? payload.iss : '';
  if (issuer) return issuer.includes(environmentId);

  // The token names no environment at all. The key set already did the
  // binding, so there is nothing left to check.
  return true;
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
