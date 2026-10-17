import React from 'react';
import { ArrowDown, ArrowUp, Loader2 } from 'lucide-react';
import { Translations } from '../i18n/translations';

interface BalanceCardProps {
  balance: number;
  solBalance: number;
  balanceLoading: boolean;
  isBalanceHidden: boolean;
  onDeposit: () => void;
  onWithdraw: () => void;
  t: Translations;
}

export const BalanceCard: React.FC<BalanceCardProps> = ({
  balance,
  solBalance,
  balanceLoading,
  isBalanceHidden,
  onDeposit,
  onWithdraw,
  t,
}) => {
  const [integerPart, decimalPart] = balance.toFixed(2).split('.');

  return (
    <div className="px-5 pt-3 pb-3">
      {/* Label */}
      <span className="text-[13px] font-medium text-zinc-400 block tracking-tight mb-2">
        {t.yourBalance}
      </span>

      {/* Main Balance Display - USD instead of coin icon */}
      <div className="flex items-baseline gap-2.5 mb-4">
        <span className="text-[13px] font-semibold text-zinc-500 uppercase tracking-wider self-center">
          USDC
        </span>
        {isBalanceHidden ? (
          <span className="text-4xl font-bold tracking-widest text-zinc-300 select-none">
            ••••••
          </span>
        ) : balanceLoading ? (
          <Loader2 className="w-8 h-8 animate-spin text-[#ff5a1f]" aria-label="Consultando saldo real" />
        ) : (
          <div className="flex items-baseline tracking-tight font-sans">
            <span className="text-[44px] leading-none font-bold text-white tabular-nums">
              {integerPart}
            </span>
            <span className="text-[26px] leading-none font-medium text-zinc-500 tabular-nums">
              .{decimalPart}
            </span>
          </div>
        )}
      </div>

      <div className="mb-4 rounded-2xl border border-white/[0.06] bg-white/[0.025] px-3.5 py-3">
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          {t.solanaAssets}
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] text-zinc-500">{t.solBalance}</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-white">
              {isBalanceHidden ? '••••' : balanceLoading ? '…' : `${solBalance.toFixed(4)} SOL`}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-zinc-500">{t.usdcBalance}</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-white">
              {isBalanceHidden ? '••••' : balanceLoading ? '…' : `${balance.toFixed(2)} USDC`}
            </p>
          </div>
        </div>
      </div>

      {/* Action Row: Deposit (Orange) + Withdraw */}
      <div className="flex items-center gap-2.5">
        {/* Deposit Button - ORANGE with ArrowDown */}
        <button
          onClick={onDeposit}
          className="flex-1 h-[52px] rounded-2xl bg-[#ff5a1f] hover:bg-[#ff6c35] active:scale-[0.98] text-white border border-[#ff5a1f]/30 font-semibold text-[15px] flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg shadow-[#ff5a1f]/20"
        >
          <ArrowDown className="w-4 h-4 stroke-[2.5]" />
          <span>{t.deposit}</span>
        </button>

        {/* Withdraw / Retiro Button - with ArrowUp */}
        <button
          onClick={onWithdraw}
          className="flex-1 h-[52px] rounded-2xl bg-[#201a16] hover:bg-[#2a221d] active:scale-[0.98] text-[#f5eee9] border border-[#3b2b22] font-semibold text-[15px] flex items-center justify-center gap-2 transition-all cursor-pointer"
        >
          <ArrowUp className="w-4 h-4 stroke-[2.5]" />
          <span>{t.withdraw}</span>
        </button>
      </div>
    </div>
  );
};