import React from 'react';
import { Bell } from 'lucide-react';

interface HeaderProps {
  handle: string;
  onOpenProfile: () => void;
  onOpenNotifications: () => void;
  /** Unread notification count; shows a badge on the bell when > 0. */
  unreadCount?: number;
}

export const Header: React.FC<HeaderProps> = ({
  handle,
  onOpenProfile,
  onOpenNotifications,
  unreadCount = 0,
}) => {
  return (
    <header className="flex items-center justify-between px-5 pt-3 pb-2 text-white">
      {/* Left: User Avatar & Handle → opens the profile screen */}
      <button
        onClick={onOpenProfile}
        className="flex items-center gap-2.5 min-h-[44px] group focus-visible:ring-2 focus-visible:ring-[#ff5a1f] rounded-full pr-2 cursor-pointer"
        aria-label="Abrir perfil de usuario"
      >
        <div className="relative w-8 h-8 rounded-full bg-[#ff1f71] flex items-center justify-center shadow-sm transition-transform group-hover:scale-105">
          <span className="text-white text-xs font-bold select-none">◡̈</span>
          <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-[#26e5c8] border border-black" />
        </div>
        <span className="text-base font-semibold tracking-tight text-white/95 group-hover:text-white transition-colors">
          {handle}
        </span>
      </button>

      {/* Right: Notifications — opens the Activity section */}
      <button
        onClick={onOpenNotifications}
        className="relative w-8 h-8 rounded-full bg-[#1e1e22] border border-white/10 hover:border-white/25 hover:text-white active:scale-[0.95] flex items-center justify-center text-zinc-300 transition-all cursor-pointer"
        title="Notificaciones"
        aria-label={
          unreadCount > 0
            ? `Notificaciones, ${unreadCount} sin leer`
            : 'Notificaciones'
        }
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[#ff5a1f] text-white text-[10px] font-bold leading-4 text-center tabular-nums shadow-md shadow-black/40">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>
    </header>
  );
};
