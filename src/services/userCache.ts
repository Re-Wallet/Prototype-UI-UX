/**
 * Server-side cache for the wallet → user id resolution.
 *
 * Every wallet-scoped endpoint starts by resolving the caller's wallet to a
 * user row. With the database hosted in another region, that lookup is a full
 * network round-trip — and the Transfer screen paid it on every mount just to
 * reach the cached address book behind it.
 *
 * Only the id is cached, never the profile: the profile carries balances and
 * other fields that move, while the mapping from a registered wallet to its
 * user id is stable for as long as the account exists.
 *
 * A missing wallet is deliberately NOT cached. Negative caching would make a
 * freshly registered wallet look unregistered for the whole TTL.
 *
 * The cache machinery lives in `readCache` — this module only owns the key
 * and the TTL.
 */

import { eq } from 'drizzle-orm';

import { db } from '../db';
import { users as usersTable } from '../db/schema';
import { getCached, invalidate } from './readCache';

/**
 * How long a wallet → user id mapping is trusted. Generous on purpose: the
 * mapping only changes if the account is removed and recreated, and a stale
 * id simply resolves to an empty address book until it expires.
 */
const CACHE_TTL_MS = Number(process.env.USER_CACHE_TTL_MS ?? 300_000);

function key(publicKey: string): string {
  return `user-id:${publicKey.trim()}`;
}

/**
 * The user id behind a wallet address, or null when the wallet is not
 * registered.
 *
 * Reads one narrow column instead of the whole user row: the profile is
 * large and most callers only need the id.
 */
export async function getUserIdByPubkey(publicKey: string): Promise<number | null> {
  const address = publicKey.trim();
  if (!address) return null;

  return getCached(
    key(address),
    async () => {
      const [row] = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(eq(usersTable.publicKey, address))
        .limit(1);
      return row?.id ?? null;
    },
    {
      ttlMs: CACHE_TTL_MS,
      // An unregistered wallet must not be remembered as unregistered.
      shouldCache: (userId) => userId !== null,
    }
  );
}

/**
 * Drop a wallet's cached id (used when the account is removed or recreated).
 */
export function invalidateUserId(publicKey: string): void {
  invalidate(key(publicKey));
}
