import React, { useState, useRef, useEffect } from 'react';
import { ArrowLeft, CheckCircle2, Loader2, Zap, Camera, Check, X } from 'lucide-react';
import { Keypad } from './Keypad';
import { CoinIcon } from './CoinIcon';
import { Transaction } from '../types/wallet';

interface WithdrawFlowProps {
  balance: number;
  onClose: () => void;
  onWithdrawComplete: (transaction: Transaction) => void;
}

type WithdrawStep = 'amount' | 'details' | 'success';

export const WithdrawFlow: React.FC<WithdrawFlowProps> = ({
  balance,
  onClose,
  onWithdrawComplete,
}) => {
  const [step, setStep] = useState<WithdrawStep>('amount');
  const [amountStr, setAmountStr] = useState<string>('50');
  const [cryptoAddress, setCryptoAddress] = useState<string>('0x3c9fb64177b94ad15fce824143a992bb1842045e');
  const [cryptoNetwork, setCryptoNetwork] = useState<string>('Base');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [lastTx, setLastTx] = useState<Transaction | null>(null);

  // Camera QR Scanner state
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [scanSuccess, setScanSuccess] = useState<boolean>(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const amount = parseFloat(amountStr) || 0;
  const isOverBalance = amount > balance;

  const handleAmountContinue = () => {
    if (amount <= 0 || isOverBalance) return;
    setStep('details');
  };

  const handleStartCamera = async () => {
    setIsScanning(true);
    setScanSuccess(false);
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }
    } catch {
      // In restricted preview sandboxes, simulated viewfinder works reliably
    }
  };

  const handleStopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsScanning(false);
    setScanSuccess(false);
  };

  const handleQrDetected = () => {
    setScanSuccess(true);
    setCryptoNetwork('Base');
    setCryptoAddress('0x3c9fb64177b94ad15fce824143a992bb1842045e');
    setTimeout(() => {
      handleStopCamera();
    }, 1200);
  };

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const handleExecuteWithdraw = () => {
    setIsProcessing(true);
    setTimeout(() => {
      setIsProcessing(false);
      const newTx: Transaction = {
        id: `tx-${Date.now()}`,
        title: 'Retiro',
        type: 'withdrawal',
        status: 'completed',
        amount: amount,
        fiatAmount: amount,
        fiatCurrency: 'USD',
        timestamp: 'Just now',
        date: new Date(),
        method: `${cryptoNetwork} Network (USDC)`,
        referenceId: '0x3c9f...8a12',
        txHash: '0x3c9fb64177b94ad15fce824143a992bb1842045e7aa42d48bf56327e5ec08a12',
        note: `Retiro USDC a red ${cryptoNetwork}`,
      };
      setLastTx(newTx);
      onWithdrawComplete(newTx);
      setStep('success');
    }, 1800);
  };

  // STEP 1: Keypad for amount to withdraw
  if (step === 'amount') {
    return (
      <div className="h-full flex flex-col justify-between">
        <Keypad
          balance={balance}
          value={amountStr}
          onChange={setAmountStr}
          actionLabel={isOverBalance ? 'Saldo Insuficiente' : 'Continuar a Retiro'}
          actionDisabled={isOverBalance || amount <= 0}
          onAction={handleAmountContinue}
          onBack={onClose}
          title="Retiro"
        />
      </div>
    );
  }

  // STEP 2: Details & Confirmation (Directly to Crypto Wallet with Square Camera Scanner Box)
  if (step === 'details') {
    return (
      <div className="flex flex-col h-full justify-between text-white px-5 pt-3 pb-8 overflow-y-auto">
        <div>
          <div className="flex items-center justify-between min-h-[44px] mb-3">
            <button
              onClick={() => setStep('amount')}
              disabled={isProcessing}
              className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors text-sm font-medium py-2 rounded-lg cursor-pointer"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Back</span>
            </button>
            <h1 className="text-[17px] font-semibold text-white tracking-tight">Confirmar Retiro</h1>
            <div className="w-12" />
          </div>

          {/* Amount Card */}
          <div className="p-4 rounded-2xl bg-[#1c1c1f] border border-white/5 mb-3 text-center">
            <span className="text-xs text-zinc-400 block mb-1">Total a Retirar</span>
            <div className="flex items-center justify-center gap-2 mb-1">
              <CoinIcon className="w-6 h-6 text-zinc-300" />
              <span className="text-3xl font-bold text-white tabular-nums">{amount.toFixed(2)}</span>
            </div>
            <span className="text-xs text-zinc-500 font-medium">USDC</span>
          </div>

          {/* Network Selection */}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-zinc-400 block mb-1.5">
                Red blockchain (USDC)
              </label>
              <div className="grid grid-cols-4 gap-1.5 p-1 rounded-xl bg-[#19191c] border border-white/5 mb-3">
                {['Base', 'Polygon', 'Arbitrum', 'Solana'].map((net) => (
                  <button
                    key={net}
                    onClick={() => setCryptoNetwork(net)}
                    className={`py-1.5 px-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                      cryptoNetwork === net
                        ? 'bg-[#ff5a1f] text-white shadow-sm'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {net}
                  </button>
                ))}
              </div>
            </div>

            {/* Square Box with central button to scan with camera */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-zinc-400 block">
                  Dirección de destino
                </label>
                {cryptoAddress && (
                  <span className="text-[10px] text-[#10b981] font-semibold flex items-center gap-1">
                    <Check className="w-3.5 h-3.5 stroke-[2.5]" /> QR Base Escaneado
                  </span>
                )}
              </div>

              {/* Square Box Container (centered square with green camera scanning) */}
              <div
                className={`w-56 h-56 mx-auto rounded-2xl relative overflow-hidden flex flex-col items-center justify-center p-2.5 text-center transition-all ${
                  scanSuccess
                    ? 'bg-[#064e3b]/90 border-2 border-[#10b981] shadow-[0_0_35px_rgba(16,185,129,0.7)]'
                    : isScanning
                    ? 'bg-[#091a13] border-2 border-[#10b981] shadow-[0_0_25px_rgba(16,185,129,0.35)]'
                    : 'bg-[#151518] border-2 border-dashed border-white/20 shadow-inner'
                }`}
              >
                {isScanning ? (
                  <div
                    onClick={handleQrDetected}
                    className="relative w-full h-full rounded-xl overflow-hidden bg-black flex flex-col items-center justify-between cursor-pointer"
                    title="Toca para detectar QR de red Base"
                  >
                    {/* Video element */}
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      muted
                      className="absolute inset-0 w-full h-full object-cover opacity-80"
                    />

                    {/* Green Viewfinder Overlay over the entire square */}
                    <div className="absolute inset-0 pointer-events-none p-2 flex flex-col justify-between">
                      {/* Top corners */}
                      <div className="w-full flex justify-between">
                        <span className="w-6 h-6 border-t-3 border-l-3 border-[#10b981] rounded-tl-md shadow-[0_0_8px_#10b981]" />
                        <span className="w-6 h-6 border-t-3 border-r-3 border-[#10b981] rounded-tr-md shadow-[0_0_8px_#10b981]" />
                      </div>

                      {/* Animated Green Laser Scanning Line across the full square */}
                      <div className="w-full h-0.5 bg-[#10b981] shadow-[0_0_15px_#10b981] animate-pulse" />

                      {/* Bottom corners */}
                      <div className="w-full flex justify-between">
                        <span className="w-6 h-6 border-b-3 border-l-3 border-[#10b981] rounded-bl-md shadow-[0_0_8px_#10b981]" />
                        <span className="w-6 h-6 border-b-3 border-r-3 border-[#10b981] rounded-br-md shadow-[0_0_8px_#10b981]" />
                      </div>
                    </div>

                    {/* Top status bar */}
                    <div className="relative z-20 w-full flex items-center justify-between px-2 pt-1.5">
                      <span className="text-[10px] font-semibold text-[#10b981] bg-black/60 px-2 py-0.5 rounded-full border border-[#10b981]/30">
                        ● Escaneando Base
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStopCamera();
                        }}
                        className="p-1 rounded-full bg-black/75 text-white hover:bg-black text-xs cursor-pointer"
                        title="Cerrar cámara"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Success full green screen overlay when QR is detected */}
                    {scanSuccess && (
                      <div className="absolute inset-0 z-30 bg-[#10b981]/30 backdrop-blur-xs flex flex-col items-center justify-center p-3 animate-in fade-in zoom-in-95 duration-200">
                        <div className="w-14 h-14 rounded-full bg-[#10b981] text-black flex items-center justify-center mb-1.5 shadow-lg shadow-[#10b981]/50">
                          <Check className="w-9 h-9 stroke-[3]" />
                        </div>
                        <span className="text-sm font-bold text-white tracking-tight">
                          ¡QR Escaneado!
                        </span>
                        <span className="text-[11px] font-semibold text-[#10b981] bg-black/70 px-2.5 py-0.5 rounded-full mt-1 border border-[#10b981]/40">
                          Destino: Red Base
                        </span>
                        <span className="text-[10px] font-mono text-zinc-300 mt-1">
                          0x3c9f...2045e
                        </span>
                      </div>
                    )}

                    {/* Bottom detection trigger button */}
                    {!scanSuccess && (
                      <div className="relative z-20 pb-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleQrDetected();
                          }}
                          className="px-3.5 py-1.5 rounded-full bg-[#10b981] hover:bg-[#059669] text-black text-[11px] font-bold active:scale-95 transition-all shadow-lg shadow-[#10b981]/40 cursor-pointer flex items-center gap-1.5"
                        >
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                          <span>Detectar QR Base</span>
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-2">
                    {/* Central Button to Scan */}
                    <button
                      onClick={handleStartCamera}
                      className="w-16 h-16 rounded-full bg-[#ff5a1f] hover:bg-[#ff6c35] text-white flex items-center justify-center shadow-lg shadow-[#ff5a1f]/35 active:scale-95 transition-all cursor-pointer mb-2.5 group"
                      title="Activar cámara para escanear"
                    >
                      <Camera className="w-8 h-8 stroke-[2.2] group-hover:scale-110 transition-transform" />
                    </button>

                    <span className="text-[13px] font-semibold text-white block">
                      Escanear código QR
                    </span>
                    <p className="text-[11px] text-zinc-400 mt-0.5">
                      Toca el botón para activar la cámara
                    </p>
                  </div>
                )}
              </div>

              {/* Scanned address display below the square */}
              {cryptoAddress && (
                <div className="mt-3 p-2.5 rounded-xl bg-[#10b981]/10 border border-[#10b981]/30 text-center flex items-center justify-between">
                  <div className="min-w-0 text-left pr-2">
                    <span className="text-[10px] text-[#10b981] font-semibold block uppercase tracking-wide flex items-center gap-1">
                      <Check className="w-3 h-3 stroke-[2.5]" /> Destino detectado en Base
                    </span>
                    <p className="text-[11px] font-mono text-white truncate max-w-[210px]">
                      {cryptoAddress}
                    </p>
                  </div>
                  <span className="text-[10px] font-bold text-[#10b981] bg-[#10b981]/20 px-2 py-0.5 rounded-md shrink-0 border border-[#10b981]/30">
                    Base L2
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Breakdown Box */}
          <div className="mt-3.5 p-3 rounded-xl bg-white/[0.02] border border-white/5 text-xs text-zinc-400 space-y-1">
            <div className="flex justify-between">
              <span>Comisión de Retiro Mozaik</span>
              <span className="text-[#26e5c8] font-semibold">$0.00 (Sin comisiones)</span>
            </div>
            <div className="flex justify-between">
              <span>Tiempo estimado</span>
              <span className="text-white font-medium">1 - 3 minutos</span>
            </div>
          </div>
        </div>

        <div className="pt-4 pb-2">
          <button
            onClick={handleExecuteWithdraw}
            disabled={isProcessing}
            className="w-full h-13 rounded-2xl bg-[#ff5a1f] hover:bg-[#ff6c35] active:scale-[0.98] text-white font-semibold text-[15px] flex items-center justify-center gap-2 shadow-lg shadow-[#ff5a1f]/20 cursor-pointer transition-all"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Procesando retiro seguro...</span>
              </>
            ) : (
              <>
                <Zap className="w-4 h-4 fill-current" />
                <span>Confirmar Retiro de Ⓢ {amount.toFixed(2)}</span>
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // STEP 3: Success confirmation
  return (
    <div className="flex flex-col h-full justify-between items-center text-center text-white px-5 pt-12 pb-8">
      <div className="flex flex-col items-center">
        <div className="w-16 h-16 rounded-full bg-[#10b981]/20 border-2 border-[#10b981] flex items-center justify-center text-[#10b981] mb-5">
          <CheckCircle2 className="w-9 h-9" />
        </div>

        <h2 className="text-2xl font-bold text-white mb-2 tracking-tight">
          ¡Retiro Enviado!
        </h2>
        <p className="text-sm text-zinc-400 mb-6">
          Los fondos están en camino a tu destino seleccionado.
        </p>

        <div className="w-full max-w-xs p-4 rounded-2xl bg-[#1e1e21] border border-white/5 mb-4 text-left space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-zinc-400">Monto Retirado</span>
            <span className="text-white font-bold tabular-nums">Ⓢ {amount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-zinc-400">Destino</span>
            <span className="text-zinc-200">{lastTx?.method}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-zinc-400">Comprobante</span>
            <span className="text-zinc-300 font-mono text-[11px]">{lastTx?.referenceId}</span>
          </div>
          <div className="flex justify-between text-xs pt-1 border-t border-white/5">
            <span className="text-zinc-400">Nuevo Saldo</span>
            <span className="text-[#26e5c8] font-bold tabular-nums">Ⓢ {(balance - amount).toFixed(2)}</span>
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
};
