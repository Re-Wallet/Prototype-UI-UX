/**
 * Identity contracts — users, onboarding, and email OTP.
 *
 * ReWallet signs users in with an email one-time code and provisions a
 * self-custodial Solana wallet through Privy. This module describes that flow
 * without importing Privy, so the UI can be built and tested before the Privy
 * App ID exists, and so the provider can be swapped later.
 *
 * Key separation:
 * - `AuthState` is what the UI renders.
 * - `WalletRef` describes the signing wallet without exposing key material.
 *   The private key never enters our code, database, or network layer.
 */

import type { Address } from './payments';

// ============================================================================
// USER
// ============================================================================

/**
 * The wallet provisioned for a user, described by the provider that holds it.
 *
 * `custody` is explicit so we never accidentally treat a provider-managed
 * wallet as something the user can export, or vice versa. Privy embedded
 * wallets are self-custodial and exportable; the user always keeps an exit.
 */
export interface WalletRef {
  /** Wallet address. This is the public key we store and show. */
  address: Address;
  /** Which provider controls signing. */
  provider: 'privy';
  /** Chain this wallet signs for. */
  chain: 'solana';
  /**
   * Self-custodial means the user can export the private key and leave.
   * Provider-custodial would mean only we can move funds — not our model.
   */
  custody: 'self-custodial';
}

/** A ReWallet user as the rest of the app sees them. */
export interface IdentityUser {
  /** Stable internal id (our database). */
  id: string;
  /** Primary login identifier. */
  email: string;
  /** Display name, when the provider gives us one. */
  name: string | null;
  /** Public handle, e.g. @cata_soto. */
  handle: string;
  /** Solana wallet used for signing and receiving. */
  wallet: WalletRef | null;
  /** Whether the email has been verified through the OTP step. */
  emailVerified: boolean;
  /** ISO 8601 creation time. */
  createdAt: string;
}

// ============================================================================
// ONBOARDING FLOW
// ============================================================================

/**
 * The two entry points on the first onboarding screen.
 * Both send an email OTP; only the intent differs.
 */
export type OnboardingIntent = 'create-account' | 'existing-account';

/**
 * Where the user is in the onboarding flow.
 *
 * `provisioning-wallet` is a distinct state because wallet creation happens
 * after OTP verification and is not instant — the UI needs something to show.
 */
export type OnboardingStep =
  | 'choose-intent'          // screen 1: Crear cuenta / Ya tengo cuenta
  | 'enter-email'            // screen 2: email capture
  | 'verify-otp'             // screen 2: code entry
  | 'provisioning-wallet'    // creating the Solana wallet (create flow only)
  | 'complete'               // signed in, wallet available
  | 'error';

export interface OnboardingState {
  intent: OnboardingIntent | null;
  step: OnboardingStep;
  email: string;
  /** Set while an async provider call is in flight. */
  isBusy: boolean;
  /** User-facing failure message, or null. */
  error: string | null;
}

export const INITIAL_ONBOARDING_STATE: OnboardingState = {
  intent: null,
  step: 'choose-intent',
  email: '',
  isBusy: false,
  error: null,
};

// ============================================================================
// OTP
// ============================================================================

/**
 * An email one-time-password challenge.
 *
 * The code itself is never part of this contract: it travels by email and is
 * verified by the provider. We only track that a challenge exists and how long
 * it stays valid, so the UI can show a countdown and a resend affordance.
 */
export interface OtpChallenge {
  /** Email the code was sent to. */
  email: string;
  /** ISO 8601 time the code stops being valid. */
  expiresAt: string;
  /** Seconds the user must wait before requesting another code. */
  resendAfterSeconds: number;
  /** How many times a new code was requested for this session. */
  attempts: number;
}

export type RequestOtpResult =
  | { ok: true; challenge: OtpChallenge }
  | { ok: false; code: 'invalid-email' | 'rate-limited' | 'provider-error'; message: string };

export type VerifyOtpResult =
  | { ok: true; user: IdentityUser; isNewUser: boolean }
  | { ok: false; code: 'invalid-code' | 'expired' | 'provider-error'; message: string };

// ============================================================================
// SESSION
// ============================================================================

/**
 * Auth state the app renders from. `unknown` is the initial state while the
 * provider restores any existing session — the UI must not flash the
 * onboarding screen before we know.
 */
export type AuthState =
  | { status: 'unknown' }
  | { status: 'signed-out' }
  | { status: 'onboarding'; onboarding: OnboardingState }
  | { status: 'signed-in'; user: IdentityUser };

export type AuthStatus = AuthState['status'];

// ============================================================================
// VALIDATION (pure, no SDK)
// ============================================================================

/**
 * Minimal email sanity check. Deliberately permissive: strict regexes reject
 * valid addresses, and the OTP is the real proof of ownership.
 */
export function isPlausibleEmail(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 5 || trimmed.length > 254) return false;
  if (trimmed.includes(' ')) return false;
  const at = trimmed.indexOf('@');
  if (at < 1) return false;
  const domain = trimmed.slice(at + 1);
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.');
}

/** Normalise an email for storage and comparison. */
export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Derive a handle from an email local part.
 * `cata.soto@example.com` becomes `@cata_soto`.
 */
export function handleFromEmail(email: string): string {
  const local = normaliseEmail(email).split('@')[0] ?? '';
  const cleaned = local
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
  return `@${cleaned || 'user'}`;
}

/** Seconds remaining on an OTP challenge, clamped at zero. */
export function secondsUntil(iso: string, now: number = Date.now()): number {
  const target = Date.parse(iso);
  if (Number.isNaN(target)) return 0;
  return Math.max(0, Math.ceil((target - now) / 1000));
}

/** Create an OTP challenge window. */
export function createOtpChallenge(
  email: string,
  ttlSeconds = 600,
  resendAfterSeconds = 60,
  attempts = 1
): OtpChallenge {
  return {
    email: normaliseEmail(email),
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    resendAfterSeconds,
    attempts,
  };
}
