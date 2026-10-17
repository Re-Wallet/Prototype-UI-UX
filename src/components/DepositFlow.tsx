import React, { useEffect, useState } from 'react';
import { ArrowLeft, Check, Copy, Loader2, RefreshCw } from 'lucide-react';
import { chain } from '../adapters';

interface DepositFlowProps {
  solanaAddress?: string;
  balanceError?: string | null;
  onRefreshBalance: () => Promise<void>;
  onClose: () => void;
}

export const DepositFlow: React.FC<DepositFlowProps> = ({
  solanaAddress,
  balanceError,
  onRefreshBalance,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    setQrDataUrl(null);
    setQrError(null);

    if (!solanaAddress) {
      setQrError('No se encontró la dirección de tu wallet Solana.');
      return () => {
        isCurrent = false;
      };
    }

    void chain.renderQrDataUrl(solanaAddress)
      .then((dataUrl) => {
        if (isCurrent) setQrDataUrl(dataUrl);
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setQrError(error instanceof Error ? error.message : String(error));
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [solanaAddress]);

  const handleCopyAddress = async () => {
    if (!solanaAddress) return;
    try {
      if (!navigator.clipboard) throw new Error('El navegador no permite copiar la dirección.');
      await navigator.clipboard.writeText(solanaAddress);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      setQrError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleRefreshBalance = async () => {
    setRefreshing(true);
    try {
      await onRefreshBalance();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="flex flex-col h-full justify-between text-white px-5 pt-3 pb-8 overflow-y-auto">
      <div>
        <div className="flex items-center justify-between min-h-[44px] mb-3">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors text-sm font-medium py-2 rounded-lg cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Volver</span>
          </button>
          <h1 className="text-[17px] font-semibold text-white tracking-tight">Depósito USDC</h1>
          <div className="w-12" />
        </div>

        <p className="text-xs text-zinc-400 text-center mb-3">
          Envía USDC en {chain.describeNetwork()} a esta dirección y consulta el saldo en la red después de la confirmación.
        </p>

        <div className="p-5 rounded-2xl bg-white flex flex-col items-center justify-center my-2 max-w-[240px] mx-auto shadow-xl">
          {qrDataUrl ? (
            <img
              alt="Código QR de la dirección de tu wallet Solana"
              className="h-44 w-44"
              src={qrDataUrl}
            />
          ) : (
            <div aria-live="polite" className="flex h-44 w-44 items-center justify-center text-center text-xs text-zinc-700">
              {qrError ? 'No se pudo generar el QR' : <Loader2 className="h-6 w-6 animate-spin" />}
            </div>
          )}
          <p className="text-[11px] font-medium text-black/70 mt-2 text-center">
            Este QR contiene la dirección de tu wallet Solana
          </p>
          {qrError && <p role="alert" className="mt-2 text-center text-[11px] text-red-600">{qrError}</p>}
        </div>

        <div className="mt-3 p-3 rounded-xl bg-[#1e1e21] border border-white/5 flex items-center justify-between">
          <div className="min-w-0 pr-2">
            <span className="text-[10px] text-zinc-500 block uppercase tracking-wider font-semibold">
              Wallet · {chain.describeNetwork()}
            </span>
            <p className="text-xs font-mono text-zinc-200 break-all">
              {solanaAddress ?? 'Wallet Solana no disponible'}
            </p>
          </div>
          <button
            onClick={handleCopyAddress}
            disabled={!solanaAddress}
            className="p-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white shrink-0 active:scale-95 transition-all cursor-pointer disabled:opacity-40"
            title="Copiar dirección"
          >
            {copied ? <Check className="w-4 h-4 text-[#26e5c8]" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
        {balanceError && <p role="alert" className="mt-2 text-xs text-red-400">{balanceError}</p>}
        <button
          onClick={handleRefreshBalance}
          disabled={refreshing || !solanaAddress}
          className="mt-3 w-full h-11 rounded-xl bg-[#26e5c8]/10 hover:bg-[#26e5c8]/20 disabled:opacity-50 border border-[#26e5c8]/30 text-[#26e5c8] text-sm font-semibold flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
        >
          {refreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          <span>Actualizar saldo desde Solana</span>
        </button>
      </div>

      <div className="pt-4 pb-2">
        <button
          onClick={onClose}
          className="w-full h-12 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 text-sm font-medium transition-colors cursor-pointer"
        >
          Cerrar
        </button>
      </div>
    </div>
  );
};
