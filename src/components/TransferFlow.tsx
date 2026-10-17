import React, { useState, useEffect } from 'react';
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
  AlertCircle,
} from 'lucide-react';
import { Keypad } from './Keypad';
import { CoinIcon } from './CoinIcon';
import { Transaction } from '../types/wallet';
import { dynamicClient } from '../dynamicClient';
import {
  assetBySymbol,
  chain,
  type Address,
  type TokenAsset,
} from '../adapters';
import { createWebPaymentUrl } from '../services/webPaymentLink';

interface TransferFlowProps {
  balance: number;
  balanceError?: string | null;
  balanceLoading?: boolean;
  solanaWallet?: SolanaWalletAccount;
  onClose: () => void;
  onTransferComplete: (transaction: Transaction) => void;
  initialMode?: 'send' | 'payment_link';
  initialRecipient?: string;
  onSubflowChange?: (inSubflow: boolean) => void;
}

export const TransferFlow: React.FC<TransferFlowProps> = ({
  balance,
  balanceError,
  balanceLoading = false,
  solanaWallet,
  onClose,
  onTransferComplete,
  initialMode = 'send',
  initialRecipient,
  onSubflowChange,
}) => {
  // Subflow mode: 'main', 'amount', 'confirm', 'success', 'link_amount', 'link_details'
  const [subflow, setSubflow] = useState<
    'main' | 'amount' | 'confirm' | 'success' | 'link_amount' | 'link_details'
  >(
    initialMode === 'payment_link'
      ? 'link_amount'
      : initialRecipient
      ? 'amount'
      : 'main'
  );

  useEffect(() => {
    onSubflowChange?.(subflow !== 'main');
  }, [subflow, onSubflowChange]);

  // Send P2P state
  const [recipient, setRecipient] = useState<string>(initialRecipient || '');
  const [recipientName, setRecipientName] = useState<string>(initialRecipient || '');
  const [recipientSolanaAddress, setRecipientSolanaAddress] = useState<string | null>(
    initialRecipient && chain.isBase58(initialRecipient) ? initialRecipient : null
  );
  const [searchQuery, setSearchQuery] = useState<string>(initialRecipient || '');
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

  const sendAmount = parseFloat(sendAmountStr) || 0;
  const isSendOverBalance = sendAmount > balance;

  const linkAmount = parseFloat(linkAmountStr) || 0;
  const paymentAsset = assetBySymbol('USDC', chain.network().cluster);

  const merchantWallet = solanaWallet?.address as Address | undefined;

  const handleCustomRecipient = async () => {
    if (!searchQuery.trim()) return;
    setSendError(null);

    const address = searchQuery.trim();
    if (!chain.isBase58(address)) {
      setSendError('Ingresa una dirección pública Solana válida para enviar USDC.');
      return;
    }

    if (!paymentAsset) {
      setSendError(`USDC no está configurado para ${chain.network().cluster}.`);
      return;
    }

    try {
      const result = await chain.verifyRecipient(address as Address, paymentAsset);
      setRecipientValidation({ ok: result.ok, reason: result.reason || undefined });
      if (!result.ok) {
        setSendError(result.reason ?? 'La dirección no puede recibir USDC.');
        return;
      }
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error));
      return;
    }

    setRecipient(address);
    setRecipientName(address);
    setRecipientSolanaAddress(address);
    setSubflow('amount');
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
      }, dynamicClient);
      setSubmittedSignature(transactionHash);
      onTransferComplete({
        id: `tx-${Date.now()}`,
        title: recipientName,
        counterparty: recipientSolanaAddress,
        type: 'sent',
        status: 'in_progress',
        amount: sendAmount,
        fiatAmount: sendAmount,
        fiatCurrency: 'USD',
        timestamp: 'Just now',
        date: new Date(),
        method: `Solana ${paymentAsset.symbol}`,
        referenceId: transactionHash,
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
      const url = createWebPaymentUrl({
        recipient: merchantWallet,
        amount: linkAmount > 0 ? linkAmount : null,
        mint: paymentAsset.mint,
        cluster: chain.network().cluster,
        message: concept,
      }, import.meta.env.VITE_PUBLIC_APP_URL?.trim() || window.location.origin);
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
              <span>Atras</span>
            </button>
            <h1 className="text-[17px] font-semibold text-white tracking-tight">Send</h1>
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
            <span className="text-xs text-zinc-500 font-medium">USDC</span>
          </div>

          <div className="p-4 rounded-2xl bg-[#1e1e21] border border-white/5 space-y-3 mb-4">
            <div className="flex items-center gap-3 pb-3 border-b border-white/5">
              <div className="w-11 h-11 rounded-full bg-[#ff5a1f] flex items-center justify-center font-bold text-white text-base">
                {recipient.replace('@', '').charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-semibold text-white">{recipientName}</p>
                <p className="text-xs text-[#ff5a1f] font-mono">{recipient}</p>
              </div>
            </div>

            {recipientValidation && (
              <div className={`p-3 rounded-xl text-xs ${
                recipientValidation.ok 
                  ? 'bg-[#10b981]/20 border border-[#10b981]/30 text-[#26e5c8]' 
                  : 'bg-red-900/20 border border-red-900/30 text-red-400'
              }`}>
                <div className="flex items-center gap-1.5">
                  {recipientValidation.ok ? (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {recipientValidation.ok 
                      ? 'Destinatario válido para USDC' 
                      : `Advertencia: ${recipientValidation.reason || 'Dirección no válida'}`}
                  </span>
                </div>
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-zinc-400 block mb-1">
                Nota o motivo (opcional)
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Ej. Almuerzo, diseño, honorarios..."
                className="w-full h-11 px-3 rounded-xl bg-[#161618] border border-white/10 text-white text-xs focus:outline-none focus:border-[#ff5a1f]"
              />
            </div>

            <div className="pt-2 text-xs text-zinc-400 space-y-1">
              <div className="flex justify-between">
                <span>Comisión de red</span>
                <span className="text-zinc-300 font-medium">Se paga en SOL</span>
              </div>
              <div className="flex justify-between">
                <span>Liquidación</span>
                <span className="text-zinc-300 font-medium">Solana</span>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-4 pb-2">
          <p className="text-xs text-amber-300 text-center mb-3">
            Tu wallet Solana {solanaWallet?.address.slice(0, 6)}…{solanaWallet?.address.slice(-4)} firmará este envío. Asegúrate de tener saldo USDC y SOL para la comisión.
          </p>
          {sendError && (
            <p role="alert" className="text-xs text-red-400 text-center mb-3">
              {sendError}
            </p>
          )}
          <button
            onClick={handleExecuteSend}
            disabled={isSending || isSendOverBalance || balanceLoading || Boolean(balanceError) || !solanaWallet || !recipientSolanaAddress || recipientValidation?.ok === false}
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
                <span>
                {`Firmar y enviar · ${sendAmount.toFixed(2)} USDC`}
                </span>
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
            Envío enviado a Solana
          </h2>
          <p className="text-sm text-zinc-400 mb-6">
            La transacción fue firmada con tu wallet Solana creada por Dynamic. Espera la confirmación de la red.
          </p>

          <div className="w-full max-w-xs p-4 rounded-2xl bg-[#1e1e21] border border-white/5 mb-4 text-left space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Monto Enviado</span>
              <span className="text-white font-bold tabular-nums">Ⓢ {sendAmount.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Destinatario</span>
              <span className="text-white">{recipient}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-zinc-400">Nota</span>
              <span className="text-zinc-300">{note}</span>
            </div>
            <div className="flex justify-between text-xs pt-1 border-t border-white/5">
              <span className="text-zinc-400">Estado</span>
              <span className="text-[#26e5c8] font-bold">Firmado · enviado a Solana</span>
            </div>
            {submittedSignature && (
              <a
                href={chain.explorerTxUrl(submittedSignature)}
                target="_blank"
                rel="noreferrer"
                className="block break-all pt-1 text-xs text-[#26e5c8] underline"
              >
                Ver firma de transacción
              </a>
            )}
          </div>
        </div>

        <div className="w-full pb-2">
          <button
            onClick={onClose}
            className="w-full h-13 rounded-2xl bg-white hover:bg-zinc-200 text-black font-semibold text-[15px] transition-all cursor-pointer"
          >
            Volver a la Billetera
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
          allowZero
          onAction={() => {
            setQrGenerated(false);
            setCopiedLink(false);
            setPaymentRequest(null);
            setQrError(null);
            setSubflow('link_details');
          }}
          onBack={() => setSubflow('main')}
          title="Generar Link de Pago"
        />
      </div>
    );
  }

  // 5. PAYMENT LINK SUBFLOW: DETAILS - Inputs + Generar button → QR appears below in SAME screen
  if (subflow === 'link_details') {
    return (
      <div className="flex flex-col h-full text-white px-5 pt-3 pb-8 overflow-y-auto">
        <div className="flex-1">
          <div className="flex items-center justify-between min-h-[44px] mb-2">
            <button
              onClick={() => {
                setQrGenerated(false);
                setCopiedLink(false);
                setPaymentRequest(null);
                setQrError(null);
                setSubflow('link_amount');
              }}
              className="flex items-center gap-1.5 text-[#26e5c8] hover:text-[#56f0d9] transition-colors text-sm font-semibold py-2 rounded-lg cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Atras</span>
            </button>
            <h1 className="text-[17px] font-semibold text-white tracking-tight">Link de Pago</h1>
            <div className="w-12" />
          </div>

          <div className="p-4 rounded-2xl bg-[#1c1c1f] border border-white/5 mb-5 text-center">
            <span className="text-xs text-zinc-400 block mb-1">Monto a Cobrar</span>
            <div className="flex items-center justify-center gap-2">
              <CoinIcon className="w-6 h-6 text-zinc-300" />
              <span className="text-3xl font-bold text-white tabular-nums">
                {linkAmount.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-zinc-400 block mb-1.5">
                Concepto o descripción
              </label>
              <input
                type="text"
                value={concept}
                onChange={(e) => {
                  setConcept(e.target.value);
                  setQrGenerated(false);
                  setPaymentRequest(null);
                }}
                placeholder="Ej. Honorarios diseño, consultoría, cuota..."
                className="w-full h-12 px-3.5 rounded-xl bg-[#1e1e21] border border-white/10 text-white text-sm focus:outline-none focus:border-[#ff5a1f]"
              />
            </div>

            {qrError && (
              <p role="alert" className="text-xs text-red-400 text-center">{qrError}</p>
            )}

            {!qrGenerated && (
              <div className="pt-2">
                <button
                  onClick={handleGenerateQR}
                  disabled={generatingQR}
                  className="w-full h-13 rounded-2xl bg-[#ff5a1f] hover:bg-[#ff6c35] active:scale-[0.98] text-white font-semibold text-[15px] flex items-center justify-center gap-2 shadow-lg shadow-[#ff5a1f]/20 cursor-pointer transition-all"
                >
                  {generatingQR ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  <span>{generatingQR ? 'Generando solicitud...' : 'Confirmar'}</span>
                </button>
              </div>
            )}

            {/* QR Generated Section - Appears below inputs in SAME screen */}
            {qrGenerated && paymentRequest && (
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

                  <p className="text-[11px] font-medium text-zinc-600 truncate max-w-full">
                    {concept}
                  </p>
                  {qrError && (
                    <p className="text-[11px] text-red-500 text-center mt-2">{qrError}</p>
                  )}
                </div>

                <div className="p-3 rounded-xl bg-[#1e1e21] border border-white/5">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1">
                    Link web de pago · {chain.describeNetwork()}
                  </p>
                  <a
                    href={paymentRequest.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block break-all text-[11px] text-[#26e5c8] underline"
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
                    <p className="text-[11px] text-zinc-300 mb-2 text-center">
                      Comparte el enlace o escanea el QR para abrir esta página desde la cuenta pagadora. Allí podrá revisar la solicitud y firmar el pago con su wallet Solana.
                    </p>
                </div>

              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 6. MAIN VIEW
  return (
    <div className="flex flex-col h-full justify-between text-white px-5 pt-3 pb-24 overflow-y-auto select-none">
      <div>
        <div className="flex items-center justify-between min-h-[44px] mb-3">
          <button
            onClick={onClose}
            className="flex items-center gap-1 text-[#26e5c8] hover:text-[#56f0d9] transition-colors text-[15px] font-semibold py-2 rounded-lg cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5 stroke-[2.5]" />
            <span>Atras</span>
          </button>
          <h1 className="text-[17px] font-semibold text-white tracking-tight">Enviar</h1>
          <div className="w-12" />
        </div>

        <div className="mb-4">
          <label className="text-[14px] font-semibold text-zinc-300 block mb-2">
            Dirección Solana de destino
          </label>
          <div className="w-full h-12 rounded-2xl bg-white flex items-center px-4 shadow-sm">
            <Search className="w-5 h-5 text-zinc-600 mr-2.5 shrink-0" />
            <input
              type="text"
              placeholder="Pega una dirección pública Solana"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSendError(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleCustomRecipient()}
              className="w-full bg-transparent text-black text-xs font-mono placeholder:text-zinc-500 placeholder:font-sans placeholder:text-sm font-normal outline-none"
            />
            {searchQuery.trim().length > 0 && (
              <button
                onClick={handleCustomRecipient}
                className="px-2.5 py-1 rounded-lg bg-[#ff5a1f] text-white text-xs font-semibold shrink-0 cursor-pointer"
              >
                Continuar
              </button>
            )}
          </div>
          {sendError && (
            <p role="alert" className="mt-2 text-xs text-red-400">{sendError}</p>
          )}
          <p className="mt-2 text-[11px] text-zinc-500">
            El envío se firmará desde {solanaWallet?.address.slice(0, 6)}…{solanaWallet?.address.slice(-4)} en {chain.describeNetwork()}.
          </p>
        </div>

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
              <h3 className="text-[15px] font-semibold text-white leading-snug">
                Generar link de pago
              </h3>
            </div>
            <ArrowRight className="w-5 h-5 text-[#26e5c8] group-hover:translate-x-1 transition-transform" />
          </button>
        </div>
      </div>
    </div>
  );
};