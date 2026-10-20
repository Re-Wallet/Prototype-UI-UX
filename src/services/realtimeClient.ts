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

export const realtimeClient = url.length > 0 ? createRealtimeClient({ url }) : null;
