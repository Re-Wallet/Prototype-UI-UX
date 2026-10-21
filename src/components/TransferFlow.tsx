import React, { useState, useEffect, useCallback, useRef } from 'react';
import { transferAmount } from '@dynamic-labs-sdk/client';
import type { SolanaWalletAccount } from '@dynamic-labs-sdk/solana';
import {
  ArrowLeft,
  ArrowRight,
  Search,
  CheckCircle2,
  Loader2,
  Send,
  Link as LinkIcon,
  Copy,
  Check,
  Share2,
  Sparkles,
  X,
} from 'lucide-react';
import { Keypad } from './Keypad';
import { CoinIcon } from './CoinIcon';
import { LivePaymentLinksBridge } from './LivePaymentLinksBridge';
import { BackToHomeButton } from './BackToHomeButton';
import { Transaction } from '../types/wallet';
import { getDynamicClient } from '../dynamicClient';
import {
  assetBySymbol,
  chain,
  type Address,
  type TokenAsset,
} from '../adapters';
import { createWebPaymentUrl } from '../services/webPaymentLink';
import { playPaymentConfirmed, unlockAudio } from '../services/sound';
import {
  fetchPublicAppUrl,
  fetchRecentRecipients,
  peekRecentRecipients,
  registerPendingTransfer,
  registerRecipient,
  createPaymentLink,
  type PaymentLinkDto,
  type RecentRecipient,
} from '../services/walletApi';

interface TransferFlowProps {
  balance: number;
  balanceError?: string | null;
  balanceLoading?: boolean;
  solanaWallet?: SolanaWalletAccount;
  onClose: () => void;
  onTransferComplete: (transaction: Transaction) => void;
  onSubflowChange?: (inSubflow: boolean) => void;
}

