import React from 'react';
import { LogOut, Mail, Globe, Wallet } from 'lucide-react';
import { Language, Translations } from '../i18n/translations';

interface SettingsViewProps {
  onLogout?: () => void;
  language: Language;
  onLanguageChange: (lang: Language) => void;
  t: Translations;
  dynamicEmail?: string;
  solanaAddress?: string;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  onLogout,
  language,
  onLanguageChange,
  t,
  dynamicEmail,
  solanaAddress,
}) => {
  return (
    <div className="h-full flex flex-col px-5 pt-3 pb-8 text-white select-none overflow-y-auto">
      {/* First Div: Profile Avatar, Name, and Tag */}
      <div className="flex flex-col items-center justify-center p-6 rounded-3xl bg-[#18181b] border border-white/5 mb-5 text-center">
        <img
          src="/avatar_perfil.png"
          alt="Avatar del perfil"
          className="w-18 h-18 rounded-full object-cover shadow-lg shadow-[#ff1f71]/20 mb-3 select-none"
        />
        <h2 className="text-lg font-bold text-white leading-tight mb-0.5">
          Cuenta Anonymus
        </h2>
        <span className="text-xs font-semibold text-[#ff5a1f] font-mono">{dynamicEmail ?? 'Email no disponible'}</span>
      </div>

      {/* Profile Details List */}
      <div className="rounded-2xl bg-[#18181b] border border-white/5 divide-y divide-white/5 mb-6 text-sm">
        {/* Correo */}
        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3 text-zinc-400">
            <Mail className="w-4 h-4 text-zinc-400" />
            <span className="text-xs font-medium">{t.email}</span>
          </div>
          <span className="text-xs font-semibold text-white font-mono">{dynamicEmail ?? 'No disponible'}</span>
        </div>

        {/* Solana wallet embebida */}
        <div className="p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 text-zinc-400">
            <Wallet className="w-4 h-4 text-[#ff5a1f]" />
            <span className="text-xs font-medium">Solana wallet</span>
          </div>
          <span className="max-w-[58%] truncate text-right text-xs font-semibold text-white font-mono">
            {solanaAddress ?? 'Not connected'}
          </span>
        </div>

        {/* Selector de Idiomas */}
        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3 text-zinc-400">
            <Globe className="w-4 h-4 text-[#ff5a1f]" />
            <span className="text-xs font-medium">{t.language}</span>
          </div>
          <div className="flex items-center gap-1 bg-[#121214] p-1 rounded-xl border border-white/5">
            <button
              onClick={() => onLanguageChange('es')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                language === 'es'
                  ? 'bg-[#ff5a1f] text-white shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              Español
            </button>
            <button
              onClick={() => onLanguageChange('en')}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                language === 'en'
                  ? 'bg-[#ff5a1f] text-white shadow-sm'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              English
            </button>
          </div>
        </div>
      </div>

      {/* Cerrar Sesión Button — pinned to the bottom of the profile screen */}
      <div className="mt-auto pt-4">
        <button
          onClick={onLogout}
          className="w-full h-12 rounded-2xl bg-[#221515] hover:bg-[#2e1919] active:scale-[0.98] border border-red-900/40 text-red-400 font-semibold text-sm flex items-center justify-center gap-2 transition-all cursor-pointer"
        >
          <LogOut className="w-4 h-4 stroke-[2.2]" />
          <span>{t.logout}</span>
        </button>
      </div>
    </div>
  );
};
