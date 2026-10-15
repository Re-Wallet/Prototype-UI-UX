import React from 'react';
import { ArrowDown, ArrowUp, QrCode } from 'lucide-react';
import { CoinIcon } from './CoinIcon';
import { Translations } from '../i18n/translations';

interface BalanceCardProps {
  balance: number;
  isBalanceHidden: boolean;
  onDeposit: () => void;
  onWithdraw: () => void;
  onQrCharge: () => void;
  t: Translations;
}

export const BalanceCard: React.FC<BalanceCardProps> = ({
  balance,
  isBalanceHidden,
  onDeposit,
  onWithdraw,
  onQrCharge,
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

      {/* Main Balance Display */}
      <div className="flex items-baseline gap-2.5 mb-6">
        <CoinIcon className="w-8 h-8 text-zinc-300 self-center" />
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

      {/* Action Row: Deposit + Circular Orange QR Button + Withdraw */}
      <div className="flex items-center gap-2.5">
        {/* Deposit Button */}
        <button
          onClick={onDeposit}
          className="flex-1 h-[52px] rounded-2xl bg-[#201a16] hover:bg-[#2a221d] active:scale-[0.98] text-[#f5eee9] border border-[#3b2b22] font-semibold text-[15px] flex items-center justify-center gap-2 transition-all cursor-pointer"
        >
          <ArrowDown className="w-4 h-4 stroke-[2.5]" />
          <span>{t.deposit}</span>
        </button>

        {/* Circular Orange Button for QR Cobro */}
        <button
          onClick={onQrCharge}
          className="w-[52px] h-[52px] rounded-full bg-[#ff5a1f] hover:bg-[#ff6c35] active:scale-[0.95] text-white flex items-center justify-center shadow-lg shadow-[#ff5a1f]/30 transition-all shrink-0 cursor-pointer"
          title={t.qrChargeTooltip}
          aria-label={t.qrChargeTooltip}
        >
          <QrCode className="w-5 h-5 stroke-[2.2]" />
        </button>

        {/* Withdraw / Retiro Button */}
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
