/**
 * The "Volver al inicio" button.
 *
 * Shared by the payment request screen and the "Pago recibido" screen so
 * both read as the same moment of the same flow: the same label, the same
 * icon, the same placement at the end of the screen, the same colour.
 *
 * It is the brand's orange so it is unmistakably tappable on both screens.
 * On the payment request screen the primary action is "Pagar", so this one
 * carries no shadow and no scale — it reads as the way out, not as a second
 * call to action competing with the payment itself.
 */

import React from 'react';
import { ArrowLeft } from 'lucide-react';

interface BackToHomeButtonProps {
  onClick: () => void;
  className?: string;
}

export const BackToHomeButton: React.FC<BackToHomeButtonProps> = ({ onClick, className = '' }) => (
  <button
    onClick={onClick}
    className={`flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#ff5a1f] hover:bg-[#ff6c35] active:scale-[0.98] text-sm font-semibold text-white transition-all cursor-pointer ${className}`}
  >
    <ArrowLeft className="h-4 w-4" />
    <span>Volver al inicio</span>
  </button>
);
