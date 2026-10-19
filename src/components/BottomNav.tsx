import React from 'react';
import { Home, ArrowLeftRight, Activity, QrCode } from 'lucide-react';
import { Translations } from '../i18n/translations';

export type NavTab = 'home' | 'transfer' | 'activity';

interface BottomNavProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onOpenQrScanner: () => void;
  t: Translations;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  activeTab,
  onTabChange,
  onOpenQrScanner,
  t,
}) => {
  return (
    <div className="absolute bottom-3 left-0 right-0 z-40 flex items-center justify-start gap-2 pointer-events-none px-4">
      <nav
        className="pointer-events-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-[#1e1e22]/90 backdrop-blur-xl border border-white/10 shadow-2xl shadow-black/80"
        aria-label="Barra de navegación principal"
      >
        {/* Home */}
        <button
          onClick={() => onTabChange('home')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all active:scale-95 cursor-pointer ${
            activeTab === 'home'
              ? 'bg-[#40271c] text-[#ff5a1f] shadow-sm'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Home className="w-4 h-4 stroke-[2.2]" />
          <span>{t.navHome}</span>
        </button>

        {/* Transfer */}
        <button
          onClick={() => onTabChange('transfer')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all active:scale-95 cursor-pointer ${
            activeTab === 'transfer'
              ? 'bg-[#40271c] text-[#ff5a1f] shadow-sm'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          <ArrowLeftRight className="w-4 h-4 stroke-[2.2]" />
          <span>{t.navTransfer}</span>
        </button>

        {/* Activity (notifications) */}
        <button
          onClick={() => onTabChange('activity')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all active:scale-95 cursor-pointer ${
            activeTab === 'activity'
              ? 'bg-[#40271c] text-[#ff5a1f] shadow-sm'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Activity className="w-4 h-4 stroke-[2.2]" />
          <span>{t.navActivity}</span>
        </button>
      </nav>

      {/* QR scanner — same row as the navbar, on its right */}
      <button
        onClick={onOpenQrScanner}
        className="pointer-events-auto w-9 h-9 rounded-full bg-[#ff5a1f] hover:bg-[#ff6c35] active:scale-[0.95] flex items-center justify-center text-white shadow-lg shadow-[#ff5a1f]/30 transition-all cursor-pointer shrink-0"
        title="Escanear código QR"
        aria-label="Escanear código QR"
      >
        <QrCode className="w-4 h-4" />
      </button>
    </div>
  );
};
