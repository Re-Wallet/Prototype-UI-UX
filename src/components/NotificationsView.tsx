import React from 'react';
import { ArrowLeft, CheckCheck } from 'lucide-react';
import { MovementIcon } from './movementVisuals';
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

/**
 * The icon for a notification.
 *
 * It comes from the shared movement vocabulary, so the same event carries
 * the same icon and colours in the notification feed, in "Recientes" and in
 * the history modal.
 */
function iconFor(type: string) {
  return <MovementIcon type={type} />;
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
        <h1 className="text-lg font-semibold text-white tracking-tight">
          {t.notificationsTitle}
        </h1>
        {unread > 0 ? (
          <button
            onClick={onMarkAllRead}
            className="flex items-center gap-1 text-xs font-semibold text-[#ff5a1f] hover:text-[#ff6c35] transition-colors py-2 cursor-pointer"
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
          <div className="py-16 text-center text-zinc-400 text-xs">
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
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p
                      className={`text-sm leading-snug truncate ${
                        item.isRead ? 'font-medium text-zinc-300' : 'font-semibold text-white'
                      }`}
                    >
                      {item.title}
                    </p>
                    <span className="text-xs text-zinc-400 shrink-0">
                      {relativeTime(item.createdAt)}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-400 leading-snug">{item.message}</p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
