import React, { useState } from 'react';
import { X, Check, Copy, Share2, ArrowDownLeft, ArrowUpRight, Download, CheckCircle2, ExternalLink } from 'lucide-react';
import { chain } from '../adapters';
import { Transaction } from '../types/wallet';

interface TransactionReceiptModalProps {
  transaction: Transaction | null;
  onClose: () => void;
  /** Email of the signed-in user, whose wallet owns this history. */
  userEmail?: string | null;
}

/** "AbcdEf…1234" — readable identity when a wallet has no registered email. */
function shortenAddress(value: string): string {
  return value.length <= 14 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export const TransactionReceiptModal: React.FC<TransactionReceiptModalProps> = ({
  transaction,
  onClose,
  userEmail,
}) => {
  const [copied, setCopied] = useState<boolean>(false);
  const [downloadSuccess, setDownloadSuccess] = useState<boolean>(false);

  if (!transaction) return null;

  const isIncoming = transaction.type === 'deposit' || transaction.type === 'received';
  const isCompleted = transaction.status === 'completed';

  // The on-chain identifier is the signature. `txHash` is authoritative and
  // `referenceId` mirrors it on every flow that submits a transaction, so prefer
  // the former and fall back for records that only carry the legacy field.
  const signature = transaction.txHash || transaction.referenceId || null;
  const explorerUrl = signature ? chain.explorerTxUrl(signature) : null;

  // Emisor/Receptor depend on the direction of the movement: for an outgoing
  // one the signed-in wallet is the emitter, for an incoming one it is the
  // receiver. The counterparty shows its registered email when it is a
  // ReWallet user, and falls back to a shortened address otherwise.
  const isOutgoing = transaction.type === 'sent' || transaction.type === 'withdrawal';
  const counterpartyIdentity =
    transaction.counterpartyEmail ??
    (transaction.counterparty ? shortenAddress(transaction.counterparty) : null);
  const ownIdentity =
    userEmail ?? (transaction.walletAddress ? shortenAddress(transaction.walletAddress) : null);
  const emisorIdentity = isOutgoing ? ownIdentity : counterpartyIdentity;
  const receptorIdentity = isOutgoing ? counterpartyIdentity : ownIdentity;

  // "Cadena/Moneda": the product runs on Solana only; assetSymbol is the
  // on-chain token of this movement (legacy rows default to USDC).
  const chainAssetLabel = `Solana/${transaction.assetSymbol ?? 'USDC'}`;

  const handleCopyId = () => {
    setCopied(true);
    navigator.clipboard?.writeText(signature || transaction.id);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    setDownloadSuccess(true);
    setTimeout(() => setDownloadSuccess(false), 2500);
  };

  // Format: "USD +" / "USD -" / "USD" (when pending)
  const formatAmountDisplay = () => {
    if (!isCompleted) {
      return transaction.assetSymbol ?? 'USDC';
    }
    return `${transaction.assetSymbol ?? 'USDC'} ${isIncoming ? '+' : '-'}`;
  };

  return (
    <div
      className="absolute inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-md p-0 overflow-hidden animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="w-full bg-[#161619] rounded-t-[32px] border-t border-white/10 p-5 pb-8 text-white max-h-[92%] overflow-y-auto shadow-2xl animate-in slide-in-from-bottom-8 duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Handle / Close */}
        <div className="flex items-center justify-between mb-4">
          <div className="w-10 h-1 bg-white/20 rounded-full mx-auto sm:hidden" />
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
            Comprobante de Transacción
          </span>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Center Icon & Amount */}
        <div className="text-center py-3">
          <div className="w-14 h-14 rounded-full bg-[#222225] flex items-center justify-center text-white mx-auto mb-3 relative">
            {isIncoming ? (
              <ArrowDownLeft className="w-7 h-7 stroke-[2.2] text-[#26e5c8]" />
            ) : (
              <ArrowUpRight className="w-7 h-7 stroke-[2.2] text-[#ff5a1f]" />
            )}
            {isCompleted ? (
              <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-[#10b981] flex items-center justify-center text-black">
                <Check className="w-3 h-3 stroke-[3]" />
              </span>
            ) : (
              <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-black flex items-center justify-center">
                <span className="w-3 h-3 rounded-full border-2 border-[#ff9500] animate-pulse" />
              </span>
            )}
          </div>

          <h3 className="text-base font-semibold text-white mb-0.5">
            {transaction.type === 'withdrawal' || transaction.title.toLowerCase().includes('withdrawal')
              ? 'Retiro'
              : transaction.title}
          </h3>
          <p className="text-xs text-zinc-400 mb-3">{transaction.timestamp}</p>

          <div className="flex items-center justify-center gap-2 text-white font-bold text-3xl tabular-nums">
            <span className="text-[13px] font-semibold text-zinc-500 uppercase tracking-wider">
              {formatAmountDisplay()}
            </span>
            <span>{transaction.amount.toFixed(2)}</span>
          </div>
        </div>

        {/* Details Grid — order: Cadena/Moneda, Emisor, Receptor, Explorador, Estado */}
        <div className="my-5 p-4 rounded-2xl bg-[#1e1e22] border border-white/5 space-y-2.5 text-xs">
          <div className="flex justify-between">
            <span className="text-zinc-400">Cadena/Moneda</span>
            <span className="text-white font-medium">{chainAssetLabel}</span>
          </div>

          <div className="flex justify-between gap-3">
            <span className="text-zinc-400">Emisor</span>
            <span className="text-white font-medium text-right break-all">
              {emisorIdentity ?? '—'}
            </span>
          </div>

          <div className="flex justify-between gap-3">
            <span className="text-zinc-400">Receptor</span>
            <span className="text-white font-medium text-right break-all">
              {receptorIdentity ?? '—'}
            </span>
          </div>

          {explorerUrl && (
            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-400">Ver en el explorador</span>
              <div className="flex items-center gap-1.5">
                <a
                  href={explorerUrl}
                  rel="noreferrer"
                  target="_blank"
                  className="inline-flex items-center gap-1 text-[#26e5c8] hover:text-white transition-colors"
                >
                  <span>Ver transacción</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
                <button
                  onClick={handleCopyId}
                  className="p-1 hover:text-white transition-colors"
                  title="Copiar hash"
                >
                  {copied ? <Check className="w-3 h-3 text-[#26e5c8]" /> : <Copy className="w-3 h-3" />}
                </button>
              </div>
            </div>
          )}

          <div className="flex justify-between">
            <span className="text-zinc-400">Estado</span>
            <span
              className={`font-semibold ${
                isCompleted ? 'text-[#10b981]' : 'text-[#ff9500]'
              }`}
            >
              {isCompleted ? 'Completado con éxito' : 'En proceso de validación'}
            </span>
          </div>

          {typeof transaction.feeLamports === 'number' && transaction.feeLamports > 0 && (
            <div className="flex justify-between">
              <span className="text-zinc-400">Fee de red</span>
              <span className="text-white font-medium tabular-nums">
                {(transaction.feeLamports / 1_000_000_000).toFixed(9).replace(/0+$/, '').replace(/\.$/, '')} SOL
              </span>
            </div>
          )}

          {transaction.note && (
            <div className="flex justify-between pt-1 border-t border-white/5">
              <span className="text-zinc-400">Nota / Memo</span>
              <span className="text-zinc-200 text-right max-w-[180px]">{transaction.note}</span>
            </div>
          )}

        </div>

        {/* Action Buttons */}
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={handleDownload}
              className="py-3 px-3 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-semibold flex items-center justify-center gap-2 border border-white/10 transition-colors"
            >
              {downloadSuccess ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-[#26e5c8]" />
                  <span>¡Descargado!</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Descargar</span>
                </>
              )}
            </button>
            <button
              onClick={handleCopyId}
              className="py-3 px-3 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-semibold flex items-center justify-center gap-2 border border-white/10 transition-colors"
            >
              <Share2 className="w-4 h-4" />
              <span>{copied ? '¡ID Copiado!' : 'Compartir'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};