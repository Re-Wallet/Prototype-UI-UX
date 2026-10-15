import React from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { CoinIcon } from './CoinIcon';

export interface ToastData {
  id: string;
  title: string;
  message: string;
  amount?: number;
}

interface NotificationToastProps {
  toast: ToastData | null;
  onDismiss: () => void;
}

export const NotificationToast: React.FC<NotificationToastProps> = ({ toast, onDismiss }) => {
  if (!toast) return null;

  return (
    <aside
      role="status"
      aria-live="polite"
      className="absolute top-2 left-3 right-3 z-50 flex justify-center pointer-events-none animate-in fade-in slide-in-from-top-4 duration-300"
    >
      <div className="pointer-events-auto max-w-sm w-full p-2.5 rounded-2xl bg-[#1c1c1f]/95 backdrop-blur-xl border border-white/10 text-white shadow-2xl flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-full bg-[#10b981]/20 border border-[#10b981]/30 flex items-center justify-center text-[#10b981] shrink-0">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h4 className="text-xs font-bold text-white leading-tight truncate">
              {toast.title}
            </h4>
            <p className="text-[11px] text-zinc-300 leading-tight truncate">
              {toast.message}
            </p>
          </div>
        </div>

        {toast.amount && (
          <div className="flex items-center gap-1 text-[#26e5c8] font-bold text-xs shrink-0 tabular-nums">
            <CoinIcon className="w-3.5 h-3.5" />
            <span>+{toast.amount.toFixed(2)}</span>
          </div>
        )}

        <button
          onClick={onDismiss}
          className="p-1 text-zinc-400 hover:text-white transition-colors shrink-0 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </aside>
  );
};
