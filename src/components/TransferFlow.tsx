import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { Keypad } from './Keypad';
import { CoinIcon } from './CoinIcon';
import { Contact, Transaction } from '../types/wallet';
import { INITIAL_CONTACTS, INITIAL_USER } from '../data/mockData';

interface TransferFlowProps {
  balance: number;
  onClose: () => void;
  onTransferComplete: (transaction: Transaction) => void;
  onReceivePayment?: (transaction: Transaction) => void;
  initialMode?: 'send' | 'payment_link';
  initialRecipient?: string;
  onSubflowChange?: (inSubflow: boolean) => void;
}

export const TransferFlow: React.FC<TransferFlowProps> = ({
  balance,
  onClose,
  onTransferComplete,
  onReceivePayment,
  initialMode = 'send',
  initialRecipient,
  onSubflowChange,
}) => {
  // Subflow mode: 'main' (Send list matching screenshot), 'amount' (keypad), 'confirm', 'success', or 'link_amount', 'link_details', 'link_generated'
  const [subflow, setSubflow] = useState<
    'main' | 'amount' | 'confirm' | 'success' | 'link_amount' | 'link_details' | 'link_generated'
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
  const [recipient, setRecipient] = useState<string>(initialRecipient || '@benja_munoz');
  const [recipientName, setRecipientName] = useState<string>('Benjamín Muñoz');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [sendAmountStr, setSendAmountStr] = useState<string>('30');
  const [note, setNote] = useState<string>('Almuerzo de trabajo');
  const [isSending, setIsSending] = useState<boolean>(false);

  // Payment Link state
  const [linkAmountStr, setLinkAmountStr] = useState<string>('45');
  const [concept, setConcept] = useState<string>('Servicios de Diseño & UX');
  const [clientPayerName, setClientPayerName] = useState<string>('Startup LatAm Inc.');
  const [copiedLink, setCopiedLink] = useState<boolean>(false);
  const [isSimulatingPayment, setIsSimulatingPayment] = useState<boolean>(false);
  const [simulatedPaymentSuccess, setSimulatedPaymentSuccess] = useState<boolean>(false);

  const sendAmount = parseFloat(sendAmountStr) || 0;
  const isSendOverBalance = sendAmount > balance;

  const linkAmount = parseFloat(linkAmountStr) || 0;
  const paymentLinkUrl = `https://mozaik.money/pay/${INITIAL_USER.handle}/${
    linkAmount > 0 ? `${linkAmount}usdc` : 'open'
  }`;

  const filteredContacts = INITIAL_CONTACTS.filter(
    (c) =>
      c.handle.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleSelectContact = (contact: Contact) => {
    setRecipient(contact.handle);
    setRecipientName(contact.name);
    setSubflow('amount');
  };

  const handleCustomRecipient = () => {
    if (!searchQuery.trim()) return;
    const cleanHandle = searchQuery.startsWith('@') ? searchQuery : `@${searchQuery}`;
    setRecipient(cleanHandle);
    setRecipientName(cleanHandle.replace('@', ''));
    setSubflow('amount');
  };

  const handleExecuteSend = () => {
    setIsSending(true);
    setTimeout(() => {
      setIsSending(false);
      const newTx: Transaction = {
        id: `tx-${Date.now()}`,
        title: recipient,
        counterparty: recipient,
        type: 'sent',
        status: 'completed',
        amount: sendAmount,
        fiatAmount: sendAmount,
        fiatCurrency: 'USD',
        timestamp: 'Just now',
        date: new Date(),
        method: 'Mozaik Instant P2P',
        referenceId: `MOZ-${Math.floor(1000000 + Math.random() * 9000000)}`,
        note: note || 'Transferencia entre usuarios Mozaik',
      };
      onTransferComplete(newTx);
      setSubflow('success');
    }, 1600);
  };

  const handleCopyLink = () => {
    setCopiedLink(true);
    navigator.clipboard?.writeText(paymentLinkUrl);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const handleShareWhatsApp = () => {
    const text = encodeURIComponent(
      `Hola! Te comparto mi enlace de cobro de Mozaik para ${concept} por Ⓢ ${linkAmount} USDC: ${paymentLinkUrl}`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  const handleSimulateClientPay = () => {
    setIsSimulatingPayment(true);
    setTimeout(() => {
      setIsSimulatingPayment(false);
      setSimulatedPaymentSuccess(true);

      const newTx: Transaction = {
        id: `tx-${Date.now()}`,
        title: `Cobro: ${concept}`,
        counterparty: clientPayerName,
        type: 'received',
        status: 'completed',
        amount: linkAmount,
        fiatAmount: linkAmount,
        fiatCurrency: 'USD',
        timestamp: 'Just now',
        date: new Date(),
        method: 'Mozaik Payment Link',
        referenceId: `PAY-${Math.floor(100000 + Math.random() * 900000)}`,
        note: `Cobro pagado por ${clientPayerName}`,
      };

      if (onReceivePayment) {
        onReceivePayment(newTx);
      }
    }, 2000);
  };

  // 1. AMOUNT KEYPAD FOR SENDING (No redundant subtitle, just clean title)
  if (subflow === 'amount') {
    return (
      <div className="h-full flex flex-col justify-between">
        <Keypad
          balance={balance}
          value={sendAmountStr}
          onChange={setSendAmountStr}
          actionLabel={isSendOverBalance ? 'Saldo Insuficiente' : 'Continuar a Confirmar'}
          actionDisabled={isSendOverBalance || sendAmount <= 0}
          onAction={() => setSubflow('confirm')}
          onBack={() => setSubflow('main')}
          title={`Enviar a ${recipient}`}
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

          {/* Amount Box */}
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

          {/* Recipient Details */}
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
                <span>Comisión de Envío</span>
                <span className="text-[#26e5c8] font-semibold">$0.00 (Gratis)</span>
              </div>
              <div className="flex justify-between">
                <span>Velocidad de Acreditación</span>
                <span className="text-white font-medium">Inmediata (0 segundos)</span>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-4 pb-2">
          <button
            onClick={handleExecuteSend}
            disabled={isSending}
            className="w-full h-13 rounded-2xl bg-[#ff5a1f] hover:bg-[#ff6c35] active:scale-[0.98] text-white font-semibold text-[15px] flex items-center justify-center gap-2 shadow-lg shadow-[#ff5a1f]/20 cursor-pointer transition-all"
          >
            {isSending ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Enviando al instante...</span>
              </>
            ) : (
              <>
                <Send className="w-4 h-4" />
                <span>Confirmar y Enviar Ⓢ {sendAmount.toFixed(2)}</span>
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
            ¡Transferencia Enviada!
          </h2>
          <p className="text-sm text-zinc-400 mb-6">
            {recipient} ya tiene disponibles los dólares digitales en su cuenta.
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
              <span className="text-zinc-400">Comisión</span>
              <span className="text-[#26e5c8] font-bold">0.00 USDC</span>
            </div>
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

  // 4. PAYMENT LINK SUBFLOW: KEYPAD (Subtitle deleted as requested)
  if (subflow === 'link_amount') {
    return (
      <div className="h-full flex flex-col justify-between">
        <Keypad
          balance={balance}
          value={linkAmountStr}
          onChange={setLinkAmountStr}
          actionLabel="Continuar a Detalles del Link"
          onAction={() => setSubflow('link_details')}
          onBack={() => setSubflow('main')}
          title="Generar Payment Link"
        />
      </div>
    );
  }

  // 5. PAYMENT LINK SUBFLOW: DETAILS (Ample padding so button is completely above and never covered)
  if (subflow === 'link_details') {
    return (
      <div className="flex flex-col h-full justify-between text-white px-5 pt-3 pb-8 overflow-y-auto">
        <div>
          <div className="flex items-center justify-between min-h-[44px] mb-2">
            <button
              onClick={() => setSubflow('link_amount')}
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
                onChange={(e) => setConcept(e.target.value)}
                placeholder="Ej. Honorarios diseño, consultoría, cuota..."
                className="w-full h-12 px-3.5 rounded-xl bg-[#1e1e21] border border-white/10 text-white text-sm focus:outline-none focus:border-[#ff5a1f]"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-zinc-400 block mb-1.5">
                Cliente o empresa a cobrar (referencia)
              </label>
              <input
                type="text"
                value={clientPayerName}
                onChange={(e) => setClientPayerName(e.target.value)}
                placeholder="Nombre del pagador..."
                className="w-full h-12 px-3.5 rounded-xl bg-[#1e1e21] border border-white/10 text-white text-sm focus:outline-none focus:border-[#ff5a1f]"
              />
            </div>


          </div>
        </div>

        {/* Action Button positioned safely above bottom with pb-2 */}
        <div className="pt-4 pb-2">
          <button
            onClick={() => setSubflow('link_generated')}
            className="w-full h-13 rounded-2xl bg-[#ff5a1f] hover:bg-[#ff6c35] active:scale-[0.98] text-white font-semibold text-[15px] flex items-center justify-center gap-2 shadow-lg shadow-[#ff5a1f]/20 cursor-pointer transition-all"
          >
            <Sparkles className="w-4 h-4" />
            <span>Generar Link & QR</span>
          </button>
        </div>
      </div>
    );
  }

  // 6. PAYMENT LINK SUBFLOW: GENERATED & SHARE (Ample padding so button is never covered)
  if (subflow === 'link_generated') {
    return (
      <div className="flex flex-col h-full justify-between text-white px-5 pt-3 pb-8 overflow-y-auto">
        <div>
          <div className="flex items-center justify-between min-h-[44px] mb-2">
            <button
              onClick={() => setSubflow('link_details')}
              className="flex items-center gap-1.5 text-[#26e5c8] hover:text-[#56f0d9] transition-colors text-sm font-semibold py-2 rounded-lg cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Back</span>
            </button>
            <h1 className="text-[17px] font-semibold text-white tracking-tight">Payment Link</h1>
            <div className="w-12" />
          </div>

          {simulatedPaymentSuccess ? (
            <div className="my-6 p-5 rounded-2xl bg-[#10b981]/15 border border-[#10b981]/40 text-center animate-in fade-in zoom-in-95 duration-300">
              <div className="w-12 h-12 rounded-full bg-[#10b981] text-black flex items-center justify-center mx-auto mb-3">
                <CheckCircle2 className="w-7 h-7 stroke-[2.5]" />
              </div>
              <h3 className="text-lg font-bold text-white mb-1">¡Cobro Recibido con Éxito!</h3>
              <p className="text-xs text-zinc-300 mb-2">
                {clientPayerName} acaba de pagar Ⓢ {linkAmount.toFixed(2)} por &quot;{concept}&quot;.
              </p>
              <span className="text-xs font-semibold text-[#26e5c8] block">
                +Ⓢ {linkAmount.toFixed(2)} sumados a tu saldo
              </span>
            </div>
          ) : (
            <>
              {/* Visual QR Card */}
              <div className="p-4 rounded-3xl bg-white text-black max-w-[240px] mx-auto my-2 shadow-xl flex flex-col items-center">
                <div className="w-full flex items-center justify-between pb-2 border-b border-zinc-200 text-xs">
                  <span className="font-bold tracking-tight text-zinc-900">{INITIAL_USER.handle}</span>
                  <span className="font-semibold text-[#ff5a1f]">Ⓢ {linkAmount.toFixed(2)}</span>
                </div>

                <div className="w-38 h-38 bg-white p-2 my-2 flex flex-col justify-between">
                  <div className="flex justify-between">
                    <div className="w-10 h-10 border-4 border-black p-1 flex items-center justify-center">
                      <div className="w-5 h-5 bg-black" />
                    </div>
                    <div className="w-8 h-8 grid grid-cols-2 gap-1 p-0.5">
                      <div className="bg-black" />
                      <div className="bg-black" />
                    </div>
                    <div className="w-10 h-10 border-4 border-black p-1 flex items-center justify-center">
                      <div className="w-5 h-5 bg-black" />
                    </div>
                  </div>
                  <div className="my-auto py-1 flex items-center justify-center">
                    <div className="w-9 h-9 rounded-full bg-[#ff5a1f] text-white flex items-center justify-center font-bold text-xs shadow-md">
                      Ⓢ
                    </div>
                  </div>
                  <div className="flex justify-between items-end">
                    <div className="w-10 h-10 border-4 border-black p-1 flex items-center justify-center">
                      <div className="w-5 h-5 bg-black" />
                    </div>
                    <div className="w-14 h-7 grid grid-cols-3 gap-1">
                      <div className="bg-black" />
                      <div className="bg-black" />
                      <div className="bg-black" />
                    </div>
                  </div>
                </div>

                <p className="text-[11px] font-medium text-zinc-600 truncate max-w-full">
                  {concept}
                </p>
              </div>

              {/* Copyable Link Box */}
              <div className="mt-3 p-3 rounded-2xl bg-[#1e1e21] border border-white/5 flex items-center justify-between">
                <div className="min-w-0 pr-2">
                  <span className="text-[10px] text-zinc-400 block uppercase font-semibold">
                    Enlace de cobro para compartir
                  </span>
                  <p className="text-xs font-mono text-[#26e5c8] truncate">{paymentLinkUrl}</p>
                </div>
                <button
                  onClick={handleCopyLink}
                  className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white shrink-0 active:scale-95 transition-all cursor-pointer"
                  title="Copiar link"
                >
                  {copiedLink ? <Check className="w-4 h-4 text-[#26e5c8]" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>

              {/* Share Options Strip */}
              <div className="grid grid-cols-2 gap-2 mt-3">
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

              {/* Test Simulation Trigger */}
              <div className="mt-4 p-3 rounded-xl bg-[#ff5a1f]/10 border border-[#ff5a1f]/30">
                <p className="text-xs font-medium text-zinc-300 mb-2">
                  🧪 <strong className="text-white">Probar flujo:</strong> Simula que {clientPayerName} paga este link en este instante.
                </p>
                <button
                  onClick={handleSimulateClientPay}
                  disabled={isSimulatingPayment}
                  className="w-full py-2.5 px-3 rounded-lg bg-[#ff5a1f] hover:bg-[#ff6c35] text-white text-xs font-semibold flex items-center justify-center gap-2 transition-all cursor-pointer"
                >
                  {isSimulatingPayment ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Simulando pago de cliente en vivo...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      <span>Simular pago de cliente ahora</span>
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="pt-4 pb-2">
          <button
            onClick={onClose}
            className="w-full h-12 rounded-2xl bg-white/5 hover:bg-white/10 text-zinc-300 text-sm font-medium transition-colors cursor-pointer"
          >
            Finalizar y Volver
          </button>
        </div>
      </div>
    );
  }

  // 7. MAIN VIEW (EXACTLY MATCHING THE USER'S ATTACHED SCREENSHOT)
  return (
    <div className="flex flex-col h-full justify-between text-white px-5 pt-3 pb-24 overflow-y-auto select-none">
      <div>
        {/* Header: < Back on left, Send centered */}
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

        {/* Section: To */}
        <div className="mb-4">
          <label className="text-[14px] font-semibold text-zinc-300 block mb-2">
            Para
          </label>
          {/* Search by username input: white rounded pill as in screenshot */}
          <div className="w-full h-12 rounded-2xl bg-white flex items-center px-4 shadow-sm">
            <Search className="w-5 h-5 text-zinc-600 mr-2.5 shrink-0" />
            <input
              type="text"
              placeholder="Search by username"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCustomRecipient()}
              className="w-full bg-transparent text-black text-sm placeholder:text-zinc-500 font-normal outline-none"
            />
            {searchQuery.trim().length > 0 && (
              <button
                onClick={handleCustomRecipient}
                className="px-2.5 py-1 rounded-lg bg-[#ff5a1f] text-white text-xs font-semibold shrink-0 cursor-pointer"
              >
                Elegir
              </button>
            )}
          </div>
        </div>

        {/* Section: Recent (in teal/cyan like screenshot) */}
        <div className="mb-4">
          <h2 className="text-[13px] font-semibold text-[#26e5c8] mb-2">
            Recien
          </h2>

          {/* Contact rows: same clean style as Recents rows */}
          <div className="divide-y divide-white/[0.04]">
            {filteredContacts.map((contact) => (
              <button
                key={contact.id}
                onClick={() => handleSelectContact(contact)}
                className="w-full flex items-center py-3 px-1 hover:bg-white/[0.03] active:bg-white/[0.06] rounded-xl transition-colors text-left group cursor-pointer"
              >
                {/* Circular Avatar with smiley matching screenshot */}
                <div
                  className={`w-10 h-10 rounded-full ${contact.avatarBg} flex items-center justify-center text-white text-sm font-bold shrink-0 mr-3.5 shadow-sm transition-transform group-hover:scale-105`}
                >
                  <span className="select-none">◡̈</span>
                </div>

                {/* Handle matching screenshot */}
                <span className="text-[15px] font-semibold text-white tracking-tight leading-snug">
                  {contact.handle}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Section: Or (in teal/cyan like screenshot) */}
        <div className="mb-3 mt-4">
          <h2 className="text-[13px] font-semibold text-[#26e5c8] mb-2.5">
            O
          </h2>

          {/* Generate a payment link card matching screenshot */}
          <button
            onClick={() => setSubflow('link_amount')}
            className="w-full p-4 rounded-2xl bg-[#1e1e21] hover:bg-[#252529] active:bg-[#2b2b30] flex items-center justify-between transition-all border border-white/[0.04] text-left group cursor-pointer"
          >
            <div className="flex items-center gap-3.5">
              {/* Brown box with orange link chain icon */}
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
