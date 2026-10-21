import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BUG_REPORT_REPO,
  buildBugReportBody,
  buildBugReportTitle,
  buildBugReportUrl,
  deriveBugArea,
  type BugReportDraft,
} from './bugReport';

const draft: BugReportDraft = {
  area: 'transfer',
  description: 'Le doy a Enviar y no pasa nada',
  expected: 'Que se abra la confirmación',
  context: {
    area: 'transfer',
    version: '0.0.0',
    commit: 'abc1234',
    platform: 'Mozilla/5.0 (X11; Linux x86_64)',
    language: 'es',
    network: 'Solana devnet',
    walletAddress: 'B4iJDSHPm1hsWDd4Y8dUwA9x29nKC11TtZrYi1Psg1vw',
    occurredAt: '2026-10-20T22:40:00.000Z',
  },
};

test('titles the issue with the area and the first line of the report', () => {
  assert.equal(
    buildBugReportTitle(draft),
    '[Transfer] Le doy a Enviar y no pasa nada'
  );
});

test('keeps the title short and on a single line', () => {
  const long = buildBugReportTitle({
    ...draft,
    description: 'a'.repeat(300),
  });
  assert.ok(long.length <= 100, `title was ${long.length} characters`);
  assert.ok(long.endsWith('…'));

  const multiline = buildBugReportTitle({
    ...draft,
    description: 'First line\nSecond line',
  });
  assert.equal(multiline, '[Transfer] First line');
});

test('falls back to a placeholder when the report has no description', () => {
  const title = buildBugReportTitle({ ...draft, description: '   ' });
  assert.equal(title, '[Transfer] No description');
});

test('body carries the report, the expectation and the whole context', () => {
  const body = buildBugReportBody(draft);

  assert.match(body, /### What happened\n\nLe doy a Enviar y no pasa nada/);
  assert.match(body, /### What I expected\n\nQue se abra la confirmación/);
  assert.match(body, /- Area: Transfer/);
  assert.match(body, /- Build: 0\.0\.0 \(abc1234\)/);
  assert.match(body, /- Network: Solana devnet/);
  assert.match(body, /- Language: es/);
  assert.match(body, /- Wallet: B4iJDSHPm1hsWDd4Y8dUwA9x29nKC11TtZrYi1Psg1vw/);
  assert.match(body, /- Reported at: 2026-10-20T22:40:00\.000Z/);
});

test('body says so when there is no expectation to report', () => {
  const body = buildBugReportBody({ ...draft, expected: '' });
  assert.match(body, /### What I expected\n\n_No response_/);
});

test('body never carries an account email', () => {
  const body = buildBugReportBody(draft);
  assert.doesNotMatch(body, /@/);
});

test('body says when there is no wallet to report', () => {
  const body = buildBugReportBody({
    ...draft,
    context: { ...draft.context, walletAddress: null },
  });
  assert.match(body, /- Wallet: _Not available_/);
});

test('url points at the repository issue form with the report encoded', () => {
  const url = buildBugReportUrl(draft);

  assert.ok(url.startsWith(`https://github.com/${BUG_REPORT_REPO}/issues/new?`));
  const params = new URL(url).searchParams;
  assert.equal(params.get('title'), '[Transfer] Le doy a Enviar y no pasa nada');
  assert.match(params.get('body') ?? '', /### What happened/);
  assert.equal(params.get('labels'), 'bug');
});

test('derives the area from where the user actually was', () => {
  assert.equal(deriveBugArea('home', null), 'home');
  assert.equal(deriveBugArea('transfer', null), 'transfer');
  assert.equal(deriveBugArea('activity', null), 'activity');
  assert.equal(deriveBugArea('home', 'deposit'), 'deposit');
  assert.equal(deriveBugArea('home', 'withdraw'), 'withdraw');
  assert.equal(deriveBugArea('home', 'transfer'), 'transfer');
  assert.equal(deriveBugArea('home', 'qr_scanner'), 'qr');
  assert.equal(deriveBugArea('home', 'profile'), 'other');
});
