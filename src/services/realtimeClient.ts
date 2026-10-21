/**
 * Shared browser Neon Realtime client (module singleton).
 *
 * Null when `VITE_NEON_REALTIME_URL` is absent: callers must degrade to the
 * REST + RPC transaction paths instead of mounting a provider. The URL is
 * public (the WebSocket authenticates each subscription with its sealed
 * capability, not with the endpoint itself); the sealing *secret* stays
 * server-only in `realtimeServer.ts`.
 */

import { createRealtimeClient } from '@neon/realtime/client';

const rawUrl: unknown = import.meta.env.VITE_NEON_REALTIME_URL;
const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';

/**
 * The client logs its lifecycle at `info`.
 *
 * A subscription that dies is invisible from the outside: the app keeps
 * working on the poll and nobody can tell the difference between "nothing
 * happened" and "we stopped listening". The lifecycle log is what makes that
 * difference visible — in the browser console, and in a demo, where it is
 * also proof that the ledger is live.
 */
export const realtimeClient =
  url.length > 0 ? createRealtimeClient({ url, logLevel: 'info' }) : null;
