/**
 * Security headers.
 *
 * Express sets none of these. That matters more here than in a typical app:
 * this UI asks the user to **sign transactions**, so a page that can be
 * framed can put invisible buttons over the confirmation sheet, and a page
 * that can sniff a content type can turn a JSON response into an executable
 * one.
 *
 * The Content-Security-Policy is the load-bearing header, and `frame-ancestors
 * 'none'` inside it is the part that stops the clickjacking. The rest of the
 * policy names the origins this app actually talks to:
 *
 * - `script-src 'self'` — the bundle is a module script from our own origin.
 *   The Dynamic WaaS wallet runs inside a cross-origin *iframe*, so the SDK
 *   hosts are allowed to provide scripts, and `frame-src` allows the frame.
 * - `connect-src` — the Solana RPC endpoint and the Neon Realtime socket.
 * - `img-src data:` — the QR codes are generated as data URLs.
 * - `style-src 'unsafe-inline'` — React writes inline styles for the phone
 *   frame and the charts.
 *
 * Every entry can be widened through the constructor, but the defaults are
 * the ones the app is known to work with.
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';

export interface SecurityHeaderOptions {
  /** Extra origins for `connect-src` (RPC providers, sockets). */
  extraConnectSources?: string[];
  /** Extra origins for `script-src`. */
  extraScriptSources?: string[];
  /** Extra origins for `frame-src` (wallet providers). */
  extraFrameSources?: string[];
  /** Send HSTS. Defaults to true; a plain-HTTP dev server should turn it off. */
  hsts?: boolean;
}

/** The origins the application talks to out of the box. */
const DEFAULT_CONNECT_SOURCES = [
  'https://api.devnet.solana.com',
  'https://api.mainnet-beta.solana.com',
  'wss://*.aws.neon.tech',
  'https://*.neon.tech',
];

const DEFAULT_SCRIPT_SOURCES = ['https://app.dynamic.xyz', 'https://cdn.dynamic.xyz'];

const DEFAULT_FRAME_SOURCES = ['https://*.dynamic.xyz', 'https://dynamic.xyz'];

/** Build the Content-Security-Policy value. */
export function buildContentSecurityPolicy(options: SecurityHeaderOptions = {}): string {
  const connect = [...DEFAULT_CONNECT_SOURCES, ...(options.extraConnectSources ?? [])];
  const script = [...DEFAULT_SCRIPT_SOURCES, ...(options.extraScriptSources ?? [])];
  const frame = [...DEFAULT_FRAME_SOURCES, ...(options.extraFrameSources ?? [])];

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    // Clickjacking: nobody may frame this UI.
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    `script-src 'self' ${script.join(' ')}`,
    `connect-src 'self' ${connect.join(' ')}`,
    `frame-src ${frame.join(' ')}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ].join('; ');
}

/**
 * The middleware that sets the headers.
 *
 * HSTS is only sent over HTTPS in practice — a browser ignores it on
 * `http://127.0.0.1` — but the local dev server should not claim to be
 * HTTPS-only, so it can be turned off.
 */
export function securityHeaders(options: SecurityHeaderOptions = {}): RequestHandler {
  const csp = buildContentSecurityPolicy(options);
  const hsts = options.hsts !== false;

  return (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // The QR scanner needs the camera; nothing else needs a device.
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    if (hsts) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };
}
