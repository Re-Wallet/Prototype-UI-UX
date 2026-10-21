import React, { useEffect, useMemo, useState } from 'react';
import { transferAmount } from '@dynamic-labs-sdk/client';
import { isSolanaWalletAccount } from '@dynamic-labs-sdk/solana';
import { useGetWalletAccounts, useInitStatus, useUser } from '@dynamic-labs-sdk/react-hooks';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { assetByMint, chain, type Address } from '../adapters';
import { getDynamicClient } from '../dynamicClient';
import { playPaymentConfirmed, unlockAudio } from '../services/sound';
import { BackToHomeButton } from './BackToHomeButton';
import { SignInScreen } from './DynamicSignIn';
import { useEnsureSolanaWallet } from '../services/dynamicWallet';
import type { Transaction } from '../types/wallet';
import { parseWebPaymentUrl, type WebPaymentIntent } from '../services/webPaymentLink';
import {
  claimPaymentLink,
  fetchWalletIdentity,
  fetchPaymentLinkByReference,
  resolveAppHomeUrl,
  type WalletIdentity,
} from '../services/walletApi';

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

/**
 * The payment went through.
 *
 * Same composition as the request screen: the lockup and the headline
 * centered, the card full width below. The amount is the one that was
 * paid, because "it worked" without a number is not a receipt.
 */
export function PaymentDone({
  amount,
  symbol,
  signature,
}: {
  amount: number;
  symbol: string;
  signature: string;
}) {
  return (
    <div className="flex w-full flex-1 flex-col items-center justify-center">
      <div className="mb-6 text-center">
        <img
          alt="ReWallet"
          className="mx-auto mb-4 h-12 w-auto select-none"
          src="/rewallet-lockup.png"
        />
        <h1 className="text-2xl font-bold leading-tight">Tu pago fue realizado con éxito</h1>
        {amount > 0 && (
          <p className="mt-2 text-3xl font-bold tabular-nums text-white">
            {amount.toFixed(2)} <span className="text-lg text-zinc-400">{symbol}</span>
          </p>
        )}
      </div>

      <div className="w-full rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center">
        <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-emerald-400" />
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
  );
}

