import React, { useState } from 'react';
import { Bug, ChevronDown, ChevronUp, Copy, ExternalLink, X } from 'lucide-react';

import type { BugReportCopy } from '../i18n/bugReportCopy';
import {
  BUG_AREAS,
  buildBugReportBody,
  buildBugReportTitle,
  openBugReport,
  type BugArea,
  type BugReportContext,
  type BugReportDraft,
} from '../services/bugReport';

interface BugReportSheetProps {
  copy: BugReportCopy;
  /** The area chip labels, in the app's language. */
  areaLabels: Record<string, string>;
  /** The screen the user was on when they opened the report. */
  initialArea: BugArea;
  /** Everything but the area, which the user can change. */
  context: Omit<BugReportContext, 'area'>;
  onClose: () => void;
}

type Status = 'editing' | 'opened' | 'blocked';

/**
 * The bug report sheet.
 *
 * It collects the two things a human triage needs — what happened and what
 * was expected — and attaches the session context the app already knows, so
 * the user is not asked for a version number or a cluster name they have no
 * way of knowing.
 */
export const BugReportSheet: React.FC<BugReportSheetProps> = ({
  copy,
  areaLabels,
  initialArea,
  context,
  onClose,
}) => {
  const [area, setArea] = useState<BugArea>(initialArea);
  const [description, setDescription] = useState('');
  const [expected, setExpected] = useState('');
  const [showContext, setShowContext] = useState(false);
  const [status, setStatus] = useState<Status>('editing');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const buildDraft = (): BugReportDraft => ({
    area,
    description,
    expected,
    context: { ...context, area },
  });

  const handleOpen = () => {
    if (!description.trim()) {
      setError(copy.errorEmpty);
      return;
    }
    setError(null);
    const opened = openBugReport(buildDraft());
    setStatus(opened ? 'opened' : 'blocked');
  };

  const handleCopy = async () => {
    const draft = buildDraft();
    const text = `${buildBugReportTitle(draft)}\n\n${buildBugReportBody(draft)}`;
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-[#070709]/97 backdrop-blur-md animate-in fade-in">
      {/* Header */}
      <div className="shrink-0 px-5 pb-3 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[#ff5a1f]/40 bg-[#ff5a1f]/15 text-[#ff8a5c]">
              <Bug className="h-4 w-4" />
            </span>
            <h2 className="text-lg font-semibold text-white">{copy.title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={copy.close}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-zinc-400">{copy.subtitle}</p>
      </div>

      {status === 'editing' ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
            {/* Where it happened */}
            <fieldset className="mb-4">
              <legend className="mb-2 text-[13px] font-semibold text-white">
                {copy.areaLabel}
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {BUG_AREAS.map((option) => {
                  const isSelected = option === area;
                  return (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setArea(option)}
                      aria-pressed={isSelected}
                      className={[
                        'rounded-full border px-3 py-1.5 text-[12px] font-medium transition-all',
                        isSelected
                          ? 'border-[#ff5a1f] bg-[#ff5a1f]/15 text-white'
                          : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:border-white/25 hover:text-zinc-200',
                      ].join(' ')}
                    >
                      {areaLabels[option] ?? option}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {/* What happened */}
            <label className="mb-4 block">
              <span className="mb-2 block text-[13px] font-semibold text-white">
                {copy.whatLabel}
              </span>
              <textarea
                value={description}
                onChange={(event) => {
                  setDescription(event.target.value);
                  setError(null);
                }}
                rows={4}
                placeholder={copy.whatPlaceholder}
                className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-[13px] leading-relaxed text-white placeholder:text-zinc-500 focus:border-[#ff5a1f]/60 focus:outline-none"
              />
            </label>

            {/* What was expected */}
            <label className="mb-4 block">
              <span className="mb-2 block text-[13px] font-semibold text-white">
                {copy.expectedLabel}
              </span>
              <textarea
                value={expected}
                onChange={(event) => setExpected(event.target.value)}
                rows={3}
                placeholder={copy.expectedPlaceholder}
                className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-[13px] leading-relaxed text-white placeholder:text-zinc-500 focus:border-[#ff5a1f]/60 focus:outline-none"
              />
            </label>

            {/* Context */}
            <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
              <button
                type="button"
                onClick={() => setShowContext((current) => !current)}
                className="flex w-full items-center justify-between text-[12px] font-medium text-zinc-300"
              >
                {copy.contextLabel}
                {showContext ? (
                  <ChevronUp className="h-4 w-4 text-zinc-500" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-zinc-500" />
                )}
              </button>
              {showContext && (
                <dl className="mt-2 space-y-1 text-[11px] text-zinc-400">
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-zinc-500">Build</dt>
                    <dd className="break-all">
                      {context.version} ({context.commit})
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-zinc-500">Network</dt>
                    <dd>{context.network}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-zinc-500">Language</dt>
                    <dd>{context.language}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-zinc-500">Wallet</dt>
                    <dd className="break-all">{context.walletAddress ?? '—'}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-20 shrink-0 text-zinc-500">Platform</dt>
                    <dd className="break-all">{context.platform}</dd>
                  </div>
                </dl>
              )}
            </div>

            <p className="text-[11px] leading-relaxed text-zinc-500">{copy.privacyNote}</p>
          </div>

          {/* Footer */}
          <div className="shrink-0 border-t border-white/10 px-5 pb-5 pt-3">
            {error && (
              <p role="alert" className="mb-2 text-[11px] text-red-300">
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={handleOpen}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#ff5a1f] text-sm font-bold tracking-wide text-white shadow-lg shadow-[#ff5a1f]/25 transition-all hover:bg-[#ff6c35] active:scale-[0.99]"
            >
              <ExternalLink className="h-4 w-4" strokeWidth={2.5} />
              {copy.submit}
            </button>
          </div>
        </>
      ) : (
        /* Result: GitHub opened, or the popup was blocked */
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#ff5a1f]/15 text-[#ff5a1f]">
            <Bug className="h-7 w-7" />
          </span>
          <p className="text-[13px] leading-relaxed text-zinc-300">
            {status === 'opened' ? copy.opened : copy.blocked}
          </p>
          <div className="flex w-full flex-col gap-2">
            <button
              type="button"
              onClick={handleOpen}
              className="flex h-11 items-center justify-center gap-2 rounded-xl bg-[#ff5a1f] text-sm font-semibold text-white transition-colors hover:bg-[#ff6c35]"
            >
              <ExternalLink className="h-4 w-4" strokeWidth={2.5} />
              {copy.openAgain}
            </button>
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] text-sm font-semibold text-zinc-200 transition-colors hover:bg-white/[0.08]"
            >
              <Copy className="h-4 w-4" strokeWidth={2.5} />
              {copied ? copy.copied : copy.copyReport}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="h-11 w-full text-sm font-medium text-zinc-400 transition-colors hover:text-white"
            >
              {copy.close}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
