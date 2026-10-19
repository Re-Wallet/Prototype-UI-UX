import React, { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, ClipboardPaste, Loader2, ScanLine, Search, Send } from 'lucide-react';
import { transferAmount } from '@dynamic-labs-sdk/client';
import type { SolanaWalletAccount } from '@dynamic-labs-sdk/solana';
import { Keypad } from './Keypad';
import { CoinIcon } from './CoinIcon';
import { QrScannerFlow } from './QrScannerFlow';
import { getDynamicClient } from '../dynamicClient';
import { assetBySymbol, chain, type Address } from '../adapters';
import { fetchRecentRecipients, type RecentRecipient } from '../services/walletApi';
import type { Transaction } from '../types/wallet';
import type { Translations } from '../i18n/translations';

interface WithdrawFlowProps {
  balance: number;
  balanceError?: string | null;
  balanceLoading: boolean;
  solanaWallet?: SolanaWalletAccount;
  onClose: () => void;
  onWithdrawComplete: (transaction: Transaction) => void;
  t: Translations;
}

type WithdrawStep = 'amount' | 'details' | 'success';

export const WithdrawFlow: React.FC<WithdrawFlowProps> = ({
  balance,
  balanceError,
  balanceLoading,
  solanaWallet,
  onClose,
  onWithdrawComplete,
  t,
}) => {
  const [step, setStep] = useState<WithdrawStep>('amount');
  const [amountStr, setAmountStr] = useState('0');
  const [recipientAddress, setRecipientAddress] = useState('');
  const [recipientQuery, setRecipientQuery] = useState('');
  const [recentRecipients, setRecentRecipients] = useState<RecentRecipient[]>([]);
  const [isScanningRecipient, setIsScanningRecipient] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const amount = Number.parseFloat(amountStr) || 0;
  const isOverBalance = amount > balance;
  const asset = assetBySymbol('USDC', chain.network().cluster);

  // Recent recipients come from the API (contacts merged with the counterparties
  // of past outgoing movements), never from the RPC.
  useEffect(() => {
    if (step !== 'details' || !solanaWallet) return;
    let cancelled = false;
    void fetchRecentRecipients(solanaWallet.address).then((entries) => {
      if (!cancelled) setRecentRecipients(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [step, solanaWallet?.address]);

  /**
   * Self-payouts are rejected everywhere: the app's own wallet has no reason
   * to pay itself, and letting it through wastes a fee on a no-op.
   */
  const isOwnAddress = (candidate: string): boolean =>
    Boolean(solanaWallet) && candidate === solanaWallet!.address;

  const acceptRecipient = (candidate: string) => {
    if (isOwnAddress(candidate)) {
      setSendError('No podés retirar a tu propia wallet. Usá una dirección distinta.');
      return;
    }
    setRecipientAddress(candidate);
    setSendError(null);
  };

  const handlePasteAddress = async () => {
    try {
      const clipboard = await navigator.clipboard.readText();
      const candidate = clipboard.trim();
      if (!chain.isBase58(candidate)) {
        setSendError('El portapapeles no contiene una dirección Solana válida.');
        return;
      }
      acceptRecipient(candidate);
    } catch {
      setSendError('No pudimos leer el portapapeles. Pegá la dirección a mano.');
    }
  };

  const handleAddressScanned = (candidate: string) => {
    setIsScanningRecipient(false);
    acceptRecipient(candidate);
  };

  // You are never offered yourself as a destination: the row would always
  // dead-end on the self-payout guard below.
  const visibleRecipients = recentRecipients.filter((entry) => !isOwnAddress(entry.address));
  const searchLower = recipientQuery.trim().toLowerCase();
  const filteredRecipients = searchLower
    ? visibleRecipients.filter((entry) =>
        [entry.email, entry.name, entry.handle, entry.address]
          .filter((field): field is string => Boolean(field))
          .some((field) => field.toLowerCase().includes(searchLower))
      )
    : visibleRecipients;

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
    if (isOwnAddress(recipientAddress)) {
      setSendError('No podés retirar a tu propia wallet. Usá una dirección distinta.');
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
      }, getDynamicClient());

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
          presetStyle="slider"
        />
      </div>
    );
  }

  if (step === 'details') {
    // The scanner overlays the form instead of unmounting it, so the amount
    // the user already typed survives a scan round-trip.
    if (isScanningRecipient) {
      return (
        <QrScannerFlow
          mode="address"
          t={t}
          onAddressDetected={handleAddressScanned}
          onClose={() => setIsScanningRecipient(false)}
        />
      );
    }

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
          <div className="relative">
            <input
              id="withdraw-recipient"
              type="text"
              autoComplete="off"
              value={recipientAddress}
              onChange={(event) => setRecipientAddress(event.target.value.trim())}
              placeholder="Pega o escanea una dirección Solana"
              className="w-full min-h-12 pl-3.5 pr-20 rounded-xl bg-[#1e1e21] border border-white/10 text-white text-xs font-mono focus:outline-none focus:border-[#ff5a1f]"
            />
            <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => void handlePasteAddress()}
                aria-label="Pegar dirección"
                title="Pegar dirección"
                className="flex items-center justify-center w-9 h-9 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 active:bg-white/[0.14] transition-colors cursor-pointer"
              >
                <ClipboardPaste className="w-4.5 h-4.5" />
              </button>
              <button
                type="button"
                onClick={() => setIsScanningRecipient(true)}
                aria-label="Escanear QR"
                title="Escanear QR"
                className="flex items-center justify-center w-9 h-9 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 active:bg-white/[0.14] transition-colors cursor-pointer"
              >
                <ScanLine className="w-4.5 h-4.5" />
              </button>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">
            La wallet Dynamic firmará un envío de USDC en {chain.describeNetwork()}. Revisa cuidadosamente la dirección.
          </p>
          {sendError && <p role="alert" className="mt-3 text-xs text-red-400">{sendError}</p>}

          {recentRecipients.length > 0 && (
            <div className="mt-5">
              <div className="w-full h-11 rounded-xl bg-[#1e1e21] border border-white/10 flex items-center px-3.5 mb-2">
                <Search className="w-4 h-4 text-zinc-500 mr-2.5 shrink-0" />
                <input
                  type="text"
                  placeholder="Buscar en recientes"
                  value={recipientQuery}
                  onChange={(event) => setRecipientQuery(event.target.value)}
                  className="w-full bg-transparent text-white text-xs placeholder:text-zinc-500 outline-none"
                />
              </div>
              <p className="text-xs font-semibold text-zinc-300 mb-1">Recientes</p>
              <div className="divide-y divide-white/[0.04]">
                {filteredRecipients.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => acceptRecipient(entry.address)}
                    className="w-full flex items-center justify-between py-3 px-1 hover:bg-white/[0.02] active:bg-white/[0.05] rounded-xl transition-colors text-left cursor-pointer"
                  >
                    <span className="min-w-0 pr-2">
                      <span className="block text-[13px] font-medium text-white truncate">
                        {entry.email ?? entry.name}
                      </span>
                      <span className="block text-[11px] font-mono text-zinc-500 truncate">
                        {entry.address}
                      </span>
                    </span>
                    {recipientAddress === entry.address && (
                      <CheckCircle2 className="w-4 h-4 text-[#26e5c8] shrink-0" />
                    )}
                  </button>
                ))}
                {filteredRecipients.length === 0 && (
                  <p className="py-3 text-[11px] text-zinc-500">Sin resultados.</p>
                )}
              </div>
            </div>
          )}
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
