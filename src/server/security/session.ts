/**
 * Session middleware: who is calling, and may they touch that wallet.
 *
 * The order is deliberate and it is the whole point of this module:
 *
 *   1. `requireSession`      → 401. No credential, no request.
 *   2. `requireOwnedWallet`  → 400 for a malformed address,
 *                              403 for an address this session does not own.
 *
 * Authentication comes before authorization, and authorization comes before
 * validation: a caller who cannot prove who they are has no business being
 * told whether the parameter they sent was well formed.
 *
 * Both checks run **before** any database call, so an unauthenticated
 * request costs one signature verification and nothing else.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';

import {
  SessionVerificationError,
  type DynamicSessionClaims,
  type SessionVerifier,
} from './dynamicSession';

/** A base58 Solana address: 32-44 characters, no 0 O I l. */
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** A JWT is three base64url segments separated by dots. */
const JWT_SHAPE_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** The verified session. Present only after `requireSession` ran. */
      session?: DynamicSessionClaims;
    }
  }
}

/**
 * Pull the session token out of the request.
 *
 * The header is the primary path: the browser reads `client.token` and sends
 * it as a bearer credential. The cookie is the fallback for deployments
 * where Dynamic stores the session in an HttpOnly cookie the JavaScript
 * cannot read — there, the browser sends it automatically and the server
 * picks it up.
 *
 * The cookie fallback matches on *shape* rather than on a name, because the
 * name is a Dynamic implementation detail. It is safe: a wrong cookie cannot
 * be accepted unless it verifies against this environment's signing keys.
 */
export function extractSessionToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (typeof header === 'string') {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match) {
      const token = match[1].trim();
      if (token) return token;
    }
  }

  const cookies = req.headers.cookie;
  if (typeof cookies === 'string') {
    for (const part of cookies.split(';')) {
      const separator = part.indexOf('=');
      if (separator === -1) continue;
      const value = part.slice(separator + 1).trim();
      if (!JWT_SHAPE_RE.test(value)) continue;
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }

  return null;
}

/**
 * Require a verified session.
 *
 * A missing or unusable credential is a `401` with a reason code the client
 * can act on (re-authenticate) and nobody else can learn from.
 */
export function requireSession(verifier: SessionVerifier): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = extractSessionToken(req);
    if (!token) {
      res.status(401).json({ error: 'Authentication required.', reason: 'missing_token' });
      return;
    }

    verifier
      .verify(token)
      .then((claims) => {
        req.session = claims;
        next();
      })
      .catch((error: unknown) => {
        const reason =
          error instanceof SessionVerificationError ? error.reason : 'malformed_token';
        res.status(401).json({ error: 'Invalid or expired session.', reason });
      });
  };
}

/**
 * Require that the session controls the wallet the request names.
 *
 * `read` pulls the address out of wherever the route keeps it (a query
 * parameter for reads, a body field for writes).
 */
export function requireOwnedWallet(read: (req: Request) => unknown): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const raw = read(req);
    const wallet = typeof raw === 'string' ? raw.trim() : '';

    if (!BASE58_RE.test(wallet)) {
      res.status(400).json({ error: 'wallet must be a base58 Solana address.' });
      return;
    }

    const session = req.session;
    if (!session || !session.solanaAddresses.includes(wallet)) {
      res.status(403).json({ error: 'This session does not control that wallet.' });
      return;
    }

    next();
  };
}

/** Read the wallet from the query string. */
export const walletFromQuery = (req: Request): unknown => req.query?.wallet;

/** Read the wallet from the request body. */
export const walletFromBody = (req: Request): unknown => req.body?.wallet;

/**
 * The full gate for a user-scoped route: a verified session that controls
 * the wallet the route is about.
 */
export function requireSessionFor(
  verifier: SessionVerifier,
  read: (req: Request) => unknown = walletFromQuery
): RequestHandler[] {
  return [requireSession(verifier), requireOwnedWallet(read)];
}
