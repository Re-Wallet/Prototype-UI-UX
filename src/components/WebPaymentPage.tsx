import React, { useEffect, useMemo, useState } from 'react';
import { transferAmount } from '@dynamic-labs-sdk/client';
import { isSolanaWalletAccount } from '@dynamic-labs-sdk/solana';
import { useGetWalletAccounts } from '@dynamic-labs-sdk/react-hooks';
import { ArrowLeft, CheckCircle2, Loader2, Wallet } from 'lucide-react';
import { assetByMint, chain, type Address } from '../adapters';
import { dynamicClient } from '../dynamicClient';
import type { Transaction } from '../types/wallet';
import { parseWebPaymentUrl, type WebPaymentIntent } from '../services/webPaymentLink';
import { PhoneFrame } from './PhoneFrame';

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
      const recipientCheck = await chain.verifyRecipient(intent.recipient, asset);
      if (!recipientCheck.ok) {
        throw new Error(recipientCheck.reason ?? 'La wallet receptora no puede recibir USDC.');
      }
      const { transactionHash } = await transferAmount({
        walletAccount: payerWallet,
        amount: amount.toFixed(asset.decimals),
        recipient: intent.recipient,
        token: { address: asset.mint, decimals: asset.decimals },
      }, dynamicClient);
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
    <div className="min-h-screen bg-[#070709] flex items-center justify-center p-0 sm:p-4 font-sans antialiased">
      <div className="w-full flex justify-center py-2 sm:py-4">
        <PhoneFrame>
          <div className="flex h-full flex-col overflow-y-auto px-5 py-5 text-white">
            <button
              onClick={closePaymentPage}
              className="mb-6 flex items-center gap-2 self-start text-sm font-medium text-zinc-400 hover:text-white"
            >
              <ArrowLeft className="h-4 w-4" />
              Volver
            </button>

            {!intent || !asset ? (
              <div className="my-auto text-center">
                <h1 className="mb-2 text-xl font-bold">Solicitud no válida</h1>
                <p className="text-sm text-zinc-400">Revisa el enlace o solicita uno nuevo al comercio.</p>
              </div>
            ) : (
              <>
                <div className="mb-6 text-center">
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#ff5a1f]/15 text-[#ff5a1f]">
                    <Wallet className="h-7 w-7" />
                  </div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-[#ff5a1f]">
                    ReWallet · {intent.cluster}
                  </p>
                  <h1 className="text-2xl font-bold">Solicitud de pago</h1>
                  {intent.message && <p className="mt-2 text-sm text-zinc-400">{intent.message}</p>}
                </div>

                <div className="mb-5 rounded-2xl border border-white/10 bg-[#161619] p-4">
                  <p className="mb-2 text-xs text-zinc-500">Pagar a</p>
                  <p className="break-all font-mono text-xs text-zinc-200">{intent.recipient}</p>
                  <p className="mt-3 text-xs text-zinc-500">Red</p>
                  <p className="text-sm font-medium text-white">Solana {intent.cluster}</p>
                </div>

                <label className="mb-4 block">
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

                <div className="mb-5 flex justify-between rounded-xl bg-white/[0.04] px-4 py-3 text-sm">
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

                {signature ? (
                  <div className="mt-auto rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center">
                    <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-emerald-400" />
                    <p className="mb-2 font-semibold text-emerald-300">Transacción enviada a Solana</p>
                    <a
                      className="break-all text-xs text-emerald-200 underline"
                      href={chain.explorerTxUrl(signature)}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Ver firma en el explorador
                    </a>
                  </div>
                ) : (
                  <button
                    className="mt-auto flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#ff5a1f] font-semibold text-white transition hover:bg-[#ff713e] disabled:cursor-not-allowed disabled:opacity-50"
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
                )}
                <p className="mt-4 text-center text-[11px] leading-5 text-zinc-500">
                  La transferencia se firma con tu wallet Dynamic. También necesitas SOL de {intent.cluster} para la comisión.
                </p>
              </>
            )}
          </div>
        </PhoneFrame>
      </div>
    </div>
  );
};
