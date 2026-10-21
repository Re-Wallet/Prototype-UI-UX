/**
 * One visual language for money movements.
 *
 * The notification feed, the "Recientes" list, the full history modal and the
 * receipt each used to draw the same event their own way: green arrows in
 * one place, neutral grey circles in another, teal in a third. Reading the
 * same transaction in two screens gave two different impressions of it.
 *
 * This module is the single source of truth, so a movement looks the same
 * everywhere it appears.
 *
 * Two things are distinguished, because they mean different things:
 *   - DIRECTION — incoming (green) / outgoing (orange) / failed (red).
 *   - ORIGIN    — money moving between ReWallet users (arrows) or entering
 *                 and leaving the app (bank arrows). A deposit is not the
 *                 same event as a contact sending you money, and the
 *                 notification text already says which one it is.
 */

import React from 'react';
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, Download, Upload } from 'lucide-react';

export type MovementKind = 'incoming' | 'outgoing' | 'failed';

/** Notification types the webhook writes. */
const NOTIFICATION_KINDS: Record<string, MovementKind> = {
  deposit_received: 'incoming',
  transfer_received: 'incoming',
  payment_received: 'incoming',
  transfer_sent: 'outgoing',
  withdrawal_sent: 'outgoing',
  transfer_failed: 'failed',
};

/** Transaction types the UI stores. */
const TRANSACTION_KINDS: Record<string, MovementKind> = {
  deposit: 'incoming',
  received: 'incoming',
  sent: 'outgoing',
  withdrawal: 'outgoing',
};

/**
 * Whether the movement came from outside ReWallet or from one of its users.
 *
 * Only the external kinds get the bank arrows; peer-to-peer movements keep
 * the diagonal arrows, so "someone sent me money" and "a deposit arrived"
 * do not look like the same event.
 */
function isExternal(type: string): boolean {
  return type === 'deposit_received' || type === 'deposit' || type === 'withdrawal_sent' || type === 'withdrawal';
}

/**
 * The direction of a movement, from either vocabulary.
 */
export function movementKind(type: string): MovementKind {
  return NOTIFICATION_KINDS[type] ?? TRANSACTION_KINDS[type] ?? 'incoming';
}

/**
 * The icon component for a movement.
 */
export function movementIconFor(
  type: string
): React.ComponentType<{ className?: string }> {
  switch (movementKind(type)) {
    case 'failed':
      return AlertTriangle;
    case 'outgoing':
      return isExternal(type) ? Upload : ArrowUpRight;
    default:
      return isExternal(type) ? Download : ArrowDownLeft;
  }
}

/**
 * The colours of the icon's container and the glyph inside it.
 */
export function movementIconClasses(type: string): string {
  switch (movementKind(type)) {
    case 'failed':
      return 'bg-[#ef4444]/15 border border-[#ef4444]/25 text-[#ef4444]';
    case 'outgoing':
      return 'bg-[#ff5a1f]/12 border border-[#ff5a1f]/25 text-[#ff5a1f]';
    default:
      return 'bg-[#10b981]/12 border border-[#10b981]/25 text-[#10b981]';
  }
}

interface MovementIconProps {
  type: string;
  /** Extra classes for the glyph, for the places that size it differently. */
  iconClassName?: string;
  className?: string;
}

/**
 * The icon inside its coloured container — the exact shape every screen uses.
 */
export const MovementIcon: React.FC<MovementIconProps> = ({
  type,
  iconClassName,
  className = '',
}) => (
  <div
    className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${movementIconClasses(type)} ${className}`}
  >
    <MovementGlyph type={type} iconClassName={iconClassName} />
  </div>
);

/**
 * The glyph alone, for places that draw their own container.
 */
export const MovementGlyph: React.FC<{ type: string; iconClassName?: string }> = ({
  type,
  iconClassName,
}) => {
  const Icon = movementIconFor(type);
  return <Icon className={iconClassName ?? 'w-5 h-5 stroke-[2.2]'} />;
};
