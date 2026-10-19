import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { CoinIcon } from './CoinIcon';

interface KeypadProps {
  balance: number;
  value: string;
  onChange: (newValue: string) => void;
  actionLabel?: string;
  onAction?: () => void;
  actionDisabled?: boolean;
  onBack?: () => void;
  title?: string;
  subtitle?: string;
  showPresets?: boolean;
  /**
   * 'buttons': the classic +10/+30 quick amounts. 'slider': a 0 → MAX track
   * the user drags (used by Retirar; Transferir keeps the buttons).
   */
  presetStyle?: 'buttons' | 'slider';
  showBalance?: boolean;
  allowZero?: boolean;
}

/** Slider values stay 2-decimal USDC without trailing zeros ("5", "5.5", "5.25"). */
function formatSliderAmount(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? '0' : String(rounded);
}

export const Keypad: React.FC<KeypadProps> = ({
  balance,
  value,
  onChange,
  actionLabel = 'Continuar',
  onAction,
  actionDisabled = false,
  onBack,
  title,
  subtitle,
  showPresets = true,
  presetStyle = 'buttons',
  showBalance = true,
  allowZero = false,
}) => {
  // Key press handling
  const handleDigit = (digit: string) => {
    if (digit === '.') {
      if (value.includes('.')) return;
      if (value === '' || value === '0') {
        onChange('0.');
        return;
      }
    }

    if (value === '0' && digit !== '.') {
      onChange(digit);
      return;
    }

    // Limit decimal places to 2
    if (value.includes('.')) {
      const parts = value.split('.');
      if (parts[1] && parts[1].length >= 2) return;
    }

    // Max length
    if (value.replace('.', '').length >= 6) return;

    onChange(value + digit);
  };

  const handleBackspace = () => {
    if (value.length <= 1) {
      onChange('0');
    } else {
      onChange(value.slice(0, -1));
    }
  };

  const handlePreset = (amount: number) => {
    onChange(amount.toString());
  };

  const numValue = parseFloat(value) || 0;

  return (
    <div className="flex flex-col h-full justify-between text-white px-5 pt-3 pb-6">
      {/* Top Header / Balance Pill */}
      <div>
        <div className="flex items-center justify-between min-h-[44px] mb-3">
          {onBack ? (
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors text-sm font-medium py-2 px-1 rounded-lg cursor-pointer"
              aria-label="Volver"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Back</span>
            </button>
          ) : (
            <div className="w-12" />
          )}

          {/* Balance Pill like in Image 3 */}
          {showBalance ? (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#1e1e22] border border-white/10 text-xs font-medium text-zinc-300 shadow-sm">
              <span>Balance:</span>
              <CoinIcon className="w-3.5 h-3.5 text-zinc-400" />
              <span className="text-white font-semibold tabular-nums">{balance.toFixed(2)}</span>
            </div>
          ) : (
            <div className="w-12" />
          )}

          <div className="w-12" />
        </div>

        {title && (
          <div className="text-center mb-1">
            <h2 className="text-lg font-semibold text-white">{title}</h2>
            {subtitle && <p className="text-xs text-zinc-400">{subtitle}</p>}
          </div>
        )}

        {/* Big Amount Display (Matching Image 3) */}
        <div className="relative py-6 flex flex-col items-center justify-center">
          <div className="flex items-center justify-center gap-2 mb-1">
            <CoinIcon className="w-9 h-9 text-zinc-300" />
            <div className="flex items-center">
              <span className="text-[52px] leading-none font-bold text-white tabular-nums tracking-tight">
                {value || '0'}
              </span>
              <span className="inline-block w-[3px] h-10 bg-[#ff5a1f] ml-1 rounded-full animate-pulse" />
            </div>
          </div>
          <span className="text-xs text-zinc-500 font-medium uppercase tracking-wider">USDC</span>
        </div>

        {/* Amount picker: preset buttons, or a 0 → MAX slider for Retirar */}
        {showPresets && presetStyle === 'buttons' && (
          <div className="flex items-center justify-center gap-2 mb-2">
            {[10, 30, 50, 100].map((amt) => (
              <button
                key={amt}
                onClick={() => handlePreset(amt)}
                className="px-3 py-1 text-xs font-medium rounded-full bg-white/[0.05] hover:bg-white/[0.1] text-zinc-300 border border-white/[0.06] transition-colors cursor-pointer"
              >
                +Ⓢ{amt}
              </button>
            ))}
            <button
              onClick={() => handlePreset(balance)}
              className="px-3 py-1 text-xs font-semibold rounded-full bg-[#ff5a1f]/10 text-[#ff5a1f] border border-[#ff5a1f]/30 hover:bg-[#ff5a1f]/20 transition-colors cursor-pointer"
            >
              Max
            </button>
          </div>
        )}

        {showPresets && presetStyle === 'slider' && (
          <div className="mb-2 px-0.5">
            <div className="flex items-center gap-2.5">
              <span className="text-[11px] font-semibold text-zinc-500 tabular-nums shrink-0">0$</span>
              <input
                type="range"
                aria-label="Elegir monto deslizando"
                min={0}
                max={Math.max(balance, 0)}
                step={0.01}
                value={Math.min(numValue, Math.max(balance, 0))}
                onChange={(event) => onChange(formatSliderAmount(Number(event.target.value)))}
                className="flex-1 cursor-pointer accent-[#ff5a1f]"
              />
              <button
                type="button"
                onClick={() => onChange(formatSliderAmount(balance))}
                className="text-[11px] font-semibold text-[#ff5a1f] hover:text-[#ff713e] shrink-0 cursor-pointer"
              >
                MAX
              </button>
            </div>
            <div className="mt-0.5 text-center text-[10px] text-zinc-600 tabular-nums">
              {numValue.toFixed(2)} / {balance.toFixed(2)} USDC
            </div>
          </div>
        )}
      </div>

      {/* Keypad Grid (3 columns x 4 rows) */}
      <div className="max-w-[320px] w-full mx-auto my-2">
        <div className="grid grid-cols-3 gap-y-3 gap-x-6 text-center">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0'].map((key) => (
            <button
              key={key}
              onClick={() => handleDigit(key)}
              className="h-16 flex items-center justify-center text-[28px] font-medium text-white hover:bg-white/[0.06] active:bg-white/[0.12] rounded-2xl transition-all cursor-pointer select-none active:scale-95"
            >
              {key}
            </button>
          ))}

          {/* Backspace Button */}
          <button
            onClick={handleBackspace}
            className="h-16 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/[0.06] active:bg-white/[0.12] rounded-2xl transition-all cursor-pointer select-none active:scale-95"
            aria-label="Borrar dígito"
          >
            <ArrowLeft className="w-7 h-7 stroke-[2.2]" />
          </button>
        </div>
      </div>

      {/* Bottom Action CTA */}
      {onAction && (
        <div className="pt-2">
          <button
            onClick={onAction}
            disabled={actionDisabled || (!allowZero && numValue <= 0)}
            className={`w-full h-13 rounded-2xl font-semibold text-[15px] flex items-center justify-center gap-2 shadow-lg transition-all ${
              actionDisabled || (!allowZero && numValue <= 0)
                ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed shadow-none'
                : 'bg-[#ff5a1f] hover:bg-[#ff6c35] active:scale-[0.98] text-white shadow-[#ff5a1f]/25 cursor-pointer'
            }`}
          >
            <span>{actionLabel}</span>
          </button>
        </div>
      )}
    </div>
  );
};
