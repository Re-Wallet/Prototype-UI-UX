import React, { useState } from 'react';
import { ArrowLeft, CheckCircle2, Copy, Check, Loader2, Zap } from 'lucide-react';
import { CoinIcon } from './CoinIcon';
import { Transaction } from '../types/wallet';

interface DepositFlowProps {
  balance: number;
  onClose: () => void;
  onDepositComplete: (transaction: Transaction) => void;
}

export const DepositFlow: React.FC<DepositFlowProps> = ({
  balance,
  onClose,
  onDepositComplete,
}) => {
  const [selectedCryptoChain, setSelectedCryptoChain] = useState<string>('Base');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [lastTx, setLastTx] = useState<Transaction | null>(null);
  const [isSuccess, setIsSuccess] = useState<boolean>(false);
  const depositAmount = 50;

  const handleCopyAddress = () => {
    setCopied(true);
    navigator.clipboard?.writeText('0x8F4A9215c829E102919F838194A81283B93C4182');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSimulateCryptoReceive = () => {
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      const newTx: Transaction = {
        id: `tx-${Date.now()}`,
        title: 'Crypto deposit',
        type: 'deposit',
        status: 'completed',
        amount: depositAmount,
        fiatAmount: depositAmount,
        fiatCurrency: 'USD',
        timestamp: 'Just now',
        date: new Date(),
        method: `${selectedCryptoChain} Network (USDC)`,
        referenceId: `0x${Math.random().toString(16).substring(2, 10)}...`,
        txHash: `0x${Math.random().toString(16).substring(2)}${Math.random().toString(16).substring(2)}`,
        note: `Depósito USDC recibido en red ${selectedCryptoChain}`,
      };
      setLastTx(newTx);
      onDepositComplete(newTx);
      setIsSuccess(true);
    }, 1800);
  };

  // SUCCESS SCREEN
  if (isSuccess) {
    return (
      <div className="flex flex-col h-full justify-between items-center text-center text-white px-5 pt-12 pb-8">
        <div className="flex flex-col items-center">
          <div className="w-16 h-16 rounded-full bg-[#10b981]/20 border-2 border-[#10b981] flex items-center justify-center text-[#10b981] mb-5">
            <CheckCircle2 className="w-9 h-9" />
          </div>

          <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">
            ¡Depósito Exitoso!
          </h2>
          <p className="text-sm text-zinc-400 mb-6">
            Se han acreditado tus dólares digitales en tu billetera Mozaik.
          </p>

          <div className="w-full max-w-xs p-4 rounded-2xl bg-[#1e1e21] border border-white/5 mb-4 text-left space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Monto Acreditado</span>
              <span className="text-white font-bold tabular-nums">Ⓢ {depositAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Red</span>
              <span className="text-zinc-200">{lastTx?.method}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Referencia</span>
              <span className="text-zinc-300 font-mono text-[11px]">{lastTx?.referenceId}</span>
            </div>
            <div className="flex justify-between text-xs pt-1 border-t border-white/5">
              <span className="text-zinc-400">Nuevo Saldo</span>
              <span className="text-[#26e5c8] font-bold tabular-nums">Ⓢ {(balance + depositAmount).toFixed(2)}</span>
            </div>
          </div>
        </div>

        <div className="w-full pb-2">
          <button
            onClick={onClose}
            className="w-full h-13 rounded-2xl bg-white hover:bg-zinc-200 text-black font-semibold text-[15px] transition-all cursor-pointer"
          >
            Ir al Inicio
          </button>
        </div>
      </div>
    );
  }

  // DEFAULT VIEW: Directly Crypto Deposit (Bypassing amount & method steps as requested)
  return (
    <div className="flex flex-col h-full justify-between text-white px-5 pt-3 pb-8 overflow-y-auto">
      <div>
        <div className="flex items-center justify-between min-h-[44px] mb-3">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors text-sm font-medium py-2 rounded-lg cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
            <span>Back</span>
          </button>
          <h1 className="text-[17px] font-semibold text-white tracking-tight">Crypto Deposit</h1>
          <div className="w-12" />
        </div>

        {/* Network Selector */}
        <div className="mb-4">
          <label className="text-xs font-medium text-zinc-400 block mb-1.5">
            Red blockchain (USDC)
          </label>
          <div className="grid grid-cols-4 gap-1.5 p-1 rounded-xl bg-[#19191c] border border-white/5">
            {['Base', 'Polygon', 'Arbitrum', 'Solana'].map((chain) => (
              <button
                key={chain}
                onClick={() => setSelectedCryptoChain(chain)}
                className={`py-2 px-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  selectedCryptoChain === chain
                    ? 'bg-[#ff5a1f] text-white shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {chain}
              </button>
            ))}
          </div>
        </div>

        {/* QR Code Container */}
        <div className="p-5 rounded-2xl bg-white flex flex-col items-center justify-center my-2 max-w-[240px] mx-auto shadow-xl">
          <div className="w-44 h-44 bg-white p-2 flex flex-col justify-between">
            <div className="flex justify-between">
              <div className="w-12 h-12 border-4 border-black p-1 flex items-center justify-center">
                <div className="w-6 h-6 bg-black" />
              </div>
              <div className="w-8 h-8 grid grid-cols-2 gap-1 p-0.5">
                <div className="bg-black" />
                <div className="bg-black" />
              </div>
              <div className="w-12 h-12 border-4 border-black p-1 flex items-center justify-center">
                <div className="w-6 h-6 bg-black" />
              </div>
            </div>
            <div className="my-auto py-2 flex items-center justify-center">
              <div className="w-10 h-10 rounded-full bg-[#ff5a1f] text-white flex items-center justify-center font-bold text-xs shadow-md">
                Ⓢ
              </div>
            </div>
            <div className="flex justify-between items-end">
              <div className="w-12 h-12 border-4 border-black p-1 flex items-center justify-center">
                <div className="w-6 h-6 bg-black" />
              </div>
              <div className="w-16 h-8 grid grid-cols-4 gap-1">
                <div className="bg-black" />
                <div className="bg-black" />
                <div className="bg-black" />
                <div className="bg-black" />
              </div>
            </div>
          </div>
          <p className="text-[11px] font-medium text-black/70 mt-2 text-center">
            Escanea para depositar USDC ({selectedCryptoChain})
          </p>
        </div>

        {/* Wallet Address Copy Box */}
        <div className="mt-3 p-3 rounded-xl bg-[#1e1e21] border border-white/5 flex items-center justify-between">
          <div className="min-w-0 pr-2">
            <span className="text-[10px] text-zinc-500 block uppercase tracking-wider font-semibold">
              Tu dirección ({selectedCryptoChain})
            </span>
            <p className="text-xs font-mono text-zinc-200 truncate">
              0x8F4A9215c829E102919F838194A81283B93C4182
            </p>
          </div>
          <button
            onClick={handleCopyAddress}
            className="p-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white shrink-0 active:scale-95 transition-all cursor-pointer"
            title="Copiar dirección"
          >
            {copied ? <Check className="w-4 h-4 text-[#26e5c8]" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>

        {/* Quick simulator test button */}
        <div className="mt-4">
          <button
            onClick={handleSimulateCryptoReceive}
            disabled={isProcessing}
            className="w-full py-2.5 px-3 rounded-xl bg-[#26e5c8]/10 hover:bg-[#26e5c8]/20 border border-[#26e5c8]/30 text-[#26e5c8] text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Detectando transacción en {selectedCryptoChain}...</span>
              </>
            ) : (
              <>
                <Zap className="w-3.5 h-3.5" />
                <span>Simular llegada de depósito (Ⓢ {depositAmount.toFixed(2)})</span>
              </>
            )}
          </button>
        </div>
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
