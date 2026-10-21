/**
 * Provisioning the ledger row for a signed-in user.
 *
 * Why this module exists
 * ----------------------
 * The ledger is keyed by `users.publicKey`, and **nothing in this repository
 * created that row**. The two rows in the database were seeded by hand. A
 * person who signs in with Dynamic gets a Dynamic wallet, and then:
 *
 * - the wallet resolves to no user, so the profile read answers "no wallet
 *   data is available";
 * - the `wallet.activity` webhook finds no registered wallet, so the
 *   movement is never projected and the payment never appears.
 *
 * The application looks broken for every user who is not one of the seeded
 * two. This module closes that gap: the browser calls the endpoint once the
 * session and the Solana wallet are both available, and the row is created.
 *
 * Two rules make it safe:
 *
 * 1. **The address comes from the session, never from the request.** The
 *    session is a signed Dynamic token; the body is not. A caller can lie
 *    about their name, never about whose wallet they are.
 * 2. **The call is idempotent.** It runs on every sign-in, so it must
 *    refresh the profile without ever creating a second row for the same
 *    wallet.
 */

import { eq } from 'drizzle-orm';

import { db } from '../db';
import { users as usersTable } from '../db/schema';

/** The profile fields a session can carry. Every one of them is optional. */
export interface SessionProfile {
  /** The user's display handle (Dynamic's `username`). */
  handle?: string | null;
  /** Their display name. */
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  language?: string | null;
}

export interface ProvisionedUser {
  id: number;
  publicKey: string;
  handle: string;
  /** True when this call created the row. */
  created: boolean;
}

/** The longest handle the table should carry. */
const MAX_HANDLE_LENGTH = 32;

/**
 * Reduce a free-text profile field to a handle.
 *
 * Handles end up in URLs and in the address book, so they are normalised the
 * same way everywhere: lower case, and only the characters that survive a
 * round trip through a link.
 */
function sanitizeHandle(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_HANDLE_LENGTH);
}

/**
 * The handle this user would like.
 *
 * The Dynamic handle first, then the local part of the e-mail, and finally a
 * name derived from the wallet — which is always available, because the
 * wallet is what the row is keyed by.
 *
 * Exported for the unit test: this is the deterministic half of the
 * provisioning, and the half that decides what the user sees in the app.
 */
export function deriveDesiredHandle(publicKey: string, profile: SessionProfile): string {
  const fromProfile = sanitizeHandle(profile.handle ?? '');
  if (fromProfile) return fromProfile;

  const fromEmail = sanitizeHandle((profile.email ?? '').split('@')[0] ?? '');
  if (fromEmail) return fromEmail;

  return `user-${publicKey.slice(0, 6).toLowerCase()}`;
}

/**
 * A handle nobody else holds.
 *
 * The address is the tie-breaker: two people can pick the same handle, and
 * the suffix makes the second one distinct without either of them having to
 * try again. The row is unique on the address, so the owner of a handle
 * always keeps it.
 */
async function uniqueHandle(desired: string, publicKey: string): Promise<string> {
  const taken = await db
    .select({ publicKey: usersTable.publicKey })
    .from(usersTable)
    .where(eq(usersTable.handle, desired))
    .limit(1);
  if (taken.length === 0 || taken[0].publicKey === publicKey) return desired;

  // Widen the suffix until it is free. Four characters of a base58 address
  // is 36 bits, so a clash here means the same person or a collision.
  for (let width = 4; width <= 12; width += 4) {
    const candidate = `${desired.slice(0, MAX_HANDLE_LENGTH - width - 1)}-${publicKey
      .slice(0, width)
      .toLowerCase()}`;
    const clash = await db
      .select({ publicKey: usersTable.publicKey })
      .from(usersTable)
      .where(eq(usersTable.handle, candidate))
      .limit(1);
    if (clash.length === 0 || clash[0].publicKey === publicKey) return candidate;
  }

  // The address itself is unique, so it is the last resort that always works.
  return `user-${publicKey.toLowerCase()}`;
}

/**
 * Create or refresh the ledger row for a signed-in user.
 *
 * The address is the session's, so this function never trusts the caller
 * about whose wallet it is.
 */
export async function provisionUser(
  publicKey: string,
  profile: SessionProfile
): Promise<ProvisionedUser> {
  const address = publicKey.trim();
  const now = new Date();

  const [existing] = await db
    .select({
      id: usersTable.id,
      publicKey: usersTable.publicKey,
      handle: usersTable.handle,
      name: usersTable.name,
      email: usersTable.email,
      phone: usersTable.phone,
      country: usersTable.country,
      language: usersTable.language,
    })
    .from(usersTable)
    .where(eq(usersTable.publicKey, address))
    .limit(1);

  if (existing) {
    // The row exists: refresh what the user can change about themselves.
    //
    // A field the client did not send keeps the value it had. Wiping it
    // would turn a partial profile into a deletion, and a stale phone
    // number is a smaller problem than a lost one.
    await db
      .update(usersTable)
      .set({
        name: profile.name?.trim() || existing.name || existing.handle,
        email: profile.email ?? existing.email,
        phone: profile.phone ?? existing.phone,
        country: profile.country ?? existing.country,
        ...(profile.language ? { language: profile.language } : {}),
        lastLoginAt: now,
        updatedAt: now,
      })
      .where(eq(usersTable.id, existing.id));
    return { id: existing.id, publicKey: address, handle: existing.handle, created: false };
  }

  const handle = await uniqueHandle(deriveDesiredHandle(address, profile), address);
  const values = {
    publicKey: address,
    handle,
    name: profile.name?.trim() || handle,
    email: profile.email ?? null,
    phone: profile.phone ?? null,
    country: profile.country ?? null,
    language: profile.language ?? 'en',
    lastLoginAt: now,
    createdAt: now,
    updatedAt: now,
  };

  const [row] = await db.insert(usersTable).values(values).onConflictDoNothing().returning({
    id: usersTable.id,
    publicKey: usersTable.publicKey,
    handle: usersTable.handle,
  });

  if (row) {
    return { id: row.id, publicKey: row.publicKey, handle: row.handle, created: true };
  }

  // The insert did not land. Either a concurrent request created the row
  // (then it is ours) or the e-mail collides with another user's — the
  // table is unique on it, and two wallets can share one address.
  const [raced] = await db
    .select({ id: usersTable.id, publicKey: usersTable.publicKey, handle: usersTable.handle })
    .from(usersTable)
    .where(eq(usersTable.publicKey, address))
    .limit(1);
  if (raced) {
    return { id: raced.id, publicKey: raced.publicKey, handle: raced.handle, created: false };
  }

  // The e-mail is the collision. The row is still needed, so the e-mail goes
  // and the handle is disambiguated: an account without an e-mail address is
  // better than an account that does not exist.
  const fallbackHandle = await uniqueHandle(
    `${handle.slice(0, MAX_HANDLE_LENGTH - 5)}-${address.slice(0, 4).toLowerCase()}`,
    address
  );
  const [fallback] = await db
    .insert(usersTable)
    .values({ ...values, handle: fallbackHandle, email: null })
    .onConflictDoNothing()
    .returning({ id: usersTable.id, publicKey: usersTable.publicKey, handle: usersTable.handle });

  if (fallback) {
    return {
      id: fallback.id,
      publicKey: fallback.publicKey,
      handle: fallback.handle,
      created: true,
    };
  }

  throw new Error('the user row could not be created');
}
