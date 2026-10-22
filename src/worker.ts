/**
 * The Cloudflare Worker entry point.
 *
 * One Worker serves the landing and the API, so there is one origin, one
 * certificate, and a URL that never changes — which is what the Dynamic
 * webhook and the payment links depend on.
 *
 * **How the API runs inside a Worker.** A Worker has no sockets, but it
 * does have `node:http` (natively supported), and Cloudflare ships
 * `handleAsNodeRequest` to hand a Worker request to a Node HTTP server
 * running in the same isolate. So the Express app runs unchanged, on a real
 * `http.Server`, and the Worker bridges the request to it. No route, no
 * middleware, and no handler changed.
 *
 * **What is NOT here.** The static assets are served by the assets binding
 * (the SPA with its history fallback), the database is reached over HTTP
 * (a Worker cannot open a socket to Neon), and the sweeper runs from the
 * Cron Trigger (a Worker has no long-lived process to hold a timer).
 */

import { createServer } from 'node:http';
import { handleAsNodeRequest } from 'cloudflare:node';

import { app, runHistorySweep } from '../server';

/** The bindings the Worker needs. Secrets arrive through the environment. */
export interface WorkerEnv {
  /** The built SPA, served by the platform. */
  ASSETS: { fetch(request: Request): Promise<Response> };
}

/**
 * The port the Node server listens on INSIDE the isolate.
 *
 * It is not a network port — it is a routing key that tells the platform
 * which server takes the request.
 */
const NODE_PORT = 8080;

const nodeServer = createServer(app as never);
nodeServer.listen(NODE_PORT);

export default {
  /**
   * The API, the app or the landing.
   *
   * The API answers under `/api/` on every host. The rest depends on
   * **which host** asked:
   *
   *   - `app.rewallet.win` → the wallet app, at the root of its host.
   *   - `rewallet.win`     → the public landing at the root; anything else
   *                          is still the app, so a deep link keeps working.
   *
   * The hosts that serve the app are configuration, not code: `APP_HOSTNAMES`
   * in the environment. The workers.dev URL is the app too — it is the
   * fallback while the custom domain is being set up.
   */
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const { hostname, pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) {
      return handleAsNodeRequest(NODE_PORT, request);
    }

    const appHosts = (process.env.APP_HOSTNAMES ?? '')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean);
    const servesApp =
      appHosts.includes(hostname) || hostname.endsWith('.workers.dev');

    // The root of a landing host is the landing: the public page, not the
    // login.
    //
    // The assets binding redirects `/x/index.html` to `/x/`, so the
    // directory path is fetched directly: the browser stays at `/` instead
    // of ending up at `/landing/`.
    if (!servesApp && pathname === '/') {
      return env.ASSETS.fetch(new Request(new URL('/landing/', request.url), request));
    }
    return env.ASSETS.fetch(request);
  },

  /**
   * The Cron Trigger: the reconciliation sweep.
   *
   * The Node runtime runs the same sweep from a timer. Here the platform
   * owns the cadence, which is the one thing a Worker is better at: a
   * schedule that survives a deploy, a cold start and a traffic spike.
   */
  async scheduled(
    _event: unknown,
    _env: WorkerEnv,
    ctx: { waitUntil(promise: Promise<unknown>): void }
  ): Promise<void> {
    ctx.waitUntil(runHistorySweep());
  },
};
