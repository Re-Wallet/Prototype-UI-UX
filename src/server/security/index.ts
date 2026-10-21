/**
 * The server security layer.
 *
 * Everything here is server-only: the browser bundle must never import it.
 * `src/services/` is shared with the UI, so the server's own code lives
 * under `src/server/`.
 */

export {
  createDynamicSessionVerifier,
  dynamicJwksUrl,
  collectSolanaAddresses,
  SessionVerificationError,
  type DynamicSessionClaims,
  type SessionFailureReason,
  type SessionVerifier,
  type SessionVerifierOptions,
} from './dynamicSession';

export {
  extractSessionToken,
  requireOwnedWallet,
  requireSession,
  requireSessionFor,
  walletFromBody,
  walletFromQuery,
} from './session';

export {
  createCorsMiddleware,
  defaultAllowedOrigins,
  isOriginAllowed,
  originMatches,
  parseOriginPatterns,
  type CorsOptions,
  type OriginPattern,
} from './cors';

export { clientIp, createRateLimiter, pruneExpiredCallers, type RateLimitOptions } from './rateLimit';

export {
  buildContentSecurityPolicy,
  securityHeaders,
  type SecurityHeaderOptions,
} from './headers';

export { BASE58_RE, isBase58Address } from './address';

export {
  createCachingJwksResolver,
  SessionUnavailableError,
  type JwksResolverOptions,
} from './jwks';
