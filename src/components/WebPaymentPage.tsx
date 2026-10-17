import React, { useEffect, useMemo, useState } from 'react';
import { transferAmount } from '@dynamic-labs-sdk/client';
import { isSolanaWalletAccount } from '@dynamic-labs-sdk/solana';
import { useGetWalletAccounts } from '@dynamic-labs-sdk/react-hooks';
import { ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react';
import { assetByMint, chain, type Address } from '../adapters';
import { getDynamicClient } from '../dynamicClient';
import type { Transaction } from '../types/wallet';
import { parseWebPaymentUrl, type WebPaymentIntent } from '../services/webPaymentLink';

function shortenAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

interface WebPaymentPageProps {
  onPaymentSubmitted: (transaction: Transaction) => void;
}

function getIntent(): WebPaymentIntent | null {
  return parseWebPaymentUrl(window.location.href);
}

export const WebPaymentPage: React.FC<WebPaymentPageProps> = ({ onPaymentSubmitted }) => {
  const intent = useMemo(getIntent, []);
  const { data: walletAccounts = [] } = useGetWalletAccounts();
  const payerWallet = walletAccounts.find(isSolanaWalletAccount);
  const [balance, setBalance] = useState<number | null>(null);
  const [amountInput, setAmountInput] = useState(intent?.amount?.toString() ?? '');
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);

  const asset = useMemo(
    () => intent ? assetByMint(intent.mint, intent.cluster) : null,
    [intent]
  );
  const amount = Number(amountInput);
  const isValidAmount = /^\d+(?:\.\d{1,6})?$/.test(amountInput.trim());
  const payerAddress = payerWallet?.address;
  const isSelfPayment = Boolean(intent && payerAddress === intent.recipient);

  useEffect(() => {
    let cancelled = false;
    if (!intent || !asset || intent.cluster !== chain.network().cluster || !payerAddress) {
      setBalance(null);
      setIsLoadingBalance(false);
      return;
    }

    setIsLoadingBalance(true);
    void chain.getBalance(payerAddress as Address, asset)
      .then((result) => {
        if (!cancelled) {
          setBalance(result.ui);
          setError(null);
        }
      })
      .catch((requestError: unknown) => {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : String(requestError));
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingBalance(false);
      });
    return () => {
      cancelled = true;
    };
  }, [asset, intent, payerAddress]);

  const handlePay = async () => {
    if (!intent || !asset || !payerWallet) {
      setError('No se encontró una wallet Solana para pagar esta solicitud.');
      return;
    }
    if (intent.cluster !== chain.network().cluster) {
      setError(`Esta solicitud es de ${intent.cluster}; la app está conectada a ${chain.network().cluster}.`);
      return;
    }
    if (isSelfPayment) {
      setError('No puedes pagarte a tu propia wallet desde esta cuenta.');
      return;
    }
    if (!isValidAmount || !Number.isFinite(amount) || amount <= 0 || amount > (balance ?? 0)) {
      setError('Ingresa un monto válido que no supere tu saldo USDC disponible.');
      return;
    }

    setIsPaying(true);
    setError(null);
    try {
      // Dynamic resolves the signing cluster from its provider's active
      // network, not from this app's cluster. Confirm both agree before
      // building a transaction, otherwise the fee payer is debited on a
      // network where it has no balance and the failure is an opaque
      // simulation error.
      const alignment = await chain.ensureDynamicNetwork(payerWallet);
      if (!alignment.ok) {
        throw new Error(
          alignment.alignment.reason ??
            'La red de la wallet no coincide con la red de la solicitud.'
        );
      }

      const recipientCheck = await chain.verifyRecipient(intent.recipient, asset);
      if (!recipientCheck.ok) {
        throw new Error(recipientCheck.reason ?? 'La wallet receptora no puede recibir USDC.');
      }
      const { transactionHash } = await transferAmount({
        walletAccount: payerWallet,
        amount: amount.toFixed(asset.decimals),
        recipient: intent.recipient,
        token: { address: asset.mint, decimals: asset.decimals },
      }, getDynamicClient());
      setSignature(transactionHash);
      onPaymentSubmitted({
        id: transactionHash,
        title: intent.message || 'Pago Solana',
        counterparty: intent.recipient,
        type: 'sent',
        status: 'in_progress',
        amount,
        assetSymbol: 'USDC',
        fiatAmount: amount,
        fiatCurrency: 'USD',
        timestamp: new Date().toLocaleString(),
        date: new Date(),
        method: 'Solana USDC',
        referenceId: transactionHash,
        note: intent.message || undefined,
        txHash: transactionHash,
        walletAddress: payerWallet.address,
      });
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : String(paymentError));
    } finally {
      setIsPaying(false);
    }
  };

  const closePaymentPage = () => window.location.assign('/');

  return (
    <div className="flex h-full flex-col px-6 py-6 text-white">
      {!intent || !asset ? (
        <div className="flex w-full flex-1 flex-col items-center justify-center text-center">
          <h1 className="mb-2 text-xl font-bold">Solicitud no válida</h1>
          <p className="text-sm text-zinc-400">Revisa el enlace o solicita uno nuevo al comercio.</p>
        </div>
      ) : signature ? (
        <>
          <div className="flex w-full flex-1 flex-col items-center justify-center">
            <div className="mb-6 text-center">
              <img
                alt="ReWallet"
                className="mx-auto mb-4 h-12 w-auto select-none"
                src="/rewallet-lockup.png"
              />
              <h1 className="text-2xl font-bold">Solicitud de pago</h1>
            </div>

            <div className="w-full rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center">
              <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-emerald-400" />
              <p className="mb-3 text-lg font-semibold text-emerald-300">Transacción enviada a Solana</p>
              <a
                className="break-all text-sm text-emerald-200 underline hover:text-emerald-100 transition-colors"
                href={chain.explorerTxUrl(signature)}
                rel="noreferrer"
                target="_blank"
              >
                Ver firma en el explorador
              </a>
            </div>
          </div>

          <button
            onClick={closePaymentPage}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white/5 hover:bg-white/10 text-sm font-medium text-zinc-300 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Inicio
          </button>
        </>
      ) : (
        <>
          <button
            onClick={closePaymentPage}
            className="mb-8 flex items-center gap-2 self-start text-sm font-medium text-zinc-400 hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            Inicio
          </button>

          <div className="flex w-full flex-1 flex-col items-center justify-center">
            <div className="mb-6 text-center">
              <img
                alt="ReWallet"
                className="mx-auto mb-4 h-12 w-auto select-none"
                src="/rewallet-lockup.png"
              />
              <h1 className="text-2xl font-bold">Solicitud de pago</h1>
              {intent.message && <p className="mt-2 text-sm text-zinc-400">{intent.message}</p>}
            </div>

            <div className="mb-5 w-full rounded-2xl border border-white/10 bg-[#161619] p-4">
              <p className="mb-2 text-xs text-zinc-500">Pagar a</p>
              <p className="font-mono text-sm text-zinc-200">{shortenAddress(intent.recipient)}</p>
              <p className="mt-3 text-xs text-zinc-500">Red</p>
              <p className="text-sm font-medium text-white">Solana {intent.cluster}</p>
            </div>

            <label className="mb-4 block w-full">
              <span className="mb-2 block text-xs font-semibold text-zinc-300">Monto en USDC</span>
              <input
                className="h-14 w-full rounded-xl border border-white/10 bg-[#161619] px-4 text-right text-2xl font-semibold text-white outline-none focus:border-[#ff5a1f]"
                disabled={intent.amount !== null || isPaying || signature !== null}
                inputMode="decimal"
                onChange={(event) => {
                  setAmountInput(event.target.value);
                  setError(null);
                }}
                value={amountInput}
              />
              {intent.amount === null && (
                <span className="mt-1 block text-[11px] text-zinc-500">El comercio permite elegir el monto.</span>
              )}
            </label>

            <div className="mb-5 flex w-full justify-between rounded-xl bg-white/[0.04] px-4 py-3 text-sm">
              <span className="text-zinc-400">Tu saldo USDC</span>
              <span className="font-semibold tabular-nums">
                {isLoadingBalance ? 'Consultando…' : balance === null ? '—' : `${balance.toFixed(2)} USDC`}
              </span>
            </div>

            {isSelfPayment && (
              <p role="alert" className="mb-4 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-300">
                Esta solicitud pertenece a la misma wallet con la que iniciaste sesión.
              </p>
            )}
            {error && <p role="alert" className="mb-4 text-xs text-red-300">{error}</p>}

            <button
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#ff5a1f] font-semibold text-white transition hover:bg-[#ff713e] disabled:cursor-not-allowed disabled:opacity-50"
              disabled={
                isPaying || isLoadingBalance || balance === null || !payerWallet ||
                isSelfPayment || !isValidAmount || !Number.isFinite(amount) ||
                amount <= 0 || amount > (balance ?? 0)
              }
              onClick={handlePay}
            >
              {isPaying && <Loader2 className="h-4 w-4 animate-spin" />}
              {isPaying ? 'Firmando y enviando…' : `Pagar ${Number.isFinite(amount) ? amount.toFixed(2) : '0.00'} USDC`}
            </button>
            <p className="mt-4 text-center text-[11px] leading-5 text-zinc-500">
              La transferencia se firma con tu wallet Dynamic. También necesitas SOL de {intent.cluster} para la comisión.
            </p>
          </div>
        </>
      )}
    </div>
  );
};
