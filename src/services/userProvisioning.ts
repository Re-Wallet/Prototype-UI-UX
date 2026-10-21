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
 * How many times the insert is retried when a unique constraint collides.
 *
 * Each attempt removes exactly one conflict, so the bound is generous
 * enough for the e-mail and the handle to collide in the same call.
 */
const MAX_INSERT_ATTEMPTS = 4;

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
 *
 * `skip` carries the widths already used, so a retry after a lost race does
 * not hand back the same handle that just lost.
 */
interface HandleResolution {
  handle: string;
  /** The suffix width that was used: 0 none, 4/8/12, or -1 for the address. */
  width: number;
}

async function resolveHandle(
  desired: string,
  publicKey: string,
  skip: number[] = []
): Promise<HandleResolution> {
  const taken = await db
    .select({ publicKey: usersTable.publicKey })
    .from(usersTable)
    .where(eq(usersTable.handle, desired))
    .limit(1);
  if (taken.length === 0 || taken[0].publicKey === publicKey) {
    return { handle: desired, width: 0 };
  }

  // Widen the suffix until it is free. Four characters of a base58 address
  // is about 23 bits, so a clash here means the same person or a collision.
  for (let width = 4; width <= 12; width += 4) {
    if (skip.includes(width)) continue;
    const candidate = `${desired.slice(0, MAX_HANDLE_LENGTH - width - 1)}-${publicKey
      .slice(0, width)
      .toLowerCase()}`;
    const clash = await db
      .select({ publicKey: usersTable.publicKey })
      .from(usersTable)
      .where(eq(usersTable.handle, candidate))
      .limit(1);
    if (clash.length === 0 || clash[0].publicKey === publicKey) {
      return { handle: candidate, width };
    }
  }

  // The address itself is unique, so it is the last resort that always works.
  return { handle: `user-${publicKey.toLowerCase()}`, width: -1 };
}

/** The row could not be created and no adjustment could fix it. */
export class ProvisioningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProvisioningError';
  }
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

  const baseHandle = deriveDesiredHandle(address, profile);
  const wantedName = profile.name?.trim() || null;
  let handle = baseHandle;
  let email = profile.email ?? null;
  let usedWidths: number[] = [];

  // The insert can lose a race with another wallet that wants the same
  // handle or the same e-mail. Each attempt adjusts exactly the field that
  // collided, so a lost race never costs the user data it did not have to.
  for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt += 1) {
    const [row] = await db
      .insert(usersTable)
      .values({
        publicKey: address,
        handle,
        name: wantedName || handle,
        email,
        phone: profile.phone ?? null,
        country: profile.country ?? null,
        language: profile.language ?? 'en',
        lastLoginAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({
        id: usersTable.id,
        publicKey: usersTable.publicKey,
        handle: usersTable.handle,
      });

    if (row) {
      return { id: row.id, publicKey: row.publicKey, handle: row.handle, created: true };
    }

    // The insert did not land. Which constraint refused it?
    const [byWallet] = await db
      .select({ id: usersTable.id, publicKey: usersTable.publicKey, handle: usersTable.handle })
      .from(usersTable)
      .where(eq(usersTable.publicKey, address))
      .limit(1);
    if (byWallet) {
      // A concurrent request created OUR row: it is ours, and the call is
      // idempotent, so it is the same answer.
      return {
        id: byWallet.id,
        publicKey: byWallet.publicKey,
        handle: byWallet.handle,
        created: false,
      };
    }

    if (email !== null) {
      const [emailOwner] = await db
        .select({ publicKey: usersTable.publicKey })
        .from(usersTable)
        .where(eq(usersTable.email, email))
        .limit(1);
      if (emailOwner && emailOwner.publicKey !== address) {
        // The e-mail belongs to another wallet. The row is still needed, so
        // the e-mail goes and the handle — which nobody else wanted — stays.
        // The address in Dynamic still has it, so nothing is truly lost.
        email = null;
        continue;
      }
    }

    const [handleOwner] = await db
      .select({ publicKey: usersTable.publicKey })
      .from(usersTable)
      .where(eq(usersTable.handle, handle))
      .limit(1);
    if (handleOwner && handleOwner.publicKey !== address) {
      // Two wallets want the same handle. The address disambiguates it,
      // always with the same widening rule.
      const resolution = await resolveHandle(baseHandle, address, usedWidths);
      usedWidths = [...usedWidths, resolution.width];
      handle = resolution.handle;
      continue;
    }

    // Nothing explains the refusal: the row was turned down for a reason
    // this code cannot see. Retrying would only repeat it.
    break;
  }

  throw new ProvisioningError('the user row could not be created');
}
