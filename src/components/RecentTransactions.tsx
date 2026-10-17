import React from 'react';
import { ArrowDownLeft, ArrowUpRight, Check, Loader2, RefreshCw } from 'lucide-react';
import { CoinIcon } from './CoinIcon';
import { Transaction } from '../types/wallet';
import { Translations } from '../i18n/translations';

interface RecentTransactionsProps {
  transactions: Transaction[];
  onSelectTransaction: (tx: Transaction) => void;
  onSeeAll: () => void;
  onRefresh: () => void;
  t: Translations;
  loading: boolean;
  error: string | null;
}

export const RecentTransactions: React.FC<RecentTransactionsProps> = ({
  transactions,
  onSelectTransaction,
  onSeeAll,
  onRefresh,
  t,
  loading,
  error,
}) => {
  return (
    <div className="px-5 pt-2 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[15px] font-semibold text-white tracking-tight">{t.recents}</h2>
        <div className="flex items-center gap-3">
          <button
            aria-label="Actualizar transacciones"
            disabled={loading}
            onClick={onRefresh}
            className="py-1 text-zinc-400 hover:text-white disabled:opacity-50"
          >
            {loading
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <RefreshCw className="h-4 w-4" />}
          </button>
          <button
            onClick={onSeeAll}
            className="text-[13px] font-semibold text-[#ff5a1f] hover:text-[#ff743d] transition-colors py-1 cursor-pointer"
          >
            {t.seeAll}
          </button>
        </div>
      </div>

      {/* Transaction List */}
      <div className="divide-y divide-white/[0.04]">
        {error ? (
          <p role="alert" className="py-4 text-center text-xs text-red-300">
            No se pudo cargar el historial on-chain: {error}
          </p>
        ) : loading && transactions.length === 0 ? (
          <p aria-live="polite" className="py-8 text-center text-sm text-zinc-500">
            Cargando transacciones de Solana…
          </p>
        ) : transactions.length === 0 ? (
          <div className="py-10 text-center text-zinc-500 text-sm">
            {t.noTransactions}
          </div>
        ) : (
          transactions.map((tx) => {
            const isIncoming = tx.type === 'deposit' || tx.type === 'received';
            const isInProgress = tx.status === 'in_progress';

            // Subtitle state label
            let stateLabel = '';
            if (tx.status === 'in_progress') {
              stateLabel = t.createdInProgress;
            } else if (tx.type === 'sent') {
              stateLabel = t.sentCompleted;
            } else if (tx.type === 'received') {
              stateLabel = t.receivedCompleted;
            } else if (tx.type === 'withdrawal') {
              stateLabel = t.withdrawnCompleted;
            } else {
              stateLabel = t.depositedCompleted;
            }

            const displayTitle =
              tx.type === 'withdrawal' || tx.title.toLowerCase().includes('withdrawal')
                ? t.withdraw
                : tx.title;

            return (
              <button
                key={tx.id}
                onClick={() => onSelectTransaction(tx)}
                className="w-full flex items-center justify-between py-3.5 px-1 hover:bg-white/[0.02] active:bg-white/[0.05] rounded-xl transition-colors text-left group"
              >
                {/* Left: Icon with Status Badge */}
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="relative shrink-0">
                    <div className="w-10 h-10 rounded-full bg-[#222225] flex items-center justify-center text-white/90 group-hover:text-white transition-colors">
                      {isIncoming ? (
                        <ArrowDownLeft className="w-5 h-5 stroke-[2.2]" />
                      ) : (
                        <ArrowUpRight className="w-5 h-5 stroke-[2.2]" />
                      )}
                    </div>

                    {/* Status Badge */}
                    {isInProgress ? (
                      <span
                        className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-black flex items-center justify-center"
                        title="En progreso"
                      >
                        <span className="w-2.5 h-2.5 rounded-full border-[1.5px] border-[#ff9500] animate-pulse" />
                      </span>
                    ) : (
                      <span
                        className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[#10b981] flex items-center justify-center text-black"
                        title="Completado"
                      >
                        <Check className="w-2.5 h-2.5 stroke-[3] text-black" />
                      </span>
                    )}
                  </div>

                  {/* Title & Status */}
                  <div className="min-w-0 pr-2">
                    <p className="text-[14px] font-medium text-white truncate leading-snug">
                      {displayTitle}
                    </p>
                    <p
                      className={`text-[12px] font-normal leading-snug truncate ${
                        isInProgress ? 'text-[#ff9500]' : 'text-[#10b981]'
                      }`}
                    >
                      {stateLabel}
                    </p>
                  </div>
                </div>

                {/* Right: Amount & Timestamp */}
                <div className="text-right shrink-0">
                  <div className="flex items-center justify-end gap-1.5 text-white font-medium text-[15px] tabular-nums leading-snug">
                    {tx.assetSymbol !== 'SOL' && (
                      <CoinIcon className="w-4 h-4 text-zinc-400" />
                    )}
                    <span>
                      {!isIncoming ? '-' : ''}
                      {tx.amount % 1 === 0 ? tx.amount : tx.amount.toFixed(2)}
                    </span>
                    <span className="text-[11px] text-zinc-400">{tx.assetSymbol ?? 'USDC'}</span>
                  </div>
                  <p className="text-[11px] font-normal text-zinc-500 leading-snug">
                    {tx.timestamp}
                  </p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
