import React, { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Loader2 } from 'lucide-react';
import { Translations } from '../i18n/translations';
import { chain, type TokenAsset } from '../adapters';

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

  // Chain balances
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [loadingBalances, setLoadingBalances] = useState<boolean>(true);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  // USDC devnet asset
  const usdcDevnet: TokenAsset = {
    symbol: 'USDC',
    mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU' as any,
    program: 'spl-token',
    decimals: 6,
  };

  // SOL asset (native)
  const solAsset: TokenAsset = {
    symbol: 'SOL',
    mint: 'So11111111111111111111111111111111111111112' as any,
    program: 'spl-token',
    decimals: 9,
  };

  // Fetch balances from chain
  useEffect(() => {
    const fetchBalances = async () => {
      if (!chain.isLive()) {
        setLoadingBalances(false);
        return;
      }
      try {
        const merchantWallet = (import.meta.env.VITE_MERCHANT_WALLET as string) ||
          '7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU';
        const balances = await chain.getBalances(merchantWallet as any, [usdcDevnet, solAsset]);
        const usdc = balances.find(b => b.asset.symbol === 'USDC');
        const sol = balances.find(b => b.asset.symbol === 'SOL');
        if (usdc) setUsdcBalance(Number(usdc.ui.toFixed(2)));
        if (sol) setSolBalance(Number(sol.ui.toFixed(4)));
      } catch (error) {
        setBalanceError((error as Error).message);
        console.error('Failed to fetch chain balances:', error);
      } finally {
        setLoadingBalances(false);
      }
    };

    fetchBalances();
  }, []);

  return (
    <div className="px-5 pt-3 pb-3">
      {/* Label */}
      <span className="text-[13px] font-medium text-zinc-400 block tracking-tight mb-2">
        {t.yourBalance}
      </span>

      {/* Main Balance Display - USD instead of coin icon */}
      <div className="flex items-baseline gap-2.5 mb-4">
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

      {/* Chain Balances (devnet) */}
      {(chain.isLive() && (solBalance !== null || usdcBalance !== null)) && (
        <div className="flex items-center gap-4 mb-4 p-3 rounded-xl bg-[#151517] border border-white/5 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-400">SOL</span>
            {loadingBalances ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#ff5a1f]" />
            ) : (
              <span className="text-white font-mono tabular-nums">{solBalance?.toFixed(4) || '0.0000'}</span>
            )}
          </div>
          <div className="w-px h-4 bg-white/10" />
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-400">USDC</span>
            {loadingBalances ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#ff5a1f]" />
            ) : (
              <span className="text-white font-mono tabular-nums">{usdcBalance?.toFixed(2) || '0.00'}</span>
            )}
          </div>
          {balanceError && (
            <span className="text-red-500 ml-2">{balanceError}</span>
          )}
        </div>
      )}

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