import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, Check, Loader2, QrCode, ScanLine, X } from 'lucide-react';
import { Translations } from '../i18n/translations';
import { NotificationToast, ToastData } from './NotificationToast';

interface QrScannerFlowProps {
  onClose: () => void;
  t: Translations;
}

type ScanState = 'idle' | 'requesting' | 'scanning' | 'detected' | 'denied' | 'unsupported';

export const QrScannerFlow: React.FC<QrScannerFlowProps> = ({ onClose, t }) => {
  const [state, setState] = useState<ScanState>('idle');
  const [detectedValue, setDetectedValue] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unsupported');
      return;
    }

    setState('requesting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });

      streamRef.current = stream;
      setState('scanning');

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
    } catch {
      setState('denied');
    }
  }, []);

  useEffect(() => {
    return () => stopCamera();
  }, [stopCamera]);

  // Prototype: simulate a successful detection 3s after the camera goes live.
  useEffect(() => {
    if (state !== 'scanning') return;
    const timer = window.setTimeout(() => {
      setDetectedValue('rewallet.app/pay/@cata_soto/45usdc');
      setState('detected');
      stopCamera();
    }, 3000);
    return () => window.clearTimeout(timer);
  }, [state, stopCamera]);

  const handleConfirmScan = useCallback(() => {
    setToast({
      id: `toast-${Date.now()}`,
      title: 'QR detectado',
      message: detectedValue ?? 'Código QR leído correctamente',
    });
    window.setTimeout(() => setToast(null), 3500);
  }, [detectedValue]);

  const handleRescan = useCallback(() => {
    setDetectedValue(null);
    setState('idle');
  }, []);

  return (
    <div className="flex flex-col h-full text-white px-5 pt-3 pb-8 overflow-y-auto">
      <NotificationToast toast={toast} onDismiss={() => setToast(null)} />

      <div className="flex items-center justify-between min-h-[44px] mb-3">
        <button
          onClick={() => {
            stopCamera();
            onClose();
          }}
          className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors text-sm font-medium py-2 rounded-lg cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>{t.back}</span>
        </button>
        <h1 className="text-[17px] font-semibold text-white tracking-tight">{t.qrScannerTitle}</h1>
        <div className="w-12" />
      </div>

      {/* Camera viewport */}
      <div className="relative flex-1 min-h-[320px] rounded-3xl bg-[#101013] border border-white/10 overflow-hidden flex items-center justify-center">
        <video
          ref={videoRef}
          playsInline
          muted
          className={`absolute inset-0 w-full h-full object-cover ${
            state === 'scanning' ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {/* Viewfinder overlay */}
        {(state === 'scanning' || state === 'detected') && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="relative w-56 h-56">
              <span className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-[#ff5a1f] rounded-tl-2xl" />
              <span className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-[#ff5a1f] rounded-tr-2xl" />
              <span className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-[#ff5a1f] rounded-bl-2xl" />
              <span className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-[#ff5a1f] rounded-br-2xl" />
              {state === 'scanning' && (
                <span className="absolute left-0 right-0 h-0.5 bg-[#ff5a1f] shadow-[0_0_12px_#ff5a1f] animate-[scanline_2s_ease-in-out_infinite]" />
              )}
            </div>
          </div>
        )}

        {/* Idle */}
        {state === 'idle' && (
          <div className="text-center px-6">
            <div className="w-16 h-16 rounded-full bg-[#ff5a1f]/15 border border-[#ff5a1f]/30 flex items-center justify-center mx-auto mb-4">
              <QrCode className="w-8 h-8 text-[#ff5a1f]" />
            </div>
            <p className="text-sm text-zinc-300 mb-1">{t.qrScannerHint}</p>
            <p className="text-xs text-zinc-500 mb-5">
              Compatible con códigos Solana Pay y links de cobro ReWallet.
            </p>
            <button
              onClick={startCamera}
              className="h-12 px-6 rounded-2xl bg-[#ff5a1f] hover:bg-[#ff6c35] active:scale-[0.98] text-white font-semibold text-sm flex items-center justify-center gap-2 mx-auto shadow-lg shadow-[#ff5a1f]/20 transition-all cursor-pointer"
            >
              <Camera className="w-4 h-4" />
              <span>{t.qrScannerActivate}</span>
            </button>
          </div>
        )}

        {/* Requesting */}
        {state === 'requesting' && (
          <div className="text-center px-6">
            <Loader2 className="w-8 h-8 animate-spin text-[#ff5a1f] mx-auto mb-3" />
            <p className="text-sm text-zinc-400">Solicitando acceso a la cámara...</p>
          </div>
        )}

        {/* Scanning hint */}
        {state === 'scanning' && (
          <div className="absolute bottom-4 left-0 right-0 text-center px-6">
            <p className="inline-flex items-center gap-2 text-xs text-zinc-200 bg-black/60 backdrop-blur px-3 py-1.5 rounded-full border border-white/10">
              <ScanLine className="w-3.5 h-3.5 text-[#ff5a1f]" />
              Apunta al código QR
            </p>
          </div>
        )}

        {/* Detected */}
        {state === 'detected' && (
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center text-center px-6">
            <div className="w-14 h-14 rounded-full bg-[#10b981] text-black flex items-center justify-center mb-3">
              <Check className="w-7 h-7 stroke-[3]" />
            </div>
            <p className="text-sm font-semibold text-white mb-1">{t.qrScannerDetected}</p>
            <p className="text-xs font-mono text-[#26e5c8] break-all max-w-[240px] mb-4">
              {detectedValue}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={handleRescan}
                className="h-11 px-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 text-xs font-semibold transition-colors cursor-pointer"
              >
                Escanear otro
              </button>
              <button
                onClick={handleConfirmScan}
                className="h-11 px-5 rounded-xl bg-[#ff5a1f] hover:bg-[#ff6c35] text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                Confirmar
              </button>
            </div>
          </div>
        )}

        {/* Denied */}
        {state === 'denied' && (
          <div className="text-center px-6">
            <div className="w-14 h-14 rounded-full bg-red-900/30 border border-red-900/50 flex items-center justify-center mx-auto mb-3">
              <X className="w-7 h-7 text-red-400" />
            </div>
            <p className="text-sm text-white mb-1">{t.qrScannerDenied}</p>
            <p className="text-xs text-zinc-500 mb-5">
              Habilita el permiso de cámara en tu navegador e inténtalo de nuevo.
            </p>
            <button
              onClick={startCamera}
              className="h-11 px-5 rounded-xl bg-[#ff5a1f] hover:bg-[#ff6c35] text-white text-xs font-semibold transition-colors cursor-pointer"
            >
              Reintentar
            </button>
          </div>
        )}

        {/* Unsupported */}
        {state === 'unsupported' && (
          <div className="text-center px-6">
            <p className="text-sm text-white mb-1">{t.qrScannerUnsupported}</p>
            <p className="text-xs text-zinc-500">
              Este dispositivo o navegador no expone acceso a la cámara.
            </p>
          </div>
        )}
      </div>

      <p className="text-[11px] text-zinc-500 text-center mt-4">
        {t.qrScannerPrivacy}
      </p>
    </div>
  );
};
