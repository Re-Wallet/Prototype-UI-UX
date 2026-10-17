import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, Check, Loader2, QrCode, ScanLine, X, AlertCircle } from 'lucide-react';
import { Translations } from '../i18n/translations';
import { NotificationToast, ToastData } from './NotificationToast';
import { chain, assetByMint, type ParsedPaymentRequest } from '../adapters';
import { parseWebPaymentUrl } from '../services/webPaymentLink';

interface QrScannerFlowProps {
  onClose: () => void;
  t: Translations;
}

type ScanState = 'idle' | 'requesting' | 'scanning' | 'detected' | 'denied' | 'unsupported';

export const QrScannerFlow: React.FC<QrScannerFlowProps> = ({ onClose, t }) => {
  const [state, setState] = useState<ScanState>('idle');
  const [detectedValue, setDetectedValue] = useState<string | null>(null);
  const [parsedRequest, setParsedRequest] = useState<ParsedPaymentRequest | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Real barcode detection using Barcode Detection API
  const startBarcodeScanning = useCallback(() => {
    if (!videoRef.current || state !== 'scanning') return;

    const scan = async () => {
      if (!videoRef.current || state !== 'scanning') return;

      try {
        // Try Barcode Detection API first (Chrome/Edge)
        if ('BarcodeDetector' in window) {
          const barcodeDetector = new (window as any).BarcodeDetector({
            formats: ['qr_code'],
          });
          const barcodes = await barcodeDetector.detect(videoRef.current);
          if (barcodes.length > 0) {
            const rawValue = barcodes[0].rawValue;
            handleBarcodeDetected(rawValue);
            return;
          }
        }
      } catch (error) {
        // Barcode Detection API not available or failed, continue to fallback
        console.debug('BarcodeDetector error:', error);
      }
    };

    // Scan every 300ms
    scanIntervalRef.current = setInterval(scan, 300);
  }, [state]);

  // Stop scanning interval
  const stopBarcodeScanning = useCallback(() => {
    if (scanIntervalRef.current) {
      clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
  }, []);

  // Handle detected barcode
  const handleBarcodeDetected = useCallback((rawValue: string) => {
    stopBarcodeScanning();
    setDetectedValue(rawValue);

    try {
      const webUrl = new URL(rawValue);
      if (webUrl.origin === window.location.origin && parseWebPaymentUrl(webUrl.href)) {
        window.location.assign(webUrl.href);
        return;
      }
    } catch {
      // Continue by checking whether this is a Solana Pay URI.
    }
    
    // Parse with Solana Pay adapter
    const parsed = chain.parsePaymentRequest(rawValue);
    if (parsed) {
      setParsedRequest(parsed);
      setState('detected');
      stopCamera();
    } else {
      setScanError('Código QR no es un formato Solana Pay válido');
      setState('detected');
      stopCamera();
    }
  }, [stopBarcodeScanning, stopCamera]);

  // Start/stop scanning when state changes
  useEffect(() => {
    if (state === 'scanning') {
      // Wait for video to be ready
      const timer = setTimeout(() => {
        startBarcodeScanning();
      }, 500);
      return () => clearTimeout(timer);
    } else {
      stopBarcodeScanning();
    }
  }, [state, startBarcodeScanning, stopBarcodeScanning]);

  useEffect(() => {
    return () => {
      stopCamera();
      stopBarcodeScanning();
    };
  }, [stopCamera, stopBarcodeScanning]);



  const handleConfirmScan = useCallback(() => {
    setToast({
      id: `toast-${Date.now()}`,
      title: 'Solicitud de pago leída',
      message: 'Este escáner no envía fondos. Revisa y firma la solicitud desde una billetera Solana compatible.',
    });
    window.setTimeout(() => setToast(null), 3500);
  }, []);

  const handleRescan = useCallback(() => {
    setDetectedValue(null);
    setParsedRequest(null);
    setScanError(null);
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
            
            {parsedRequest && parsedRequest.kind === 'transfer' && (
              <div className="w-full max-w-[280px] mb-4 p-3 rounded-xl bg-white/5 border border-white/10 text-left">
                <p className="text-xs text-zinc-400 mb-1">Transfer Request</p>
                <p className="text-xs font-mono text-white break-all mb-2">
                  Recipient: {parsedRequest.recipient.slice(0, 8)}...{parsedRequest.recipient.slice(-6)}
                </p>
                {parsedRequest.amount && (
                  <p className="text-xs font-mono text-[#26e5c8] break-all mb-1">
                    Amount: {parsedRequest.amountUi?.toFixed(2) || parsedRequest.amount}
                    {parsedRequest.splToken
                      ? ` ${assetByMint(parsedRequest.splToken, chain.network().cluster)?.symbol ?? `Token ${parsedRequest.splToken.slice(0, 6)}…`}`
                      : ' SOL'}
                  </p>
                )}
                {parsedRequest.message && (
                  <p className="text-xs text-zinc-300 mb-1">Message: {parsedRequest.message}</p>
                )}
                {parsedRequest.references.length > 0 && (
                  <p className="text-xs text-zinc-400">Ref: {parsedRequest.references[0].slice(0, 8)}...</p>
                )}
              </div>
            )}
            
            {parsedRequest && parsedRequest.kind === 'transaction' && (
              <div className="w-full max-w-[280px] mb-4 p-3 rounded-xl bg-white/5 border border-white/10 text-left">
                <p className="text-xs text-zinc-400 mb-1">Transaction Request</p>
                <p className="text-xs font-mono text-white break-all mb-2">
                  Link: {parsedRequest.link.slice(0, 40)}...
                </p>
              </div>
            )}
            
            {!parsedRequest && detectedValue && (
              <p className="text-xs font-mono text-[#f87171] break-all max-w-[240px] mb-4">
                {detectedValue}
              </p>
            )}
            
            {scanError && (
              <p className="text-xs text-red-400 mb-4">{scanError}</p>
            )}

            <div className="flex items-center gap-2 w-full max-w-[280px]">
              <button
                onClick={handleRescan}
                className="flex-1 h-11 px-4 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 text-xs font-semibold transition-colors cursor-pointer"
              >
                Escanear otro
              </button>
              <button
                onClick={handleConfirmScan}
                className="flex-1 h-11 px-5 rounded-xl bg-[#ff5a1f] hover:bg-[#ff6c35] text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                Entendido
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
