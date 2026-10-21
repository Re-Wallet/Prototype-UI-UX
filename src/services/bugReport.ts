/**
 * In-app bug reporting.
 *
 * The user reports a problem from wherever they hit it, and the report lands
 * in the repository's GitHub issues with the session context attached — the
 * screen they were on, the exact build, the platform and the wallet. Without
 * that context, half of the reports are unanswerable ("it didn't work" is not
 * a bug report).
 *
 * The issue is created by the user, from their own GitHub account: the app
 * opens GitHub's new-issue page with the title, the body and the `bug` label
 * already filled in, and the user presses submit. That keeps the reporter
 * attached to the issue — the person who found it is the person GitHub
 * notifies and assigns — and it needs no token living in the app.
 *
 * The privacy rule this module enforces: the report carries the public
 * wallet address (it is on-chain, anyone can read it) and never the account
 * email, which would publish a private identity into a public repository.
 */

export const BUG_REPORT_REPO = 'Re-Wallet/Prototype-UI-UX';

/** The screens a report can be filed against. */
export const BUG_AREAS = [
  'home',
  'transfer',
  'deposit',
  'withdraw',
  'qr',
  'activity',
  'survey',
  'other',
] as const;

export type BugArea = (typeof BUG_AREAS)[number];

/**
 * The area tokens are technical labels: they land in the issue title, where
 * English keeps them parseable and greppable for whoever triages.
 */
export const BUG_AREA_LABELS: Record<BugArea, string> = {
  home: 'Home',
  transfer: 'Transfer',
  deposit: 'Deposit',
  withdraw: 'Withdraw',
  qr: 'QR',
  activity: 'Activity',
  survey: 'Survey',
  other: 'Other',
};

export interface BugReportContext {
  /** Where the user was when they hit the problem. */
  area: BugArea;
  /** The app version they were running. */
  version: string;
  /** The commit the build came from. */
  commit: string;
  /** Browser and platform, as the browser reports them. */
  platform: string;
  /** The language the app was showing. */
  language: string;
  /** The chain the wallet was on. */
  network: string;
  /** The public wallet address, when there is one. */
  walletAddress: string | null;
  /** When the report was written. */
  occurredAt: string;
}

export interface BugReportDraft {
  area: BugArea;
  /** What the user typed: what happened. */
  description: string;
  /** What the user typed: what they expected instead. */
  expected: string;
  context: BugReportContext;
}

/** GitHub titles stay readable when they fit a line; longer gets clipped. */
const MAX_TITLE_LENGTH = 100;

const NO_RESPONSE = '_No response_';

function firstLine(value: string): string {
  return value.split('\n')[0] ?? '';
}

/** `[Transfer] Le doy a Enviar y no pasa nada` */
export function buildBugReportTitle(draft: BugReportDraft): string {
  const prefix = `[${BUG_AREA_LABELS[draft.context.area]}] `;
  const summary = firstLine(draft.description).trim() || 'No description';
  // The cap covers the whole title, prefix included — GitHub renders one
  // line of it in the issue list.
  const room = Math.max(1, MAX_TITLE_LENGTH - prefix.length);
  const clipped =
    summary.length > room ? `${summary.slice(0, room - 1).trimEnd()}…` : summary;
  return `${prefix}${clipped}`;
}

/**
 * The issue body.
 *
 * The headings are the ones GitHub's own issue forms use, so the report
 * reads the same as a form-filled issue and stays greppable later.
 */
export function buildBugReportBody(draft: BugReportDraft): string {
  const { context } = draft;
  const description = draft.description.trim() || NO_RESPONSE;
  const expected = draft.expected.trim() || NO_RESPONSE;

  return [
    '### What happened',
    '',
    description,
    '',
    '### What I expected',
    '',
    expected,
    '',
    '### Context',
    '',
    `- Area: ${BUG_AREA_LABELS[context.area]}`,
    `- Build: ${context.version} (${context.commit})`,
    `- Platform: ${context.platform}`,
    `- Language: ${context.language}`,
    `- Network: ${context.network}`,
    `- Wallet: ${context.walletAddress ?? '_Not available_'}`,
    `- Reported at: ${context.occurredAt}`,
  ].join('\n');
}

/**
 * The GitHub "new issue" URL with everything already filled in.
 *
 * `labels=bug` asks GitHub to pre-tick the label the repository already
 * defines, so the report lands in the triage queue instead of an unlabelled
 * pile.
 */
export function buildBugReportUrl(draft: BugReportDraft): string {
  const params = new URLSearchParams({
    title: buildBugReportTitle(draft),
    body: buildBugReportBody(draft),
    labels: 'bug',
  });
  return `https://github.com/${BUG_REPORT_REPO}/issues/new?${params.toString()}`;
}

/**
 * Open the pre-filled issue page in a new tab.
 *
 * Returns false when the browser blocked the popup, so the caller can offer
 * the copy-the-report fallback instead of pretending it worked.
 */
export function openBugReport(draft: BugReportDraft): boolean {
  const opened = window.open(buildBugReportUrl(draft), '_blank', 'noopener,noreferrer');
  return opened !== null;
}

/**
 * Where the user was, from the app's own navigation state.
 *
 * A flow wins over the tab: the user is in the deposit flow, not on the
 * home tab, when they report that depositing fails.
 */
export function deriveBugArea(
  tab: 'home' | 'transfer' | 'activity',
  flow: string | null
): BugArea {
  switch (flow) {
    case 'deposit':
      return 'deposit';
    case 'withdraw':
      return 'withdraw';
    case 'transfer':
      return 'transfer';
    case 'qr_scanner':
      return 'qr';
    case 'profile':
    case 'notifications':
      return 'other';
    default:
      return tab;
  }
}
