import React, { useState } from 'react';
import { Check, ShieldCheck, X } from 'lucide-react';

import type { SurveyCopy, SurveyOptionCopy } from '../i18n/surveyCopy';
import {
  EMPTY_SURVEY_ANSWERS,
  buildSurveyPayload,
  missingSurveyAnswers,
  submitSurvey,
  type SurveyAnswers,
  type SurveyIdentity,
} from '../services/survey';

/**
 * The survey, answered inside the app.
 *
 * The landing page runs the same four questions as a five-step wizard that
 * starts by asking for name, last name and email. Inside the app that first
 * step is pointless: the account already knows who the user is, so the flow
 * opens straight on the questions and every one of them fits on one screen.
 *
 * Nothing is persisted yet — `submitSurvey` is the seam where the database
 * connection goes.
 */

interface HomeSurveyModalProps {
  copy: SurveyCopy;
  /** Taken from the signed-in account; the user never types it. */
  identity: SurveyIdentity;
  onClose: () => void;
  onSubmitted: () => void;
}

/* -------------------------------------------------------------------------
 * Option blocks
 * ---------------------------------------------------------------------- */

interface SingleChoiceProps<T extends string> {
  legend: string;
  options: SurveyOptionCopy<T>[];
  selected: T | null;
  onSelect: (value: T) => void;
  optional?: boolean;
  optionalTag?: string;
  invalid?: boolean;
}