export const WebPaymentPage: React.FC<WebPaymentPageProps> = ({ onPaymentSubmitted }) => {
  const intent = useMemo(getIntent, []);
  const { data: initStatus } = useInitStatus();
  // The session decides what the page shows: an open session goes straight
  // to the balance and the payment, and only a closed one gets the
  // onboarding. Deciding by the wallet instead would drop the sign-in form
  // on a user who IS signed in but whose wallet is still being created.
  const { data: sessionUser } = useUser();
  const { data: walletAccounts = [] } = useGetWalletAccounts();
  const payerWallet = walletAccounts.find(isSolanaWalletAccount);
  // A payer who signs in from the link needs a wallet to pay from, exactly
  // like a user who signs in from the home screen.
  const { walletError, isCreating: isCreatingWallet } = useEnsureSolanaWallet();
  const [balance, setBalance] = useState<number | null>(null);
  const [amountInput, setAmountInput] = useState(intent?.amount?.toString() ?? '');
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [recipientIdentity, setRecipientIdentity] = useState<WalletIdentity | null>(null);
  const [linkStatus, setLinkStatus] = useState<'unknown' | 'active' | 'paid' | 'partial' | 'expired' | 'cancelled'>('unknown');
  /**
   * Whether the link status is known yet.
   *
   * Until the check resolves, the pay form must not be usable: a payer who
   * opens an already-settled link would otherwise see a live-looking form.
   */
  const [linkStatusResolved, setLinkStatusResolved] = useState<boolean>(false);

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

  // Registered email of the collector, so "Pagar a" shows a human identity.
  // Fails soft: the UI keeps the shortened address when the API is offline.
  useEffect(() => {
    let cancelled = false;
    if (!intent?.recipient) {
      setRecipientIdentity(null);
      return;
    }
    void fetchWalletIdentity(intent.recipient).then((identity) => {
      if (!cancelled) setRecipientIdentity(identity);
    });
    return () => {
      cancelled = true;
    };
  }, [intent?.recipient]);

  // Single-use guard: when the URL carries a reference, check the link status
  // before allowing payment. If the link is already paid, expired or cancelled,
  // block the form. Fails soft: without a reference the page behaves as before.
  useEffect(() => {
    let cancelled = false;
    if (!intent?.reference) {
      // Not a single-use link: there is no status to wait for.
      setLinkStatusResolved(true);
      return;
    }
    setLinkStatusResolved(false);
    void fetchPaymentLinkByReference(intent.reference)
      .then((link) => {
        if (cancelled) return;
        setLinkStatus(link?.status ?? 'unknown');
      })
      .finally(() => {
        if (!cancelled) setLinkStatusResolved(true);
      });
    return () => {
      cancelled = true;
    };
  }, [intent?.reference]);

  /** The link is settled: it must not be paid again. */
  const linkSettled =
    linkStatus === 'paid' || linkStatus === 'expired' || linkStatus === 'cancelled';

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
    // Single-use guard: the button is disabled for settled links, but the
    // status can flip to `paid` between render and click (the webhook may
    // land mid-session). Re-check before signing so a link is never paid twice.
    if (linkSettled) {
      setError('Este cargo ya no está disponible.');
      return;
    }
    if (!isValidAmount || !Number.isFinite(amount) || amount <= 0 || amount > (balance ?? 0)) {
      setError('Ingresa un monto válido que no supere tu saldo USDC disponible.');
      return;
    }

    setIsPaying(true);
    setError(null);
    // Browsers only allow audio after a user gesture: this click is it.
    unlockAudio();
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
      // The payer hears the confirmation as soon as the transfer is signed.
      playPaymentConfirmed();

      // Declare which link this payment settles. The reference is not on
      // chain, so the server would otherwise have to guess between
      // same-amount links and could settle the wrong one — leaving this one
      // payable a second time. Fail-soft: the webhook is the fallback.
      if (intent.reference) {
        void claimPaymentLink(intent.reference, transactionHash);
      }
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

  /**
   * "Inicio" returns to the app, not to the current origin.
   *
   * During development the payment link points at the tunnel (so a payer on
   * another device can open it) while the app home is the origin where the
   * user's session lives. Both are the same place in production.
   */
  const closePaymentPage = () => window.location.assign(resolveAppHomeUrl());

  return (
    <div className="relative flex h-full flex-col px-6 py-6 text-white">
      {!intent || !asset ? (
        <div className="flex w-full flex-1 flex-col items-center justify-center text-center">
          <h1 className="mb-2 text-xl font-bold">Solicitud no válida</h1>
          <p className="text-sm text-zinc-400">Revisa el enlace o solicita uno nuevo al comercio.</p>
        </div>
      ) : signature ? (
        <>
          <PaymentDone
            amount={amount}
            symbol={asset?.symbol ?? 'USDC'}
            signature={signature}
          />

          <BackToHomeButton onClick={closePaymentPage} />
        </>
      ) : linkSettled ? (
        <>
          <div className="flex w-full flex-1 flex-col items-center justify-center">
            <div className="mb-6 text-center">
              <img
                alt="ReWallet"
                className="mx-auto mb-4 h-12 w-auto select-none"
                src="/rewallet-lockup.png"
              />
              <h1 className="text-2xl font-bold">
                {linkStatus === 'paid' ? 'Cargo ya pagado' : linkStatus === 'expired' ? 'Cargo expirado' : 'Cargo cancelado'}
              </h1>
            </div>

            <div className="w-full rounded-2xl border border-white/10 bg-[#161619] p-6 text-center">
              <p className="text-sm text-zinc-400">
                {linkStatus === 'paid'
                  ? 'Este cargo ya fue pagado. Si creés que es un error, contactá al comercio.'
                  : linkStatus === 'expired'
                    ? 'Este cargo ya no es válido. Pedí uno nuevo al comercio.'
                    : 'Este cargo fue cancelado por el comercio.'}
              </p>
            </div>
          </div>

          <BackToHomeButton onClick={closePaymentPage} />
        </>
      ) : (
        <>
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
              <p className="mb-2 text-xs text-zinc-400">Pagar a</p>
              <p className="font-mono text-sm text-zinc-200">
                {recipientIdentity?.handle ?? shortenAddress(intent.recipient)}
              </p>
              <p className="mt-3 text-xs text-zinc-400">Cadena/Moneda</p>
              <p className="text-sm font-medium text-white">Solana/{asset?.symbol ?? 'USDC'}</p>
            </div>

            {intent.amount !== null ? (
              /* Fixed amount: a centered, highlighted figure instead of an input. */
              <div className="mb-4 block w-full">
                <span className="mb-2 block text-xs font-semibold text-zinc-300 text-center">Monto a pagar</span>
                <div className="flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-[#161619] py-4">
                  <span className="text-sm font-semibold text-zinc-400">USD</span>
                  <span className="text-4xl font-bold text-white tabular-nums">
                    {intent.amount.toFixed(2)}
                  </span>
                </div>
              </div>
      ) : (
              <label className="mb-4 block w-full">
                <span className="mb-2 block text-xs font-semibold text-zinc-300">Monto en USDC</span>
                <input
                  className="h-14 w-full rounded-xl border border-white/10 bg-[#161619] px-4 text-right text-2xl font-semibold text-white  focus:border-[#ff5a1f]"
                  disabled={isPaying || signature !== null}
                  inputMode="decimal"
                  onChange={(event) => {
                    setAmountInput(event.target.value);
                    setError(null);
                  }}
                  value={amountInput}
                />
                <span className="mt-1 block text-xs text-zinc-400">El comercio permite elegir el monto.</span>
              </label>
            )}

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

            {sessionUser ? (
              /* There is a session: this is the same flow as before — check the
                 balance and pay. If the wallet is still being prepared, the
                 page waits for it instead of asking to sign in again. */
              <>
                {!payerWallet ? (
                  <p className="flex items-center justify-center gap-2 py-6 text-sm text-zinc-400">
                    {isCreatingWallet || initStatus !== 'finished' ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Preparando tu wallet Solana…
                      </>
                    ) : (
                      'No encontramos una wallet Solana para esta cuenta.'
                    )}
                  </p>
                ) : (
                  <>
                    <button
                      className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#ff5a1f] font-semibold text-white transition hover:bg-[#ff713e] disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={
                        isPaying || isLoadingBalance || balance === null ||
                        isSelfPayment || !isValidAmount || !Number.isFinite(amount) ||
                        amount <= 0 || amount > (balance ?? 0) ||
                        !linkStatusResolved || linkSettled
                      }
                      onClick={handlePay}
                    >
                      {isPaying && <Loader2 className="h-4 w-4 animate-spin" />}
                      {isPaying ? 'Firmando y enviando…' : `Pagar ${Number.isFinite(amount) ? amount.toFixed(2) : '0.00'} USDC`}
                    </button>
                    <p className="mt-4 text-center text-xs leading-5 text-zinc-400">
                      La transferencia se firma con tu wallet Anonymus. También necesitas SOL de {intent.cluster} para la comisión.
                    </p>
                  </>
                )}
              </>
            ) : (
              /* No session: the request stays whole behind the overlay, and
                 the overlay is what asks the payer to sign in. */
              <>
                <button
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#ff5a1f] font-semibold text-white opacity-40"
                  disabled
                >
                  Pagar {Number.isFinite(amount) ? amount.toFixed(2) : '0.00'} USDC
                </button>
                <p className="mt-4 text-center text-xs leading-5 text-zinc-400">
                  Iniciá sesión para pagar esta solicitud.
                </p>
              </>
            )}

            {walletError && (
              <p role="alert" className="mt-2 text-xs text-red-300">
                No pudimos crear tu wallet: {walletError}
              </p>
            )}
          </div>

          {/* No exit here: this is the request, and the payer is not done
              yet. The way out appears once the payment is sent, the same
              place the "Pago recibido" screen puts it. */}
        </>
      )}

      {/* The sign-in sits ON TOP of the request, not under it.

          The request is the reason the user opened the link, so it stays
          readable behind the overlay — and the overlay has no way out: the
          payer cannot pay without a wallet, and a wallet needs an account. */}
      {!sessionUser && intent && asset && !signature && !linkSettled && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#070709]/75 px-5 backdrop-blur-[2px] animate-in fade-in">
          <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-[#161619]/95 p-5 shadow-2xl">
            {initStatus !== 'finished' ? (
              <p className="flex items-center justify-center gap-2 py-6 text-sm text-zinc-400">
                <Loader2 className="h-5 w-5 animate-spin" />
                Conectando…
              </p>
            ) : (
              <SignInScreen
                compact
                title="Necesitas una billetera para pagar"
                subtitle="Ingresa con tu mail y creamos una billetera en segundos"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};
