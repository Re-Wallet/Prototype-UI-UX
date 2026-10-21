import React from 'react';
import { Bug } from 'lucide-react';

/**
 * The button that opens the bug report.
 *
 * It floats over the whole app instead of living inside one screen, because
 * the moment a bug happens is exactly the screen the user is on — a report
 * entry buried in the settings is a report nobody files.
 *
 * It sits above the navigation row and stays small and muted: it is chrome,
 * not content, and it must never read as if it belonged to the balance or to
 * a transaction.
 */
export const BugReportButton: React.FC<{ onClick: () => void; label: string }> = ({
  onClick,
  label,
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    className="absolute bottom-24 right-4 z-40 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-[#1e1e22]/85 text-zinc-500 backdrop-blur transition-all hover:border-[#ff5a1f]/50 hover:text-[#ff5a1f] active:scale-95 cursor-pointer"
  >
    <Bug className="h-4 w-4" />
  </button>
);
