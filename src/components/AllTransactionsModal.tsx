import React, { useState } from 'react';
import { ArrowLeft, Search, ArrowDownLeft, ArrowUpRight, Check } from 'lucide-react';
import { Transaction } from '../types/wallet';
import { CoinIcon } from './CoinIcon';

interface AllTransactionsModalProps {
  transactions: Transaction[];
  onSelectTransaction: (tx: Transaction) => void;
  onClose: () => void;
}

export const AllTransactionsModal: React.FC<AllTransactionsModalProps> = ({
  transactions,
  onSelectTransaction,
  onClose,
}) => {
  const [filterType, setFilterType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const filtered = transactions.filter((tx) => {
    const matchesSearch =
      tx.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (tx.counterparty && tx.counterparty.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (tx.note && tx.note.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;

    if (filterType === 'all') return true;
    if (filterType === 'deposits') return tx.type === 'deposit';
    if (filterType === 'withdrawals') return tx.type === 'withdrawal';
    if (filterType === 'p2p') return tx.type === 'sent' || tx.type === 'received';
    if (filterType === 'pending') return tx.status === 'in_progress';
    return true;
  });

  return (
    <div className="flex flex-col h-full text-white px-5 pt-3 pb-24">
      {/* Header */}
      <div className="flex items-center justify-between min-h-[44px] mb-3">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors text-sm font-medium py-2 rounded-lg"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>Volver</span>
        </button>
        <h1 className="text-[17px] font-semibold text-white tracking-tight">Historial de Transacciones</h1>
        <div className="w-12" />
      </div>

      {/* Search Input */}
      <div className="relative mb-3">
        <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Buscar movimientos, contactos, notas..."
          className="w-full h-11 pl-10 pr-4 rounded-xl bg-[#1e1e21] border border-white/10 text-white text-xs focus:outline-none focus:border-[#ff5a1f] placeholder:text-zinc-500"
        />
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-3 scrollbar-none text-xs">
        {[
          { id: 'all', label: 'Todos' },
          { id: 'deposits', label: 'Depósitos' },
          { id: 'withdrawals', label: 'Retiros' },
          { id: 'p2p', label: 'P2P / Cobros' },
          { id: 'pending', label: 'En progreso' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilterType(tab.id)}
            className={`px-3 py-1.5 rounded-full font-medium whitespace-nowrap transition-colors ${
              filterType === tab.id
                ? 'bg-[#ff5a1f] text-white shadow-sm'
                : 'bg-white/5 text-zinc-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto divide-y divide-white/[0.04] pr-1">
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-zinc-500 text-xs">
            No se encontraron transacciones para este filtro.
          </div>
        ) : (
          filtered.map((tx) => {
            const isIncoming = tx.type === 'deposit' || tx.type === 'received';
            const isInProgress = tx.status === 'in_progress';

            return (
              <button
                key={tx.id}
                onClick={() => onSelectTransaction(tx)}
                className="w-full flex items-center justify-between py-3.5 px-1 hover:bg-white/[0.02] active:bg-white/[0.05] rounded-xl transition-colors text-left"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="relative shrink-0">
                    <div className="w-10 h-10 rounded-full bg-[#222225] flex items-center justify-center text-white/90">
                      {isIncoming ? (
                        <ArrowDownLeft className="w-5 h-5 stroke-[2.2]" />
                      ) : (
                        <ArrowUpRight className="w-5 h-5 stroke-[2.2]" />
                      )}
                    </div>
                    {isInProgress ? (
                      <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-black flex items-center justify-center">
                        <span className="w-2.5 h-2.5 rounded-full border-[1.5px] border-[#ff9500] animate-pulse" />
                      </span>
                    ) : (
                      <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-[#10b981] flex items-center justify-center text-black">
                        <Check className="w-2.5 h-2.5 stroke-[3] text-black" />
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 pr-2">
                    <p className="text-[14px] font-medium text-white truncate leading-snug">
                      {tx.type === 'withdrawal' || tx.title.toLowerCase().includes('withdrawal')
                        ? 'Retiro'
                        : tx.title}
                    </p>
                    <p
                      className={`text-[12px] font-normal leading-snug truncate ${
                        isInProgress
                          ? 'text-[#ff9500]'
                          : tx.type === 'withdrawal'
                          ? 'text-[#10b981]'
                          : 'text-[#10b981]'
                      }`}
                    >
                      {isInProgress
                        ? 'Created · In progress'
                        : tx.type === 'withdrawal'
                        ? 'Retiro · Completed'
                        : `${tx.type} · Completed`}
                    </p>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <div className="flex items-center justify-end gap-1.5 text-white font-medium text-[15px] tabular-nums leading-snug">
                    <CoinIcon className="w-4 h-4 text-zinc-400" />
                    <span>
                      {!isIncoming ? '-' : ''}
                      {tx.amount % 1 === 0 ? tx.amount : tx.amount.toFixed(2)}
                    </span>
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
