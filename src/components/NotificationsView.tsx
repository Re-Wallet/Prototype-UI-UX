import React from 'react';
import { ArrowLeft, ArrowDownLeft, ArrowUpRight, AlertTriangle, CheckCheck } from 'lucide-react';
import type { WalletNotification } from '../services/walletApi';
import { Translations } from '../i18n/translations';

interface NotificationsViewProps {
  items: WalletNotification[];
  loading?: boolean;
  unread: number;
  onClose: () => void;
  onMarkAllRead: () => void;
  onOpenTransaction?: (signature: string) => void;
  t: Translations;
}

/** Compact relative time ("ahora", "5 min", "3 h", "12 oct"). */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diffMinutes = Math.floor((Date.now() - then) / 60_000);

  if (diffMinutes < 1) return 'ahora';
  if (diffMinutes < 60) return `${diffMinutes} min`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays} d`;
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function iconFor(type: string) {
  if (type === 'transfer_failed') {
    return (
      <div className="w-10 h-10 rounded-full bg-[#ef4444]/15 border border-[#ef4444]/25 flex items-center justify-center text-[#ef4444]">
        <AlertTriangle className="w-4.5 h-4.5" />
      </div>
    );
  }
  if (type === 'transfer_sent') {
    return (
      <div className="w-10 h-10 rounded-full bg-[#ff5a1f]/12 border border-[#ff5a1f]/25 flex items-center justify-center text-[#ff5a1f]">
        <ArrowUpRight className="w-5 h-5 stroke-[2.2]" />
      </div>
    );
  }
  return (
    <div className="w-10 h-10 rounded-full bg-[#10b981]/12 border border-[#10b981]/25 flex items-center justify-center text-[#10b981]">
      <ArrowDownLeft className="w-5 h-5 stroke-[2.2]" />
    </div>
  );
}

export const NotificationsView: React.FC<NotificationsViewProps> = ({
  items,
  loading = false,
  unread,
  onClose,
  onMarkAllRead,
  onOpenTransaction,
  t,
}) => {
  return (
    <div className="flex flex-col h-full text-white px-5 pt-3 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between min-h-[44px] mb-3">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors text-sm font-medium py-2 rounded-lg cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5" />
          <span>{t.back}</span>
        </button>
        <h1 className="text-[17px] font-semibold text-white tracking-tight">
          {t.notificationsTitle}
        </h1>
        {unread > 0 ? (
          <button
            onClick={onMarkAllRead}
            className="flex items-center gap-1 text-[11px] font-semibold text-[#ff5a1f] hover:text-[#ff6c35] transition-colors py-2 cursor-pointer"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            <span>{t.markAllRead}</span>
          </button>
        ) : (
          <div className="w-12" />
        )}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto divide-y divide-white/[0.04] pr-1">
        {items.length === 0 ? (
          <div className="py-16 text-center text-zinc-500 text-xs">
            {loading ? t.loadingNotifications : t.noNotifications}
          </div>
        ) : (
          items.map((item) => {
            const signature = item.dataJson?.signature;
            return (
              <button
                key={item.id}
                onClick={() => signature && onOpenTransaction?.(signature)}
                className="w-full flex items-start gap-3.5 py-3.5 px-1 text-left rounded-xl transition-colors hover:bg-white/[0.02] active:bg-white/[0.05] cursor-pointer"
              >
                <div className="relative shrink-0">
                  {iconFor(item.type)}
                  {!item.isRead && (
                    <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-[#ff5a1f] border-2 border-[#0b0b0d]" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p
                      className={`text-[14px] leading-snug truncate ${
                        item.isRead ? 'font-medium text-zinc-300' : 'font-semibold text-white'
                      }`}
                    >
                      {item.title}
                    </p>
                    <span className="text-[11px] text-zinc-500 shrink-0">
                      {relativeTime(item.createdAt)}
                    </span>
                  </div>
                  <p className="text-[12px] text-zinc-400 leading-snug">{item.message}</p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