export const TransferFlow: React.FC<TransferFlowProps> = ({
  balance,
  balanceError,
  balanceLoading = false,
  solanaWallet,
  onClose,
  onTransferComplete,
  onSubflowChange,
}) => {
  // Subflow mode: 'main', 'amount', 'confirm', 'success', 'link_amount', 'link_details'
  const [subflow, setSubflow] = useState<
    'main' | 'amount' | 'confirm' | 'success' | 'link_amount' | 'link_details'
  >('main');

  useEffect(() => {
    onSubflowChange?.(subflow !== 'main');
  }, [subflow, onSubflowChange]);

  // Send P2P state
  const [recipient, setRecipient] = useState<string>('');
  const [recipientName, setRecipientName] = useState<string>('');
  const [recipientSolanaAddress, setRecipientSolanaAddress] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sendAmountStr, setSendAmountStr] = useState<string>('0');
  const [note, setNote] = useState<string>('');
  const [isSending, setIsSending] = useState<boolean>(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [submittedSignature, setSubmittedSignature] = useState<string | null>(null);

  // Payment Link state
  const [linkAmountStr, setLinkAmountStr] = useState<string>('0');
  const [concept, setConcept] = useState<string>('');
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [qrGenerated, setQrGenerated] = useState<boolean>(false);
  const [paymentRequest, setPaymentRequest] = useState<{ url: string; qrDataUrl: string } | null>(null);
  const [generatingQR, setGeneratingQR] = useState<boolean>(false);
  const [qrError, setQrError] = useState<string | null>(null);

  // Live status of the single-use link this screen generated.
  //
  // `linkReference` identifies the link; `linkPaid` is the single bit the UI
  // reacts to. The value comes from Neon Realtime, so the screen flips to
  // "Pago recibido" the moment the webhook settles the link.
  const [linkReference, setLinkReference] = useState<string | null>(null);
  const [linkPaid, setLinkPaid] = useState<boolean>(false);
  /** Signature of the transaction that settled the charge, for the explorer link. */
  const [paidSignature, setPaidSignature] = useState<string | null>(null);

  /**
   * Whether the confirmation chime already played for this charge.
   *
   * The settlement arrives over Realtime and can repeat, so the sound is
   * played once per charge — not once per update.
   */
  const soundPlayedRef = useRef(false);

  const handleLiveLinks = useCallback(
    (links: PaymentLinkDto[]) => {
      if (!linkReference) return;
      const mine = links.find((link) => link.referencePubkey === linkReference);
      if (!mine) return;
      setLinkPaid(mine.status === 'paid');
      if (mine.status === 'paid' && mine.paidTxSignature) {
        setPaidSignature(mine.paidTxSignature);
      }
    },
    [linkReference]
  );

  const sendAmount = parseFloat(sendAmountStr) || 0;
  const isSendOverBalance = sendAmount > balance;

  const linkAmount = parseFloat(linkAmountStr) || 0;
  const paymentAsset = assetBySymbol('USDC', chain.network().cluster);

  const merchantWallet = solanaWallet?.address as Address | undefined;

  // Recent recipient: jumps straight to the amount keypad. Pre-validates in
  // the background so the send button gating still works on the confirm step.
  const handleSelectRecent = async (entry: RecentRecipient) => {
    setSendError(null);
    // Self-payouts are rejected everywhere: paying your own wallet only
    // burns a fee for a no-op.
    if (solanaWallet && entry.address === solanaWallet.address) {
      setSendError('No podés transferir a tu propia wallet. Elegí a otra persona.');
      return;
    }
    setRecipient(entry.email ?? entry.address);
    setRecipientName(entry.email ?? entry.name ?? entry.address);
    setRecipientSolanaAddress(entry.address);
    setRecipientValidation(null);
    // Move on immediately: the validation is a chain round-trip and the
    // tap must not look ignored while it resolves.
    setSubflow('amount');

    if (!paymentAsset) return;
    const ticket = ++validateSeqRef.current;
    try {
      const result = await chain.verifyRecipient(entry.address as Address, paymentAsset);
      // A newer selection happened meanwhile: this verdict is about another
      // recipient and must not gate the send button for this one.
      if (ticket !== validateSeqRef.current) return;
      setRecipientValidation({ ok: result.ok, reason: result.reason || undefined });
    } catch {
      if (ticket === validateSeqRef.current) setRecipientValidation(null);
    }
  };

  const handleExecuteSend = async () => {
    setSendError(null);

    if (!solanaWallet) {
      setSendError('No se encontró la wallet Solana creada para esta cuenta.');
      return;
    }
    if (balanceLoading || balanceError) {
      setSendError(balanceError ?? 'Espera a que se lea el balance de la wallet Solana.');
      return;
    }
    if (isSendOverBalance) {
      setSendError('El monto supera el balance USDC disponible en esta wallet.');
      return;
    }
    if (!recipientSolanaAddress || !paymentAsset) {
      setSendError('Selecciona una wallet Solana válida para recibir el envío.');
      return;
    }
    if (recipientSolanaAddress === solanaWallet.address) {
      setSendError('No podés transferir a tu propia wallet. Elegí a otra persona.');
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

      const recipientCheck = await chain.verifyRecipient(
        recipientSolanaAddress as Address,
        paymentAsset
      );
      if (!recipientCheck.ok) {
        throw new Error(recipientCheck.reason ?? 'La dirección no puede recibir USDC.');
      }
      setRecipientValidation({ ok: true, reason: undefined });

      const { transactionHash } = await transferAmount({
        walletAccount: solanaWallet,
        amount: sendAmount.toFixed(paymentAsset.decimals),
        recipient: recipientSolanaAddress,
        token: {
          address: paymentAsset.mint,
          decimals: paymentAsset.decimals,
        },
      }, getDynamicClient());
      setSubmittedSignature(transactionHash);
      // Persist the recipient so it shows up as "recent" next time.
      // Fails soft: the send already succeeded on-chain, so this must NOT
      // hold the success screen hostage for the API's 4s timeout.
      void registerRecipient(
        solanaWallet.address,
        recipientSolanaAddress,
        recipientName && recipientName !== recipientSolanaAddress
          ? recipientName
          : undefined
      );
      // Record the transfer as `pending` in the local DB so the sender's
      // history survives a reload before the webhook or sweep lands. The
      // webhook later upserts the same row as `completed`. Fails soft.
      const assetSymbol = paymentAsset.symbol === 'SOL' ? 'SOL' : 'USDC';
      void registerPendingTransfer({
        wallet: solanaWallet.address,
        signature: transactionHash,
        counterpartyPubkey: recipientSolanaAddress,
        amountUsdc: Number(sendAmount.toFixed(paymentAsset.decimals)),
        assetSymbol,
        note: note || undefined,
      });
      // Refresh the address book so the new recipient shows up as recent.
      void fetchRecentRecipients(solanaWallet.address).then((entries) => {
        setRecentRecipients(entries);
      });
      // The optimistic twin mirrors the server projection exactly — same
      // `referenceId` (`<signature>-<symbol>`, the DB's idempotency key) and same
      // `type` (a SOL send is a `withdrawal`, not a `sent`), so when the webhook
      // or sweep upserts the real row there is no visible flash.
      onTransferComplete({
        id: `tx-${Date.now()}`,
        title: recipientName,
        counterparty: recipientSolanaAddress,
        type: assetSymbol === 'SOL' ? 'withdrawal' : 'sent',
        status: 'in_progress',
        amount: sendAmount,
        fiatAmount: sendAmount,
        fiatCurrency: 'USD',
        timestamp: 'Just now',
        date: new Date(),
        method: `Solana ${paymentAsset.symbol}`,
        referenceId: `${transactionHash}-${assetSymbol}`,
        note: note || 'Transferencia firmada por tu wallet Solana',
        txHash: transactionHash,
        walletAddress: solanaWallet.address,
      });
      setSubflow('success');
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSending(false);
    }
  };

  const handleCopyLink = async () => {
    if (!paymentRequest) return;
    try {
      if (!navigator.clipboard) throw new Error('El navegador no permite copiar el enlace.');
      await navigator.clipboard.writeText(paymentRequest.url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (error) {
      setQrError(error instanceof Error ? error.message : String(error));
    }
  };

  const handleShareWhatsApp = () => {
    if (!paymentRequest) return;
    const text = encodeURIComponent(
      `Hola! Te comparto mi solicitud Solana Pay para ${concept}${linkAmount > 0 ? ` por ${linkAmount} USDC` : ''}: ${paymentRequest.url}`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  const handleGenerateQR = async () => {
    setGeneratingQR(true);
    setQrError(null);
    // Browsers only allow audio after a user gesture: this click is it, so
    // the confirmation chime can play later when the charge lands on its own.
    unlockAudio();
    try {
      if (!concept.trim()) {
        throw new Error('Ingresa un concepto para la solicitud.');
      }
      if (!paymentAsset) {
        throw new Error(`USDC no está configurado para ${chain.network().cluster}.`);
      }
      if (!merchantWallet) {
        throw new Error('No se encontró la wallet Solana creada para recibir el pago.');
      }
      // Create the payment link server-side first. The server returns a unique
      // on-chain reference that we embed in the URL so the payer's transaction
      // carries it — that is what makes the link single-use. Fail-soft: if the
      // API is offline we fall back to a linkless URL.
      let reference: string | undefined;
      if (solanaWallet) {
        const link = await createPaymentLink(solanaWallet.address, {
          amountUsdc: linkAmount > 0 ? linkAmount : null,
          concept,
        });
        if (link) {
          reference = link.referencePubkey;
          // Remember which link to watch so the screen can flip to
          // "Pago recibido" the moment Realtime reports it as settled.
          setLinkReference(link.referencePubkey);
          setLinkPaid(link.status === 'paid');
          setPaidSignature(link.paidTxSignature ?? null);
          soundPlayedRef.current = false;
        }
      }
      // The link must be openable by the payer, who may be on another
      // device. When the app runs on localhost the public tunnel's current
      // hostname is used instead — resolved at runtime, so a tunnel restart
      // never invalidates a link that was already shared.
      const publicOrigin = (await fetchPublicAppUrl()) || window.location.origin;
      const url = createWebPaymentUrl({
        recipient: merchantWallet,
        amount: linkAmount > 0 ? linkAmount : null,
        mint: paymentAsset.mint,
        cluster: chain.network().cluster,
        message: concept,
        reference,
      }, publicOrigin);
      const qrDataUrl = await chain.renderQrDataUrl(url);
      setPaymentRequest({ url, qrDataUrl });
      setQrGenerated(true);
    } catch (error) {
      setQrError(error instanceof Error ? error.message : String(error));
    } finally {
      setGeneratingQR(false);
    }
  };

  const [recipientValidation, setRecipientValidation] = useState<{ ok: boolean; reason?: string } | null>(null);

  /**
   * Sequence counter for the recipient validation.
   *
   * Two quick taps on different contacts start two chain round-trips. The one
   * that answers last wins, and it may be about a contact the user already
   * moved away from — which would gate the send button for the wrong person.
   */
  const validateSeqRef = useRef(0);

  // Recent recipients (address book), loaded from the local wallet API.
  const [recentRecipients, setRecentRecipients] = useState<RecentRecipient[]>([]);

  // Recent recipients: painted from the last known list on mount and
  // refreshed from the API. The guard matters when the wallet changes while
  // a refresh is in flight — the previous wallet's list must not land.
  // The collector hears the confirmation the moment the charge lands.
  useEffect(() => {
    if (!linkPaid || soundPlayedRef.current) return;
    soundPlayedRef.current = true;
    playPaymentConfirmed();
  }, [linkPaid]);

  useEffect(() => {
    let cancelled = false;
    const address = solanaWallet?.address;
    if (!address) {
      setRecentRecipients([]);
      return;
    }
    // Paint the last known list synchronously so the contacts never flash
    // empty on remount, then let the refresh land.
    const cached = peekRecentRecipients(address);
    if (cached) setRecentRecipients(cached);
    void fetchRecentRecipients(address).then((entries) => {
      if (!cancelled) setRecentRecipients(entries);
    });
    return () => {
      cancelled = true;
    };
  }, [solanaWallet?.address]);

  // 1. AMOUNT KEYPAD FOR SENDING
  if (subflow === 'amount') {
    return (
      <div className="h-full flex flex-col justify-between">
        <Keypad
          balance={balance}
          value={sendAmountStr}
          onChange={setSendAmountStr}
          actionLabel={isSendOverBalance ? 'Saldo Insuficiente' : 'Continuar a Confirmar'}
          actionDisabled={isSendOverBalance || sendAmount <= 0 || balanceLoading || Boolean(balanceError)}
          onAction={() => setSubflow('confirm')}
          onBack={() => setSubflow('main')}
          title={`Enviar a ${recipient}`}
          subtitle={
            balanceLoading
              ? 'Consultando saldo real de la wallet…'
              : balanceError ?? undefined
          }
        />
      </div>
    );
  }

  // 2. CONFIRM SEND
  if (subflow === 'confirm') {
    return (
      <div className="flex flex-col h-full justify-between text-white px-5 pt-3 pb-8 overflow-y-auto">
        <div>
          <div className="flex items-center justify-between min-h-[44px] mb-3">
            <button
              onClick={() => setSubflow('amount')}
              disabled={isSending}
              className="flex items-center gap-1.5 text-[#26e5c8] hover:text-[#56f0d9] transition-colors text-sm font-semibold py-2 rounded-lg cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Atrás</span>
            </button>
            <h1 className="text-lg font-semibold text-white tracking-tight">Enviar</h1>
            <div className="w-12" />
          </div>

          <div className="p-4 rounded-2xl bg-[#1c1c1f] border border-white/5 mb-4 text-center">
            <span className="text-xs text-zinc-400 block mb-1">Monto a Enviar</span>
            <div className="flex items-center justify-center gap-2 mb-1">
              <CoinIcon className="w-6 h-6 text-zinc-300" />
              <span className="text-4xl font-bold text-white tabular-nums">
                {sendAmount.toFixed(2)}
              </span>
            </div>
            <span className="text-xs text-zinc-400 font-medium">USDC</span>
          </div>

          <div className="p-4 rounded-2xl bg-[#1e1e21] border border-white/5 space-y-3 mb-4">
            <div className="flex items-center gap-3 pb-3 border-b border-white/5">
              <div className="w-11 h-11 rounded-full bg-[#ff5a1f] flex items-center justify-center font-bold text-white text-base">
                {recipient.replace('@', '').charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold text-white">{recipientName}</p>
                <p className="text-xs text-[#ff5a1f] font-mono">
                  {recipientSolanaAddress
                    ? `${recipientSolanaAddress.slice(0, 6)}…${recipientSolanaAddress.slice(-4)}`
                    : recipient}
                </p>
              </div>
            </div>

            <div>
              <label htmlFor="transfer-note" className="text-xs font-medium text-zinc-400 block mb-1">
                Nota o motivo (opcional)
              </label>
              <input
                id="transfer-note"
                type="text"
                value={note}
                maxLength={140}
                autoComplete="off"
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ej. Almuerzo, diseño, honorarios..."
                className="w-full h-11 px-3 rounded-xl bg-[#161618] border border-white/10 text-white text-xs focus:border-[#ff5a1f]"
              />
            </div>

            <div className="pt-2 text-xs text-zinc-400 space-y-1">
              <div className="flex justify-between">
                <span>Comisión de red</span>
                <span className="text-zinc-300 font-medium">≈ 0.000005 SOL</span>
              </div>
              <div className="flex justify-between">
                <span>Liquidación</span>
                <span className="text-zinc-300 font-medium">{sendAmount.toFixed(2)} USDC</span>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-4 pb-2">
          {sendError && (
            <p role="alert" className="text-xs text-red-400 text-center mb-3">
              {sendError}
            </p>
          )}
          <button
            onClick={handleExecuteSend}
            disabled={isSending || isSendOverBalance || balanceLoading || Boolean(balanceError) || !solanaWallet || !recipientSolanaAddress || recipientValidation?.ok === false}
            className="w-full h-13 rounded-2xl bg-[#ff5a1f] hover:bg-[#ff6c35] disabled:bg-zinc-800 disabled:text-zinc-400 active:scale-[0.98] text-white font-semibold text-base flex items-center justify-center gap-2 shadow-lg shadow-[#ff5a1f]/20 cursor-pointer disabled:cursor-not-allowed transition-all"
          >
            {isSending ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Firmando y enviando...</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                <span>Enviar</span>
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // 3. SUCCESS SCREEN
  if (subflow === 'success') {
    return (
      <div className="flex flex-col h-full justify-between items-center text-center text-white px-5 pt-12 pb-8">
        <div className="flex flex-col items-center">
          <div className="w-16 h-16 rounded-full bg-[#10b981]/20 border-2 border-[#10b981] flex items-center justify-center text-[#10b981] mb-5">
            <CheckCircle2 className="w-9 h-9" />
          </div>

          <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">
            Envío aprobado
          </h2>
          <p className="text-sm text-zinc-400 mb-6">
            La transacción fue firmada con tu wallet Solana creada por Anonymus. Espera la confirmación de la red.
          </p>

          <div className="w-full max-w-xs p-4 rounded-2xl bg-[#1e1e21] border border-white/5 mb-4 text-left space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Monto Enviado</span>
              <span className="text-white font-bold tabular-nums">Ⓢ {sendAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Destinatario</span>
              <span className="text-white">{recipientName || recipient}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Nota</span>
              <span className="text-zinc-300">{note}</span>
            </div>
            {submittedSignature ? (
              <div className="flex justify-between items-center text-xs pt-1 border-t border-white/5">
                <span className="text-zinc-400">Estado</span>
                <a
                  href={chain.explorerTxUrl(submittedSignature)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#26e5c8] font-bold underline"
                >
                  Ver estado de la transacción
                </a>
              </div>
            ) : (
              <div className="flex justify-between text-xs pt-1 border-t border-white/5">
                <span className="text-zinc-400">Estado</span>
                <span className="text-[#26e5c8] font-bold">Firmado · enviado a Solana</span>
              </div>
            )}
          </div>
        </div>

        <div className="w-full pb-2">
          <button
            onClick={onClose}
            className="w-full h-13 rounded-2xl bg-white hover:bg-zinc-200 text-black font-semibold text-base transition-all cursor-pointer"
          >
            Terminar
          </button>
        </div>
      </div>
    );
  }

  // 4. PAYMENT LINK SUBFLOW: KEYPAD
  if (subflow === 'link_amount') {
    return (
      <div className="h-full flex flex-col justify-between">
        <Keypad
          balance={balance}
          value={linkAmountStr}
          onChange={setLinkAmountStr}
          actionLabel="Continuar a Detalles"
          showBalance={false}
          showPresets={false}
          actionDisabled={linkAmount <= 0}
          onAction={() => {
            setQrGenerated(false);
            setCopiedLink(false);
            setPaymentRequest(null);
            setQrError(null);
            setSubflow('link_details');
          }}
          onBack={() => setSubflow('main')}
          title="Cobrar por QR"
        />
      </div>
    );
  }

  // 5. PAYMENT LINK SUBFLOW: DETAILS - Inputs + Generar button → QR appears below in SAME screen
  if (subflow === 'link_details') {
    return (
      <div className="flex flex-col h-full text-white px-5 pt-3 pb-8 overflow-y-auto">
        {/* Live subscription for the generated link. Mounted only while a
            link exists, so the screen learns the moment it is settled. */}
        {solanaWallet && linkReference && (
          <LivePaymentLinksBridge
            walletAddress={solanaWallet.address}
            onLinks={handleLiveLinks}
          />
        )}
        <div className="flex-1">
          <div className="flex items-center justify-between min-h-[44px] mb-2">
            {qrGenerated && paymentRequest ? (
              <>
                <div className="w-12" />
                <h1
                  aria-live="polite"
                  aria-atomic="true"
                  className="text-lg font-semibold text-white tracking-tight"
                >
                  {linkPaid ? 'Pago recibido' : 'Cobrar por QR'}
                </h1>
                {linkPaid ? (
                  /* The confirmation has its own "Volver al inicio" at the
                     end of the screen; a second exit here would duplicate it. */
                  <div className="w-8 h-8" />
                ) : (
                  <button
                    onClick={onClose}
                    className="flex items-center justify-center w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
                    aria-label="Cerrar QR generado"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  onClick={() => {
                    setQrGenerated(false);
                    setCopiedLink(false);
                    setPaymentRequest(null);
                    setQrError(null);
                    setLinkReference(null);
                    setLinkPaid(false);
                    setSubflow('link_amount');
                  }}
                  className="flex items-center gap-1.5 text-[#26e5c8] hover:text-[#56f0d9] transition-colors text-sm font-semibold py-2 rounded-lg cursor-pointer"
                >
                  <ArrowLeft className="w-5 h-5" />
                  <span>Atrás</span>
                </button>
                <h1 className="text-lg font-semibold text-white tracking-tight">Cobrar por QR</h1>
                <div className="w-12" />
              </>
            )}
          </div>

          {!linkPaid && (
            <div className="p-4 rounded-2xl bg-[#1c1c1f] border border-white/5 mb-5 text-center">
              <span className="text-xs text-zinc-400 block mb-1">Monto a Cobrar</span>
              <div className="flex items-center justify-center gap-2">
                <CoinIcon className="w-6 h-6 text-zinc-300" />
                <span className="text-3xl font-bold text-white tabular-nums">
                  {linkAmount.toFixed(2)}
                </span>
              </div>
            </div>
          )}

          <div className="space-y-4">
            {!linkPaid && (
              <div>
                <label htmlFor="transfer-concept" className="text-xs font-medium text-zinc-400 block mb-1.5">
                  Concepto o descripción
                </label>
                <input
                  id="transfer-concept"
                  type="text"
                  value={concept}
                  maxLength={120}
                  autoComplete="off"
                  onChange={(e) => {
                    setConcept(e.target.value);
                    setQrGenerated(false);
                    setPaymentRequest(null);
                    setLinkReference(null);
                    setLinkPaid(false);
                  }}
                  placeholder="Ej. Honorarios diseño, consultoría, cuota..."
                  className="w-full h-12 px-3.5 rounded-xl bg-[#1e1e21] border border-white/10 text-white text-sm focus:border-[#ff5a1f]"
                />
              </div>
            )}

            {qrError && (
              <p role="alert" className="text-xs text-red-400 text-center">{qrError}</p>
            )}

            {!qrGenerated && !linkPaid && (
              <div className="pt-2">
                <button
                  onClick={handleGenerateQR}
                  disabled={generatingQR}
                  className="w-full h-13 rounded-2xl bg-[#ff5a1f] hover:bg-[#ff6c35] active:scale-[0.98] text-white font-semibold text-base flex items-center justify-center gap-2 shadow-lg shadow-[#ff5a1f]/20 cursor-pointer transition-all"
                >
                  {generatingQR ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  <span>{generatingQR ? 'Generando solicitud...' : 'Confirmar'}</span>
                </button>
              </div>
            )}

            {/* Payment settled: the QR is replaced by the confirmation. It
                follows the payment request screen — logo, then the outcome —
                so both sides of the same payment read as one flow. */}
            {linkPaid && (
              <div
                role="status"
                aria-live="polite"
                className="animate-in slide-in-from-top-2 duration-300"
              >
                <div className="mb-6 text-center">
                  <img
                    alt="ReWallet"
                    className="mx-auto mb-4 h-12 w-auto select-none"
                    src="/rewallet-lockup.png"
                  />
                </div>

                {/* Same shape as the payer's confirmation: the outcome is the
                    hero, in the brand's green, with the explorer link. */}
                <div className="w-full rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center">
                  <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-emerald-400" />
                  <p className="mb-3 text-lg font-semibold text-emerald-300">
                    Tu cobro se acreditó en tu cuenta con éxito.
                  </p>
                  <div className="flex items-center justify-center gap-2 mb-1">
                    <CoinIcon className="w-5 h-5 text-zinc-300" />
                    <span className="text-3xl font-bold text-white tabular-nums">
                      {linkAmount > 0 ? `${linkAmount.toFixed(2)} USDC` : 'Monto libre · USDC'}
                    </span>
                  </div>
                  {concept && (
                    <p className="mb-3 text-xs text-zinc-400 truncate max-w-full mx-auto">
                      {concept}
                    </p>
                  )}
                  {paidSignature && (
                    <a
                      className="inline-block break-all text-sm text-emerald-200 underline hover:text-emerald-100 transition-colors"
                      href={chain.explorerTxUrl(paidSignature)}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Ver firma en el explorador
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* QR Generated Section - Appears below inputs in SAME screen */}
            {!linkPaid && qrGenerated && paymentRequest && (
              <div className="space-y-4 animate-in slide-in-from-top-2 duration-300">
                <div className="p-4 rounded-3xl bg-white text-black max-w-[240px] mx-auto my-2 shadow-xl flex flex-col items-center">
                  <div className="w-full flex items-center justify-between pb-2 border-b border-zinc-200 text-xs">
                    <span className="font-bold tracking-tight text-zinc-900">ReWallet · Solana</span>
                    <span className="font-semibold text-[#ff5a1f]">
                      {linkAmount > 0 ? `${linkAmount.toFixed(2)} USDC` : 'Monto libre · USDC'}
                    </span>
                  </div>

                  <div className="w-56 h-56 bg-white p-2 my-2 flex items-center justify-center">
                    <img
                      src={paymentRequest.qrDataUrl}
                      alt="QR de la página web para pagar esta solicitud"
                      className="block w-full h-full object-contain"
                    />
                  </div>

                  <p className="text-xs font-medium text-zinc-400 truncate max-w-full">
                    {concept}
                  </p>
                  {qrError && (
                    <p className="text-xs text-red-500 text-center mt-2">{qrError}</p>
                  )}
                </div>

                <div className="p-3 rounded-xl bg-[#1e1e21] border border-white/5">
                  <p className="text-[10px] text-zinc-400 uppercase tracking-wider font-semibold mb-1">
                    Link web de pago · {chain.describeNetwork()}
                  </p>
                  <a
                    href={paymentRequest.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block break-all text-xs text-[#26e5c8] underline"
                  >
                    {paymentRequest.url}
                  </a>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={handleCopyLink}
                    className="py-2.5 px-3 rounded-xl bg-[#222225] hover:bg-[#2b2b2f] text-white text-xs font-medium flex items-center justify-center gap-1.5 transition-colors border border-white/5 cursor-pointer"
                  >
                    {copiedLink ? <Check className="w-3.5 h-3.5 text-[#26e5c8]" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedLink ? '¡Copiado!' : 'Copiar Link'}</span>
                  </button>
                  <button
                    onClick={handleShareWhatsApp}
                    className="py-2.5 px-3 rounded-xl bg-[#25D366]/20 hover:bg-[#25D366]/30 text-[#25D366] text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors border border-[#25D366]/30 cursor-pointer"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>WhatsApp</span>
                  </button>
                </div>

                <div className="mt-2 p-3 rounded-xl bg-[#26e5c8]/10 border border-[#26e5c8]/30">
                    <p className="text-xs text-zinc-300 mb-2 text-center">
                      Comparte el enlace o escanea el QR para abrir esta página desde la cuenta pagadora. Allí podrá revisar la solicitud y firmar el pago con su wallet Solana.
                    </p>
                </div>

              </div>
            )}
          </div>
        </div>

        {/* The exit sits at the END of the screen, the same place the
            payment request screen puts it. */}
        {linkPaid && (
          <div className="mt-4 shrink-0">
            <BackToHomeButton onClick={onClose} />
          </div>
        )}
      </div>
    );
  }

  // 6. MAIN VIEW
  // Live filter for the contacts list (email, name, handle, or address).
  // Your own wallet is never offered: recommending yourself always dead-ends
  // on the self-payout guard in handleSelectRecent/handleExecuteSend.
  const searchLower = searchQuery.trim().toLowerCase();
  const filteredRecipients = recentRecipients
    .filter((entry) => !solanaWallet || entry.address !== solanaWallet.address)
    .filter((entry) =>
      searchLower
        ? [entry.email, entry.name, entry.handle, entry.address]
            .filter((field): field is string => Boolean(field))
            .some((field) => field.toLowerCase().includes(searchLower))
        : true
    );

  return (
    <div className="flex flex-col h-full justify-between text-white px-5 pt-3 pb-32 overflow-y-auto select-none">
      <div>
        <div className="flex items-center justify-between min-h-[44px] mb-3">
          <button
            onClick={onClose}
            className="flex items-center gap-1 text-[#26e5c8] hover:text-[#56f0d9] transition-colors text-base font-semibold py-2 rounded-lg cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5 stroke-[2.5]" />
            <span>Atrás</span>
          </button>
          <h1 className="text-lg font-semibold text-white tracking-tight">Enviar</h1>
          <div className="w-12" />
        </div>

        <div className="mb-4">
          <label htmlFor="transfer-contact-search" className="text-sm font-semibold text-zinc-300 block mb-2">
            Busca tu contacto
          </label>
          <div className="w-full h-12 rounded-2xl bg-white flex items-center px-4 shadow-sm">
            <Search className="w-5 h-5 text-zinc-400 mr-2.5 shrink-0" />
            <input
              id="transfer-contact-search"
              type="search"
              inputMode="search"
              autoComplete="off"
              placeholder="Buscar contacto por correo o nombre"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSendError(null);
              }}
              className="w-full bg-transparent text-black text-sm placeholder:text-zinc-400 font-normal "
            />
          </div>
          {sendError && (
            <p role="alert" className="mt-2 text-xs text-red-400">{sendError}</p>
          )}
        </div>

        {filteredRecipients.length > 0 && (
          <div className="mt-5">
            <p className="text-base font-semibold text-white tracking-tight mb-1">
              Billeteras recientes
            </p>
            <div className="divide-y divide-white/[0.04]">
              {filteredRecipients.map((entry) => (
                <button
                  key={entry.id}
                  onClick={() => handleSelectRecent(entry)}
                  className="w-full flex items-center justify-between py-3.5 px-1 hover:bg-white/[0.02] active:bg-white/[0.05] rounded-xl transition-colors text-left group"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="shrink-0">
                      <div className="w-10 h-10 rounded-full bg-[#222225] flex items-center justify-center text-white/90 group-hover:text-white transition-colors">
                        <span className="text-base font-semibold">
                          {(entry.email ?? entry.name).charAt(0).toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <div className="min-w-0 pr-2">
                      <p className="text-sm font-medium text-white truncate leading-snug">
                        {entry.email ?? entry.name}
                      </p>
                      <p className="text-xs font-normal font-mono leading-snug truncate text-zinc-400">
                        {entry.address}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mb-3 mt-4">
          <button
            onClick={() => {
              setLinkAmountStr('0');
              setConcept('');
              setQrGenerated(false);
              setPaymentRequest(null);
              setQrError(null);
              setSubflow('link_amount');
            }}
            className="w-full p-4 rounded-2xl bg-[#1e1e21] hover:bg-[#252529] active:bg-[#2b2b30] flex items-center justify-between transition-all border border-white/[0.04] text-left group cursor-pointer"
          >
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-[#34241e] border border-[#ff5a1f]/30 flex items-center justify-center text-[#ff5a1f]">
                <LinkIcon className="w-5 h-5 stroke-[2.2]" />
              </div>
              <h3 className="text-base font-semibold text-white leading-snug">
                Cobrar por QR
              </h3>
            </div>
            <ArrowRight className="w-5 h-5 text-[#26e5c8] group-hover:translate-x-1 transition-transform" />
          </button>
        </div>
      </div>
    </div>
  );
};