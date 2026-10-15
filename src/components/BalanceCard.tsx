import React from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Translations } from '../i18n/translations';

interface BalanceCardProps {
  balance: number;
  isBalanceHidden: boolean;
  onDeposit: () => void;
  onWithdraw: () => void;
  t: Translations;
}

export const BalanceCard: React.FC<BalanceCardProps> = ({
  balance,
  isBalanceHidden,
  onDeposit,
  onWithdraw,
  t,
}) => {
  // Format split into integer and decimal parts
  const formattedBalance = balance.toFixed(2);
  const [integerPart, decimalPart] = formattedBalance.split('.');

  return (
    <div className="px-5 pt-3 pb-3">
      {/* Label */}
      <span className="text-[13px] font-medium text-zinc-400 block tracking-tight mb-2">
        {t.yourBalance}
      </span>

      {/* Main Balance Display - USD instead of coin icon */}
      <div className="flex items-baseline gap-2.5 mb-6">
        <span className="text-[13px] font-semibold text-zinc-500 uppercase tracking-wider self-center">
          USD
        </span>
        {isBalanceHidden ? (
          <span className="text-4xl font-bold tracking-widest text-zinc-300 select-none">
            ••••••
          </span>
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