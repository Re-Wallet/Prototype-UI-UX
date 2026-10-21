import React from 'react';
import { Translations } from '../i18n/translations';

/**
 * Display balances by TRUNCATING, never by rounding up.
 *
 * The network fee on Solana is 0.000005 SOL. A `toFixed(4)` that rounds up
 * hides it and shows the user more than they own (9.999985 rendered as
 * "10.0000" — a full SOL of phantom money). Truncation can only ever display
 * less than the true balance, which is the safe direction for money.
 */
function truncate(value: number, decimals: number): string {
  const factor = 10 ** decimals;
  const [int, dec = ''] = (Math.floor(value * factor) / factor).toFixed(decimals).split('.');
  const trimmed = dec.replace(/0+$/, '');
  return trimmed ? `${int}.${trimmed}` : int;
}

interface SolanaAssetsCardProps {
  balance: number;
  solBalance: number;
  balanceLoading: boolean;
  isBalanceHidden: boolean;
  t: Translations;
}

/**
 * The Solana/USDC breakdown of the balance.
 *
 * It is its own component because it is not part of the balance headline:
 * the home screen can move it below other blocks without dragging the
 * balance and the action buttons along with it.
 */
export const SolanaAssetsCard: React.FC<SolanaAssetsCardProps> = ({
  balance,
  solBalance,
  balanceLoading,
  isBalanceHidden,
  t,
}) => (
  <div className="px-5 pb-1">
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] px-3.5 py-3">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
        {t.solanaAssets}
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-xs text-zinc-400">{t.solBalance}</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-white">
            {isBalanceHidden ? '••••' : balanceLoading ? '…' : `${truncate(solBalance, 6)} SOL`}
          </p>
        </div>
        <div>
          <p className="text-xs text-zinc-400">{t.usdcBalance}</p>
          <p className="mt-0.5 text-sm font-semibold tabular-nums text-white">
            {isBalanceHidden ? '••••' : balanceLoading ? '…' : `${truncate(balance, 2)} USDC`}
          </p>
        </div>
      </div>
    </div>
  </div>
);