function SingleChoice<T extends string>({
  legend,
  options,
  selected,
  onSelect,
  optional = false,
  optionalTag,
  invalid = false,
}: SingleChoiceProps<T>) {
  return (
    <fieldset className="mb-5">
      <legend className="mb-2 flex items-start gap-2 text-[13px] font-semibold leading-snug text-white">
        <span>{legend}</span>
        {optional && (
          <span className="mt-0.5 shrink-0 rounded border border-white/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-zinc-400">
            {optionalTag}
          </span>
        )}
      </legend>
      <div className="flex flex-col gap-1.5">
        {options.map((option) => {
          const isSelected = selected === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onSelect(option.value)}
              aria-pressed={isSelected}
              className={[
                'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-[13px] leading-snug transition-all',
                isSelected
                  ? 'border-[#ff5a1f] bg-[#ff5a1f]/15 text-white'
                  : 'border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/20',
                invalid && !isSelected ? 'border-red-500/40' : '',
              ].join(' ')}
            >
              <span
                aria-hidden="true"
                className={[
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                  isSelected ? 'border-[#ff5a1f] bg-[#ff5a1f]' : 'border-white/25',
                ].join(' ')}
              >
                {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
              </span>
              <span className="flex-1">{option.label}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

interface MultiChoiceProps<T extends string> {
  legend: string;
  options: SurveyOptionCopy<T>[];
  selected: T[];
  onToggle: (value: T) => void;
  hint?: string;
  invalid?: boolean;
}

function MultiChoice<T extends string>({
  legend,
  options,
  selected,
  onToggle,
  hint,
  invalid = false,
}: MultiChoiceProps<T>) {
  return (
    <fieldset className="mb-5">
      <legend className="mb-1 text-[13px] font-semibold leading-snug text-white">{legend}</legend>
      {hint && <p className="mb-2 text-[11px] text-zinc-500">{hint}</p>}
      <div className="flex flex-col gap-1.5">
        {options.map((option) => {
          const isSelected = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onToggle(option.value)}
              aria-pressed={isSelected}
              className={[
                'flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left text-[13px] leading-snug transition-all',
                isSelected
                  ? 'border-[#ff5a1f] bg-[#ff5a1f]/15 text-white'
                  : 'border-white/10 bg-white/[0.03] text-zinc-300 hover:border-white/20',
                invalid && !isSelected ? 'border-red-500/40' : '',
              ].join(' ')}
            >
              <span
                aria-hidden="true"
                className={[
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors',
                  isSelected ? 'border-[#ff5a1f] bg-[#ff5a1f] text-white' : 'border-white/25',
                ].join(' ')}
              >
                {isSelected && <Check className="h-3 w-3" strokeWidth={3} />}
              </span>
              <span className="flex-1">{option.label}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

/* -------------------------------------------------------------------------
 * The survey
 * ---------------------------------------------------------------------- */

export const HomeSurveyModal: React.FC<HomeSurveyModalProps> = ({
  copy,
  identity,
  onClose,
  onSubmitted,
}) => {
  const [answers, setAnswers] = useState<SurveyAnswers>(EMPTY_SURVEY_ANSWERS);
  const [error, setError] = useState<'incomplete' | 'identity' | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isDone, setIsDone] = useState(false);

  const missing = missingSurveyAnswers(answers);
  const showMissing = error === 'incomplete';

  const handleSubmit = async () => {
    const payload = buildSurveyPayload(answers, identity);
    if (!payload) {
      // Nothing is sent with an unanswered question: the survey is the only
      // thing we learn from the user, so a half answer is worth nothing.
      // A complete answer with no payload means the account gave us no
      // email to attribute it to — a different problem, a different message.
      setError(missing.length > 0 ? 'incomplete' : 'identity');
      return;
    }

    setError(null);
    setIsSending(true);
    await submitSurvey(payload);
    setIsSending(false);
    setIsDone(true);
    onSubmitted();
  };

  if (isDone) {
    return (
      <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-[#070709]/97 px-8 text-center backdrop-blur-md animate-in fade-in">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-[#ff5a1f]/15 text-[#ff5a1f]">
          <Check className="h-8 w-8" strokeWidth={2.5} />
        </span>
        <div>
          <p className="text-lg font-semibold text-white">{copy.successTitle}</p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">{copy.successBody}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-11 w-full max-w-[220px] rounded-xl bg-[#ff5a1f] text-sm font-semibold text-white transition-colors hover:bg-[#ff6c35]"
        >
          {copy.successCta}
        </button>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#070709]/97 backdrop-blur-md animate-in fade-in">
      {/* Header */}
      <div className="shrink-0 px-5 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#ff5a1f]/40 bg-[#ff5a1f]/15 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#ff8a5c]">
              <ShieldCheck className="h-3 w-3" strokeWidth={2.5} />
              {copy.badge}
            </span>
            <h2 className="mt-2 text-lg font-semibold text-white">{copy.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar encuesta"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-zinc-400">{copy.intro}</p>
        <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500">{copy.privacy}</p>
      </div>

      {/* Questions — all of them on one screen, no wizard, no page turns. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        <SingleChoice
          legend={copy.questions.q1.legend}
          options={copy.questions.q1.options}
          selected={answers.q1}
          onSelect={(value) => setAnswers((current) => ({ ...current, q1: value }))}
          invalid={showMissing && missing.includes('q1')}
        />

        <MultiChoice
          legend={copy.questions.q2.legend}
          options={copy.questions.q2.options}
          selected={answers.q2}
          onToggle={(value) =>
            setAnswers((current) => ({
              ...current,
              q2: current.q2.includes(value)
                ? current.q2.filter((item) => item !== value)
                : [...current.q2, value],
            }))
          }
          hint={copy.multipleHint}
          invalid={showMissing && missing.includes('q2')}
        />

        <SingleChoice
          legend={copy.questions.q3.legend}
          options={copy.questions.q3.options}
          selected={answers.q3}
          onSelect={(value) => setAnswers((current) => ({ ...current, q3: value }))}
          invalid={showMissing && missing.includes('q3')}
        />

        <SingleChoice
          legend={copy.questions.q4.legend}
          options={copy.questions.q4.options}
          selected={answers.q4}
          onSelect={(value) => setAnswers((current) => ({ ...current, q4: value }))}
          optional
          optionalTag={copy.optionalTag}
        />
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-white/10 px-5 pb-5 pt-3">
        {error !== null && (
          <p role="alert" className="mb-2 text-[11px] text-red-300">
            {error === 'incomplete' ? copy.errorIncomplete : copy.errorIdentity}
          </p>
        )}
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={isSending}
          className="h-12 w-full rounded-xl bg-[#ff5a1f] text-sm font-bold tracking-wide text-white shadow-lg shadow-[#ff5a1f]/25 transition-all hover:bg-[#ff6c35] active:scale-[0.99] disabled:opacity-60"
        >
          {isSending ? copy.sending : copy.submit}
        </button>
      </div>
    </div>
  );
};
