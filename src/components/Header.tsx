import React from 'react';
import { Eye, EyeOff, Globe } from 'lucide-react';
import { Language, Translations } from '../i18n/translations';

interface HeaderProps {
  handle: string;
  isBalanceHidden: boolean;
  onToggleBalance: () => void;
  onOpenProfile: () => void;
  language: Language;
  onToggleLanguage: () => void;
  t: Translations;
}

export const Header: React.FC<HeaderProps> = ({
  handle,
  isBalanceHidden,
  onToggleBalance,
  onOpenProfile,
  language,
  onToggleLanguage,
  t,
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

      {/* Right: Language Selector and Eye Toggle Button */}
      <div className="flex items-center gap-1.5">
        {/* Language Selector next to the eye */}
        <button
          onClick={onToggleLanguage}
          className="h-8 px-2.5 rounded-full bg-white/5 hover:bg-white/10 flex items-center gap-1.5 text-xs font-semibold text-zinc-300 hover:text-white border border-white/5 active:scale-95 transition-all cursor-pointer"
          title="Cambiar idioma / Switch language"
          aria-label={`Current language: ${language.toUpperCase()}. Tap to toggle.`}
        >
          <Globe className="w-3.5 h-3.5 text-[#ff5a1f]" />
          <span className="text-[11px] font-bold tracking-wider">{language.toUpperCase()}</span>
        </button>

        {/* Eye Toggle Button */}
        <button
          onClick={onToggleBalance}
          className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-white transition-colors rounded-full hover:bg-white/5 active:scale-95 cursor-pointer"
          aria-label={isBalanceHidden ? t.showBalance : t.hideBalance}
          title={isBalanceHidden ? t.showBalance : t.hideBalance}
        >
          {isBalanceHidden ? (
            <EyeOff className="w-4.5 h-4.5 text-zinc-500" />
          ) : (
            <Eye className="w-4.5 h-4.5" />
          )}
        </button>
      </div>
    </header>
  );
};
