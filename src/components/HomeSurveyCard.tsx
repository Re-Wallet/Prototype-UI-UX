import React from 'react';
import { ArrowRight, Check, ShieldCheck } from 'lucide-react';

import type { SurveyCopy } from '../i18n/surveyCopy';

/**
 * The home card that invites the user to answer the survey.
 *
 * It is the loudest thing on the home screen on purpose: the survey is the
 * only thing on this screen that helps us build the right product, and the
 * whole point of asking inside the app is that the user answers in one tap,
 * without leaving the wallet they already opened.
 *
 * The card never blocks the balance or the transaction list — it sits
 * between them, so the money is still the first thing the user sees.
 */

interface HomeSurveyCardProps {
  copy: SurveyCopy;
  onStart: () => void;
  /**
   * Already answered in this session: the CTA turns into a thank-you.
   *
   * It never locks the card — an answered survey can always be answered
   * again, so the card stays a live invitation instead of a dead end.
   */
  completed?: boolean;
}

export const HomeSurveyCard: React.FC<HomeSurveyCardProps> = ({
  copy,
  onStart,
  completed = false,
}) => (
  <div className="px-5 pb-4">
    <button
      type="button"
      onClick={onStart}
      className={[
        'group relative w-full overflow-hidden rounded-3xl border border-[#ff5a1f]/30 text-left',
        'bg-gradient-to-br from-[#ff5a1f]/20 via-[#16110e] to-[#0d0c0b]',
        'shadow-[0_12px_40px_-12px_rgba(255,90,31,0.45)]',
        'transition-all duration-300',
        completed
          ? 'opacity-70'
          : 'hover:border-[#ff5a1f]/60 hover:shadow-[0_16px_50px_-12px_rgba(255,90,31,0.65)] active:scale-[0.99]',
      ].join(' ')}
    >
      {/* The shine: a light band crossing the card. Decorative, so it stays
          out of the accessibility tree and never steals the focus. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 skew-x-[-18deg] bg-gradient-to-r from-transparent via-white/15 to-transparent rw-shine"
      />
      {/* Warm halo in the brand colour, sitting behind the copy. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-[#ff5a1f]/25 blur-2xl animate-pulse"
      />

      <div className="relative px-4 py-4">
        <div className="mb-2 flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#ff5a1f]/40 bg-[#ff5a1f]/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#ff8a5c]">
            <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
            {copy.badge}
          </span>
          <span className="text-[11px] font-medium text-zinc-400">{copy.cardSubtitle}</span>
        </div>

        <p className="text-[15px] font-semibold leading-snug text-white">{copy.cardTitle}</p>

        {/* The call to action sits on its own row, full width: it is the
            thing the user is meant to press, and a wide target is easier to
            hit with a thumb on a phone. */}
        <span
          className={[
            'mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-all',
            completed
              ? 'bg-white/5 text-zinc-400'
              : 'bg-[#ff5a1f] text-white shadow-lg shadow-[#ff5a1f]/30 group-hover:bg-[#ff6c35]',
          ].join(' ')}
        >
          {completed ? (
            <>
              <Check className="h-4 w-4" strokeWidth={2.5} />
              {copy.successTitle}
            </>
          ) : (
            <>
              {copy.cardCta}
              <ArrowRight
                className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-0.5"
                strokeWidth={2.5}
              />
            </>
          )}
        </span>
      </div>
    </button>
  </div>
);
