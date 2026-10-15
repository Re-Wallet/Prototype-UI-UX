import React from 'react';
import { LogOut, User, Mail, Phone, Globe } from 'lucide-react';
import { INITIAL_USER } from '../data/mockData';
import { Language, Translations } from '../i18n/translations';

interface SettingsViewProps {
  onLogout?: () => void;
  language: Language;
  onLanguageChange: (lang: Language) => void;
  t: Translations;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  onLogout,
  language,
  onLanguageChange,
  t,
}) => {
  return (
    <div className="px-5 pt-3 pb-28 text-white select-none">
      {/* First Div: Profile Avatar, Name, and Tag */}
      <div className="flex flex-col items-center justify-center p-6 rounded-3xl bg-[#18181b] border border-white/5 mb-5 text-center">
        <div className="w-18 h-18 rounded-full bg-[#ff1f71] flex items-center justify-center text-white text-3xl font-bold shadow-lg shadow-[#ff1f71]/20 mb-3 select-none">
          ◡̈
        </div>
        <h2 className="text-lg font-bold text-white leading-tight mb-0.5">
          {INITIAL_USER.name}
        </h2>
        <span className="text-xs font-semibold text-[#ff5a1f] font-mono">
          {INITIAL_USER.handle}
        </span>
      </div>

      {/* Profile Details List */}
      <div className="rounded-2xl bg-[#18181b] border border-white/5 divide-y divide-white/5 mb-6 text-sm">
        {/* Nombre y Apellido */}
        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3 text-zinc-400">
            <User className="w-4 h-4 text-zinc-400" />
            <span className="text-xs font-medium">{t.fullName}</span>
          </div>
          <span className="text-xs font-semibold text-white">{INITIAL_USER.name}</span>
        </div>

        {/* Correo */}
        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3 text-zinc-400">
            <Mail className="w-4 h-4 text-zinc-400" />
            <span className="text-xs font-medium">{t.email}</span>
          </div>
          <span className="text-xs font-semibold text-white font-mono">{INITIAL_USER.email}</span>
        </div>

        {/* Teléfono Registro */}
        <div className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3 text-zinc-400">
            <Phone className="w-4 h-4 text-zinc-400" />
            <span className="text-xs font-medium">{t.registeredPhone}</span>
          </div>
          <span className="text-xs font-semibold text-white font-mono">{INITIAL_USER.phone}</span>
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

      {/* Cerrar Sesión Button */}
      <div className="pt-2">
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
