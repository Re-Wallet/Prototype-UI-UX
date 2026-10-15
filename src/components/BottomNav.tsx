import React from 'react';
import { Home, ArrowLeftRight, Settings } from 'lucide-react';
import { Translations } from '../i18n/translations';

export type NavTab = 'home' | 'transfer' | 'settings';

interface BottomNavProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  t: Translations;
}

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onTabChange, t }) => {
  return (
    <div className="absolute bottom-3 left-0 right-0 z-40 flex justify-center pointer-events-none px-4">
      <nav
        className="pointer-events-auto flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#1e1e22]/90 backdrop-blur-xl border border-white/10 shadow-2xl shadow-black/80"
        aria-label="Barra de navegación principal"
      >
        {/* Home */}
        <button
          onClick={() => onTabChange('home')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-all active:scale-95 cursor-pointer ${
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
          className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-all active:scale-95 cursor-pointer ${
            activeTab === 'transfer'
              ? 'bg-[#40271c] text-[#ff5a1f] shadow-sm'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          <ArrowLeftRight className="w-4 h-4 stroke-[2.2]" />
          <span>{t.navTransfer}</span>
        </button>

        {/* Settings */}
        <button
          onClick={() => onTabChange('settings')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold transition-all active:scale-95 cursor-pointer ${
            activeTab === 'settings'
              ? 'bg-[#40271c] text-[#ff5a1f] shadow-sm'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          <Settings className="w-4 h-4 stroke-[2.2]" />
          <span>{t.navSettings}</span>
        </button>
      </nav>
    </div>
  );
};
