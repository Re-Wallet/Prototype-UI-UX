/**
 * CORS policy.
 *
 * The old policy answered `Access-Control-Allow-Origin: *` to everyone.
 * That is not a style choice: a wildcard makes every other defect reachable
 * from any web page the victim visits, so a request forged in the browser
 * costs an attacker nothing.
 *
 * The policy now names the origins it trusts. It is an allowlist, and it
 * understands a single wildcard segment (`*.trycloudflare.com`) because the
 * quick tunnel hands out a new hostname on every restart.
 *
 * CORS is a browser mechanism, not access control. The real gate is the
 * session: a request from a page the browser refuses to expose the answer to
 * is still *processed* by the server, and the server still demands a valid
 * session. That is why the preflight is refused loudly while the actual
 * request is not blocked at the edge — the session is the boundary, and
 * pretending otherwise would only hide a real attack behind a browser rule.
 */

/** One entry of the allowlist: an exact origin, or a wildcard host. */
export type OriginPattern = string;

export interface CorsOptions {
  /** The origins that may talk to this API. */
  allowedOrigins: OriginPattern[];
}

/** Split a comma-separated configuration value into patterns. */
export function parseOriginPatterns(value: string | undefined): OriginPattern[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Does `origin` match `pattern`?
 *
 * A pattern may use a single wildcard inside the host, which matches exactly
 * one host label: `https://*.trycloudflare.com` matches
 * `https://abc.trycloudflare.com` but not `https://a.b.trycloudflare.com` and
 * not `https://trycloudflare.com`.
 *
 * The scheme and the port have to match exactly — a wildcard host on a
 * different scheme is a different origin.
 */
export function originMatches(origin: string, pattern: string): boolean {
  if (pattern === '*') return true;

  const target = splitOrigin(origin);
  const allowed = splitOrigin(pattern);
  if (!target || !allowed) return false;

  if (target.scheme !== allowed.scheme) return false;
  if (target.port !== allowed.port) return false;

  return hostMatches(target.host, allowed.host);
}

/** The scheme, host and port of an origin. */
function splitOrigin(value: string): { scheme: string; host: string; port: string } | null {
  const match = /^([a-z][a-z0-9+.-]*):\/\/([^/:]+)(?::(\d+))?$/i.exec(value.trim());
  if (!match) return null;
  return {
    scheme: match[1].toLowerCase(),
    host: match[2].toLowerCase(),
    port: match[3] ?? '',
  };
}

/** Match a host against a host pattern that may carry one wildcard. */
function hostMatches(host: string, pattern: string): boolean {
  if (!pattern.includes('*')) return host === pattern;

  const [prefix, suffix] = pattern.split('*');
  if (suffix === undefined) return false;
  if (!host.startsWith(prefix)) return false;
  if (!host.endsWith(suffix)) return false;

  const middle = host.slice(prefix.length, host.length - suffix.length);
  // Exactly one label between the fixed parts.
  return middle.length > 0 && !middle.includes('.');
}

/** The origins this deployment answers to, including the local dev servers. */
export function defaultAllowedOrigins(): OriginPattern[] {
  return [
    'http://127.0.0.1:3000',
    'http://localhost:3000',
    'http://127.0.0.1:3001',
    'http://localhost:3001',
    'https://*.trycloudflare.com',
  ];
}

/** Is `origin` allowed by `patterns`? */
export function isOriginAllowed(origin: string, patterns: OriginPattern[]): boolean {
  return patterns.some((pattern) => originMatches(origin, pattern));
}

/**
 * The CORS middleware.
 *
 * A request with no `Origin` header is not a browser cross-origin request;
 * it is a server-to-server call or a same-origin navigation. It gets no CORS
 * headers and it is not blocked.
 */
export function createCorsMiddleware(options: CorsOptions) {
  const { allowedOrigins } = options;

  return (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction): void => {
    const origin = req.headers.origin;
    const allowed = typeof origin === 'string' && isOriginAllowed(origin, allowedOrigins);

    if (allowed) {
      // The exact origin, never the wildcard: the credentialed cookie path
      // and the session header both need a specific origin.
      res.header('Access-Control-Allow-Origin', origin as string);
      res.header('Access-Control-Allow-Credentials', 'true');
      // The response body differs per origin, so caches must not share it.
      res.header('Vary', 'Origin');
    }

    res.header(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, x-dynamic-signature-256'
    );
    res.header('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');

    if (req.method === 'OPTIONS') {
      // A preflight from an origin we do not trust is refused outright.
      res.status(allowed ? 204 : 403).end();
      return;
    }

    next();
  };
}
