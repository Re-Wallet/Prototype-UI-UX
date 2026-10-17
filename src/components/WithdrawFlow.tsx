import React, { useState } from 'react';
import { ArrowLeft, CheckCircle2, Loader2, Send } from 'lucide-react';
import { transferAmount } from '@dynamic-labs-sdk/client';
import type { SolanaWalletAccount } from '@dynamic-labs-sdk/solana';
import { Keypad } from './Keypad';
import { CoinIcon } from './CoinIcon';
import { dynamicClient } from '../dynamicClient';
import { assetBySymbol, chain, type Address } from '../adapters';
import type { Transaction } from '../types/wallet';

interface WithdrawFlowProps {
  balance: number;
  balanceError?: string | null;
  balanceLoading: boolean;
  solanaWallet?: SolanaWalletAccount;
  onClose: () => void;
  onWithdrawComplete: (transaction: Transaction) => void;
}

type WithdrawStep = 'amount' | 'details' | 'success';

export const WithdrawFlow: React.FC<WithdrawFlowProps> = ({
  balance,
  balanceError,
  balanceLoading,
  solanaWallet,
  onClose,
  onWithdrawComplete,
}) => {
  const [step, setStep] = useState<WithdrawStep>('amount');
  const [amountStr, setAmountStr] = useState('0');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const amount = Number.parseFloat(amountStr) || 0;
  const isOverBalance = amount > balance;
  const asset = assetBySymbol('USDC', chain.network().cluster);

  const handleSend = async () => {
    setSendError(null);
    if (!solanaWallet) {
      setSendError('No se encontró la wallet Solana de esta cuenta.');
      return;
    }
    if (!asset) {
      setSendError(`USDC no está configurado para ${chain.network().cluster}.`);
      return;
    }
    if (balanceLoading || balanceError) {
      setSendError(balanceError ?? 'Espera a que se lea el balance de la wallet.');
      return;
    }
    if (amount <= 0 || isOverBalance) {
      setSendError('El monto debe ser mayor que cero y no superar el balance disponible.');
      return;
    }
    if (!chain.isBase58(recipientAddress)) {
      setSendError('Ingresa una dirección pública Solana válida.');
      return;
    }

    setIsSending(true);
    try {
      // Confirm Dynamic signs against the same cluster the app is configured
      // for. See adapters/dynamic-network.ts for why this is not automatic.
      const alignment = await chain.ensureDynamicNetwork(solanaWallet);
      if (!alignment.ok) {
        throw new Error(
          alignment.alignment.reason ??
            'La red de la wallet no coincide con la red de la app.'
        );
      }

      const recipientCheck = await chain.verifyRecipient(recipientAddress as Address, asset);
      if (!recipientCheck.ok) {
        throw new Error(recipientCheck.reason ?? 'La dirección no puede recibir USDC.');
      }

      const { transactionHash } = await transferAmount({
        walletAccount: solanaWallet,
        amount: amount.toFixed(asset.decimals),
        recipient: recipientAddress,
        token: { address: asset.mint, decimals: asset.decimals },
      }, dynamicClient);

      setSignature(transactionHash);
      onWithdrawComplete({
        id: `tx-${Date.now()}`,
        title: 'Envío USDC',
        counterparty: recipientAddress,
        type: 'withdrawal',
        status: 'in_progress',
        amount,
        fiatAmount: amount,
        fiatCurrency: 'USD',
        timestamp: 'Just now',
        date: new Date(),
        method: `Solana ${asset.symbol}`,
        referenceId: transactionHash,
        txHash: transactionHash,
        note: 'Envío firmado por tu wallet Solana',
        walletAddress: solanaWallet.address,
      });
      setStep('success');
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSending(false);
    }
  };

  if (step === 'amount') {
    return (
      <div className="h-full flex flex-col justify-between">
        <Keypad
          balance={balance}
          value={amountStr}
          onChange={setAmountStr}
          actionLabel={isOverBalance ? 'Balance insuficiente' : 'Continuar'}
          actionDisabled={isOverBalance || amount <= 0 || balanceLoading || Boolean(balanceError)}
          onAction={() => setStep('details')}
          onBack={onClose}
          title="Enviar USDC"
          subtitle={balanceError ?? undefined}
        />
      </div>
    );
  }

  if (step === 'details') {
    return (
      <div className="flex flex-col h-full justify-between text-white px-5 pt-3 pb-8 overflow-y-auto">
        <div>
          <div className="flex items-center justify-between min-h-[44px] mb-3">
            <button
              onClick={() => setStep('amount')}
              disabled={isSending}
              className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors text-sm font-medium py-2 rounded-lg cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Volver</span>
            </button>
            <h1 className="text-[17px] font-semibold text-white tracking-tight">Confirmar envío</h1>
            <div className="w-12" />
          </div>

          <div className="p-4 rounded-2xl bg-[#1c1c1f] border border-white/5 mb-4 text-center">
            <span className="text-xs text-zinc-400 block mb-1">Monto a enviar</span>
            <div className="flex items-center justify-center gap-2">
              <CoinIcon className="w-6 h-6 text-zinc-300" />
              <span className="text-3xl font-bold text-white tabular-nums">{amount.toFixed(2)}</span>
            </div>
            <span className="text-xs text-zinc-500 font-medium">USDC · {chain.describeNetwork()}</span>
          </div>

          <label className="text-xs font-medium text-zinc-400 block mb-1.5" htmlFor="withdraw-recipient">
            Dirección Solana de destino
          </label>
          <input
            id="withdraw-recipient"
            type="text"
            autoComplete="off"
            value={recipientAddress}
            onChange={(event) => setRecipientAddress(event.target.value.trim())}
            placeholder="Pega una dirección pública Solana"
            className="w-full min-h-12 px-3.5 rounded-xl bg-[#1e1e21] border border-white/10 text-white text-xs font-mono focus:outline-none focus:border-[#ff5a1f]"
          />
          <p className="mt-2 text-[11px] text-zinc-500">
            La wallet Dynamic firmará un envío de USDC en {chain.describeNetwork()}. Revisa cuidadosamente la dirección.
          </p>
          {sendError && <p role="alert" className="mt-3 text-xs text-red-400">{sendError}</p>}
        </div>

        <div className="pt-4 pb-2">
          <button
            onClick={handleSend}
            disabled={isSending || balanceLoading || Boolean(balanceError) || !solanaWallet || amount <= 0 || isOverBalance}
            className="w-full h-13 rounded-2xl bg-[#ff5a1f] hover:bg-[#ff6c35] disabled:bg-zinc-800 disabled:text-zinc-500 active:scale-[0.98] text-white font-semibold text-[15px] flex items-center justify-center gap-2 shadow-lg shadow-[#ff5a1f]/20 cursor-pointer disabled:cursor-not-allowed transition-all"
          >
            {isSending ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Firmando y enviando...</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                <span>Enviar {amount.toFixed(2)} USDC</span>
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full justify-between items-center text-center text-white px-5 pt-12 pb-8">
      <div className="flex flex-col items-center">
        <div className="w-16 h-16 rounded-full bg-[#10b981]/20 border-2 border-[#10b981] flex items-center justify-center text-[#10b981] mb-5">
          <CheckCircle2 className="w-9 h-9" />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">Envío enviado a Solana</h2>
        <p className="text-sm text-zinc-400 mb-4">
          La transacción fue firmada por tu wallet. La confirmación puede tardar unos instantes.
        </p>
        {signature && (
          <a
            href={chain.explorerTxUrl(signature)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-[#26e5c8] underline break-all"
          >
            Ver transacción en Solscan
          </a>
        )}
      </div>
      <div className="w-full pb-2">
        <button
          onClick={onClose}
          className="w-full h-13 rounded-2xl bg-white hover:bg-zinc-200 text-black font-semibold text-[15px] transition-all cursor-pointer"
        >
          Volver a la billetera
        </button>
      </div>
    </div>
  );
};
