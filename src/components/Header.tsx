import React from 'react';
import { QrCode } from 'lucide-react';

interface HeaderProps {
  handle: string;
  onOpenProfile: () => void;
  onOpenQrScanner: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  handle,
  onOpenProfile,
  onOpenQrScanner,
}) => {
  return (
    <header className="flex items-center justify-between px-5 pt-3 pb-2 text-white">
      {/* Left: User Avatar & Handle */}
      <button
        onClick={onOpenProfile}
        className="flex items-center gap-2.5 min-h-[44px] group focus:outline-none focus-visible:ring-2 focus-visible:ring-[#ff5a1f] rounded-full pr-2 cursor-pointer"
        aria-label="Abrir perfil de usuario"
      >
        <div className="relative w-8 h-8 rounded-full bg-[#ff1f71] flex items-center justify-center shadow-sm transition-transform group-hover:scale-105">
          <span className="text-white text-xs font-bold select-none">◡̈</span>
          <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-[#26e5c8] border border-black" />
        </div>
        <span className="text-[15px] font-semibold tracking-tight text-white/95 group-hover:text-white transition-colors">
          {handle}
        </span>
      </button>

      {/* Right: QR Code Scanner - Orange QR icon */}
      <button
        onClick={onOpenQrScanner}
        className="w-8 h-8 rounded-full bg-[#ff5a1f] hover:bg-[#ff6c35] active:scale-[0.95] flex items-center justify-center text-white shadow-lg shadow-[#ff5a1f]/30 transition-all cursor-pointer"
        title="Escanear código QR"
        aria-label="Escanear código QR"
      >
        <QrCode className="w-4.5 h-4.5" />
      </button>
    </header>
  );
};