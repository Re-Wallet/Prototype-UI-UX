/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGetWalletAccounts, useLogout, useUser } from '@dynamic-labs-sdk/react-hooks';
import { isSolanaWalletAccount } from '@dynamic-labs-sdk/solana';
import { X } from 'lucide-react';
import { Header } from './components/Header';
import { BalanceCard } from './components/BalanceCard';
import { SolanaAssetsCard } from './components/SolanaAssetsCard';
import { RecentTransactions } from './components/RecentTransactions';
import { BottomNav, NavTab } from './components/BottomNav';
import { DepositFlow } from './components/DepositFlow';
import { WithdrawFlow } from './components/WithdrawFlow';
import { TransferFlow } from './components/TransferFlow';
import { SettingsView } from './components/SettingsView';
import { AllTransactionsModal } from './components/AllTransactionsModal';
import { TransactionReceiptModal } from './components/TransactionReceiptModal';
import { NotificationToast, ToastData } from './components/NotificationToast';
import { NotificationsView } from './components/NotificationsView';
import { QrScannerFlow } from './components/QrScannerFlow';
import { HomeSurveyCard } from './components/HomeSurveyCard';
import { HomeSurveyModal } from './components/HomeSurveyModal';
import { BugReportButton } from './components/BugReportButton';
import { BugReportSheet } from './components/BugReportSheet';
import { PhoneFrame } from './components/PhoneFrame';
import { Transaction } from './types/wallet';
import { Language, translations } from './i18n/translations';
import { surveyCopy } from './i18n/surveyCopy';
import { bugAreaLabels, bugReportCopy } from './i18n/bugReportCopy';
import { deriveBugArea, type BugArea } from './services/bugReport';
import { getStoredLanguage, storeLanguage, subscribeLanguage } from './i18n/language';
import { DynamicAccountGate } from './components/DynamicAccountGate';
import { assetBySymbol, chain, type Address } from './adapters';
import { getWalletTransactions } from './services/solanaHistory';
import { fetchPaymentLinks, fetchWalletTransactions, type PaymentLinkDto } from './services/walletApi';
import { toPendingChargeTransactions } from './services/pendingCharges';
import {
  fetchNotifications,
  fetchWalletBalances,
  markNotificationsRead,
  type WalletNotification,
} from './services/walletApi';
import { WebPaymentPage } from './components/WebPaymentPage';
import { RealtimeProvider } from '@neon/realtime-react';
import { realtimeClient } from './services/realtimeClient';
import { LiveTransactionsBridge } from './components/LiveTransactionsBridge';
import { LivePaymentLinksBridge } from './components/LivePaymentLinksBridge';

/**
 * Merge transaction lists by chain identity (signature + asset), newest
 * first. One shared key for every source — REST, RPC, live Realtime rows —
 * so a fresher copy always replaces its stale twin instead of duplicating.
 */
function mergeTransactionLists(current: Transaction[], incoming: Transaction[]): Transaction[] {
  const merged = new Map<string, Transaction>();
  for (const tx of current) {
    merged.set(`${tx.txHash ?? tx.id}:${tx.assetSymbol ?? 'USDC'}`, tx);
  }
  for (const tx of incoming) {
    merged.set(`${tx.txHash ?? tx.id}:${tx.assetSymbol ?? 'USDC'}`, tx);
  }
  return [...merged.values()].sort((a, b) => b.date.getTime() - a.date.getTime());
}

export default function App() {
  /**
   * The payment page is a PUBLIC route.
   *
   * A payer opens the link on another device, without an account, and the
   * request they came to pay has to be reachable without the app's own
   * sign-in wall. Behind the account gate, the link showed "Your wallet
   * starts here" instead of the request — which read as "the app logged me
   * out again", because the tunnel and the app's origin are different
   * origins and the Dynamic session does not travel between them.
   */
  if (window.location.pathname === '/pay') {
    return (
      <div className="min-h-screen bg-[#070709] flex items-center justify-center p-0 sm:p-4 font-sans selection:bg-[#ff5a1f] selection:text-white antialiased">
        <div className="w-full flex justify-center py-2 sm:py-4">
          <PhoneFrame isFramed={true}>
            <div className="relative flex-1 flex flex-col h-full overflow-hidden">
              <WebPaymentPage onPaymentSubmitted={() => {}} />
            </div>
          </PhoneFrame>
        </div>
      </div>
    );
  }

  const tree = (
    <DynamicAccountGate>
      <WalletApp />
    </DynamicAccountGate>
  );

  // Realtime is optional (VITE_NEON_REALTIME_URL): without a client the app
  // keeps its REST + RPC transaction paths untouched.
  return realtimeClient ? (
    <RealtimeProvider client={realtimeClient}>{tree}</RealtimeProvider>
  ) : (
    tree
  );
}

function WalletApp() {
  // English is the product default; the sign-in gate persists the user's
  // choice (see src/i18n/language.ts) and the profile can change it later.
  const [language, setLanguageState] = useState<Language>(getStoredLanguage);
  const t = translations[language];

  useEffect(() => subscribeLanguage(setLanguageState), []);

  const setLanguage = (next: Language) => {
    setLanguageState(next);
    storeLanguage(next);
  };
  const { data: dynamicUser } = useUser();
  const { data: walletAccounts = [] } = useGetWalletAccounts();
  const { mutateAsync: logout } = useLogout();
  const solanaWallet = walletAccounts.find(isSolanaWalletAccount);

  const [balance, setBalance] = useState<number>(0);
  const [solBalance, setSolBalance] = useState<number>(0);
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [solBalanceError, setSolBalanceError] = useState<string | null>(null);
  const [isBalanceLoading, setIsBalanceLoading] = useState(true);
  const [isBalanceHidden, setIsBalanceHidden] = useState<boolean>(false);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isTransactionsLoading, setIsTransactionsLoading] = useState(true);
  const [transactionsError, setTransactionsError] = useState<string | null>(null);
  const [notifications, setNotifications] = useState<WalletNotification[]>([]);
  const [unreadNotifications, setUnreadNotifications] = useState<number>(0);
  const [isNotificationsLoading, setIsNotificationsLoading] = useState(true);

  /**
   * Request sequence counters.
   *
   * The balance and the transaction list are refreshed from three concurrent
   * sources (mount, Realtime, and the completion of a transfer). A response
   * carries no ordering guarantee, so a request that started BEFORE a newer
   * one can resolve AFTER it and overwrite fresher values — leaving the user
   * looking at the pre-transfer balance right after they sent money.
   *
   * Each refresh takes a ticket; a response is applied only if no newer
   * request has been issued in the meantime.
   */
  const balanceSeqRef = useRef(0);
  const transactionsSeqRef = useRef(0);

  const refreshBalance = useCallback(async (options?: { fresh?: boolean }) => {
    if (!solanaWallet) {
      setBalance(0);
      setSolBalance(0);
      setBalanceError('No se encontró la wallet Solana de esta cuenta.');
      setSolBalanceError('No se encontró la wallet Solana de esta cuenta.');
      setIsBalanceLoading(false);
      return;
    }

    const ticket = ++balanceSeqRef.current;
    setIsBalanceLoading(true);

    // Server first: the local API reads the chain through one paced, cached
    // budget shared by every wallet (see src/services/balanceCache.ts). The
    // public devnet RPC hard-limits by IP, so letting each client poke it per
    // load is what produced the 429s. Direct RPC stays as a fail-soft
    // fallback for when the local API is offline.
    const remote = await fetchWalletBalances(
      solanaWallet.address as string,
      options?.fresh === true
    );
    // A newer refresh started meanwhile: this answer is stale, drop it.
    if (ticket !== balanceSeqRef.current) return;
    if (remote) {
      setBalance(remote.usdc);
      setSolBalance(remote.sol);
      setBalanceError(null);
      setSolBalanceError(null);
      setIsBalanceLoading(false);
      return;
    }

    const usdc = assetBySymbol('USDC', chain.network().cluster);
    if (!usdc) {
      setBalanceError(`USDC no está configurado para ${chain.network().cluster}.`);
      setIsBalanceLoading(false);
      return;
    }
    const [usdcResult, solResult] = await Promise.allSettled([
      chain.getBalance(solanaWallet.address as Address, usdc),
      chain.getSolBalance(solanaWallet.address as Address),
    ]);
    // Same rule as the server path: a newer refresh started meanwhile.
    if (ticket !== balanceSeqRef.current) return;
    if (usdcResult.status === 'fulfilled') {
      setBalance(usdcResult.value.ui);
      setBalanceError(null);
    } else {
      setBalanceError(usdcResult.reason instanceof Error ? usdcResult.reason.message : String(usdcResult.reason));
    }
    if (solResult.status === 'fulfilled') {
      setSolBalance(solResult.value.ui);
      setSolBalanceError(null);
    } else {
      setSolBalanceError(solResult.reason instanceof Error ? solResult.reason.message : String(solResult.reason));
    }
    setIsBalanceLoading(false);
  }, [solanaWallet?.address]);

  const refreshTransactions = useCallback(async (silent = false) => {
    if (!solanaWallet) {
      setTransactions([]);
      setTransactionsError('No se encontró la wallet Solana de esta cuenta.');
      setIsTransactionsLoading(false);
      return;
    }

    const ticket = ++transactionsSeqRef.current;

    // A background poll must not flash the loading state over data already on
    // screen, and must not fall back to the rate-limited RPC path: it reads the
    // local DB only and leaves the current list untouched on failure.
    if (!silent) setIsTransactionsLoading(true);
    try {
      // Primary source: the local DB (webhook + sweeper projections). The
      // direct RPC path is rate-limited by the RPC provider (429s), so it is
      // only a fallback when the API is offline or returns nothing useful.
      const dbTransactions = await fetchWalletTransactions(
        solanaWallet.address as string
      );
      // A newer refresh started meanwhile: this answer is stale, drop it.
      if (ticket !== transactionsSeqRef.current) return;

      // The charges still waiting to be paid. They ride the same round trip
      // as the movements, and the silent path refreshes them too: Realtime
      // is the fast lane, this poll is the floor under it.
      const links = await fetchPaymentLinks(solanaWallet.address as string);
      if (ticket !== transactionsSeqRef.current) return;
      if (links) setPaymentLinks(links);

      if (silent) {
        if (dbTransactions) {
          setTransactions((current) => mergeTransactionLists(current, dbTransactions));
        }
        return;
      }
      const sourceTransactions =
        dbTransactions ?? (await getWalletTransactions(solanaWallet.address as Address));

      if (ticket !== transactionsSeqRef.current) return;
      setTransactions((current) => mergeTransactionLists(current, sourceTransactions));
      setTransactionsError(null);
    } catch (error) {
      if (!silent) setTransactionsError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!silent && ticket === transactionsSeqRef.current) setIsTransactionsLoading(false);
    }
  }, [solanaWallet?.address]);

  /**
   * Which live subscriptions are actually working.
   *
   * The push channel can be unreachable — a network that cannot reach the
   * Realtime socket, a proxy that refuses WebSockets, a capability that
   * expired. The app cannot fix that, but it can notice it: the poll
   * tightens when the push is not there, so the UI never goes stale just
   * because a socket could not be opened.
   */
  const [liveBridges, setLiveBridges] = useState<ReadonlySet<string>>(new Set());
  const handleRealtimeStatus = useCallback((bridge: string, live: boolean) => {
    setLiveBridges((current) => {
      if (live === current.has(bridge)) return current;
      const next = new Set(current);
      if (live) next.add(bridge);
      else next.delete(bridge);
      return next;
    });
  }, []);
  const isRealtimeLive = liveBridges.size > 0;

  // The charges this account is waiting to collect. They are links, not
  // movements: no money moved yet, so they live in the activity list as
  // pending rows and never touch the balance.
  const [paymentLinks, setPaymentLinks] = useState<PaymentLinkDto[]>([]);
  /** The charge the user tapped in the list: it reopens on the QR screen. */
  const [resumePaymentLink, setResumePaymentLink] = useState<PaymentLinkDto | null>(null);

  /**
   * What a tap on the activity list does.
   *
   * A charge that nobody paid has no receipt to show — there is no
   * signature and no money moved — so it reopens on the QR screen, ready to
   * be shared again. Everything else opens its receipt.
   */
  const handleSelectActivity = useCallback(
    (tx: Transaction) => {
      if (tx.pendingCharge) {
        const link = paymentLinks.find((item) => item.id === tx.pendingCharge?.id);
        if (link) {
          setResumePaymentLink(link);
          setActiveFlow('transfer');
          setActiveTab('home');
        }
        return;
      }
      setSelectedTransaction(tx);
    },
    [paymentLinks]
  );

  /**
   * The activity list: the movements plus the charges still waiting to be
   * paid, ordered by date.
   *
   * The pending rows are synthesized in the client, so they never reach the
   * balance or the ledger: a charge is a request, not money that moved.
   */
  const activity = useMemo(
    () =>
      [...transactions, ...toPendingChargeTransactions(paymentLinks)].sort(
        (a, b) => b.date.getTime() - a.date.getTime()
      ),
    [transactions, paymentLinks]
  );

  // Neon Realtime pushes full authoritative row snapshots after each atomic
  // batch; the shared merge key lets them replace their REST/RPC twins.
  //
  // The DB tells us *when* something changed, the chain tells us *how much*:
  // on every genuinely new batch we invalidate the cached balance and re-read
  // it from the source. The first batch is the mount snapshot, already
  // covered by the initial load, so it must not trigger a redundant refetch.
  /**
   * The charges of this account, live.
   *
   * When the webhook settles a link, the charge leaves the pending list and
   * the movement arrives through the transactions bridge: the row is replaced
   * by the real transaction without a reload.
   */
  const handleLiveLinks = useCallback((links: PaymentLinkDto[]) => {
    setPaymentLinks(links);
  }, []);

  const liveFingerprintRef = useRef<string | null>(null);
  const refreshNotifications = useCallback(async () => {
    if (!solanaWallet) {
      setNotifications([]);
      setUnreadNotifications(0);
      setIsNotificationsLoading(false);
      return;
    }

    const feed = await fetchNotifications(solanaWallet.address as string);
    // Fail-soft: when the local API is down, keep the last known feed rather
    // than blanking the bell.
    if (!feed) {
      setIsNotificationsLoading(false);
      return;
    }
    setNotifications(feed.items);
    setUnreadNotifications(feed.unread);
    setIsNotificationsLoading(false);
  }, [solanaWallet?.address]);

  const handleLiveTransactions = useCallback(
    (rows: Transaction[]) => {
      setTransactions((current) => mergeTransactionLists(current, rows));

      // Identity + status of every row: a pending→completed flip changes the
      // balance without changing the row count, so length alone is not enough.
      const fingerprint = rows
        .map((row) => `${row.id ?? row.txHash ?? ''}:${row.status}`)
        .join('|');

      if (liveFingerprintRef.current === null) {
        liveFingerprintRef.current = fingerprint;
        return;
      }
      if (liveFingerprintRef.current === fingerprint) return;

      liveFingerprintRef.current = fingerprint;
      // `fresh` bypasses the balance cache — the whole point, since a movement
      // just landed and the cached value is provably stale.
      void refreshBalance({ fresh: true });
      // The bell rides the same event: the webhook that writes a
      // notification always writes the movement too, so the notification feed
      // does not have to wait for the poll to notice it.
      void refreshNotifications();
    },
    [refreshBalance, refreshNotifications]
  );


  useEffect(() => {
    void refreshBalance();
    void refreshTransactions();
    void refreshNotifications();
  }, [refreshBalance, refreshTransactions, refreshNotifications]);

  // The webhook lands seconds after the send, so poll the local feed while the
  // app is open: both the transcript and the bell then update without a manual
  // reload. Polling pauses while the tab is hidden — an invisible tab must not
  // keep waking the Neon compute — and refetches immediately on return so the
  // user never sees a stale feed after switching back.
  useEffect(() => {
    const tick = () => {
      void refreshTransactions(true);
      void refreshNotifications();
    };
    // Realtime pushes the movements and the charges, so the poll is the floor
    // under them, not the way the UI learns about a change. When the push is
    // not working, the poll becomes the only way to hear about one — and it
    // tightens back to ten seconds instead of leaving the screen stale.
    const pollMs = isRealtimeLive ? 60_000 : 10_000;
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') tick();
    }, pollMs);

    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshTransactions, refreshNotifications, isRealtimeLive]);
  // Navigation and active flows (Navbar has only: home, transfer, activity)
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [activeFlow, setActiveFlow] = useState<
    'deposit' | 'withdraw' | 'transfer' | 'qr_scanner' | 'profile' | 'notifications' | null
  >(null);
  const [isInTransferSubflow, setIsInTransferSubflow] = useState<boolean>(false);

  // Modals & Sheets
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);

  // The in-app survey: a card on the home screen that opens the questions.
  const [isSurveyOpen, setIsSurveyOpen] = useState<boolean>(false);
  const [isSurveyDone, setIsSurveyDone] = useState<boolean>(false);

  // The bug report: available from every screen, carrying where the user
  // was when they hit the problem.
  const [isBugReportOpen, setBugReportOpen] = useState<boolean>(false);
  const [bugReportArea, setBugReportArea] = useState<BugArea>('home');

  // Helpers
  const showToast = (title: string, message: string, amount?: number) => {
    setToast({
      id: `toast-${Date.now()}`,
      title,
      message,
      amount,
    });
    setTimeout(() => {
      setToast(null);
    }, 4000);
  };

  const handleTabChange = (tab: NavTab) => {
    setActiveTab(tab);
    setActiveFlow(null);
    setIsInTransferSubflow(false);
  };

  /**
   * Open the bug report from wherever the user is.
   *
   * The area is captured at the moment they open it: the screen they were
   * on is the single most useful fact in the report, and it is gone once
   * they navigate away.
   */
  const handleOpenBugReport = () => {
    setBugReportArea(isSurveyOpen ? 'survey' : deriveBugArea(activeTab, activeFlow));
    setBugReportOpen(true);
  };

  /** Clear the badge locally, then let the API confirm the unread count. */
  const markAllNotificationsRead = async () => {
    setUnreadNotifications(0);
    setNotifications((current) => current.map((item) => ({ ...item, isRead: true })));
    if (!solanaWallet) return;
    const remaining = await markNotificationsRead(solanaWallet.address as string);
    if (remaining !== null) setUnreadNotifications(remaining);
  };

  const handleOpenNotifications = () => {
    setActiveFlow('notifications');
    if (unreadNotifications > 0) void markAllNotificationsRead();
  };

  // Transaction Event Handlers
  // No success toast here on purpose: the notification feed (fed by the
  // webhook) and the receipt modal already report a confirmed transfer.
  const handleWithdrawComplete = (newTx: Transaction) => {
    setTransactions((prev) => [newTx, ...prev]);
    // `fresh` bypasses the balance cache: the follow-up read must not be
    // served pre-transfer values.
    void refreshBalance({ fresh: true });
    void refreshTransactions();
  };

  const handleTransferComplete = (newTx: Transaction) => {
    setTransactions((prev) => [newTx, ...prev]);
    void refreshBalance({ fresh: true });
    void refreshTransactions();
  };

  const accountLabel = dynamicUser?.email
    ?? (solanaWallet ? `${solanaWallet.address.slice(0, 6)}…${solanaWallet.address.slice(-4)}` : 'Cuenta');

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      showToast(
        'Could not sign out',
        error instanceof Error ? error.message : 'Please try again.'
      );
    }
  };

  // Content renderer inside the phone screen
  const renderScreenContent = () => {
    // 1. Fullscreen Subflows
    if (activeFlow === 'deposit') {
      return (
        <DepositFlow
          solanaAddress={solanaWallet?.address}
          balanceError={balanceError}
          onClose={() => setActiveFlow(null)}
        />
      );
    }

    if (activeFlow === 'withdraw') {
      return (
        <WithdrawFlow
          balance={balance}
          balanceError={balanceError}
          balanceLoading={isBalanceLoading}
          solanaWallet={solanaWallet}
          onClose={() => setActiveFlow(null)}
          onWithdrawComplete={handleWithdrawComplete}
          t={t}
        />
      );
    }

    if (activeFlow === 'transfer') {
      return (
        <TransferFlow
          balance={balance}
          balanceError={balanceError}
          balanceLoading={isBalanceLoading}
          solanaWallet={solanaWallet}
          onClose={() => {
            setActiveFlow(null);
            setIsInTransferSubflow(false);
          }}
          onTransferComplete={handleTransferComplete}
          onSubflowChange={setIsInTransferSubflow}
          paymentLinks={paymentLinks}
          resumePaymentLink={resumePaymentLink}
          onResumePaymentLinkConsumed={() => setResumePaymentLink(null)}
        />
      );
    }

    if (activeFlow === 'qr_scanner') {
      return <QrScannerFlow onClose={() => setActiveFlow(null)} t={t} />;
    }

    // Notifications feed (bell in the Header)
    if (activeFlow === 'notifications') {
      return (
        <NotificationsView
          items={notifications}
          unread={unreadNotifications}
          loading={isNotificationsLoading}
          onClose={() => setActiveFlow(null)}
          onMarkAllRead={() => void markAllNotificationsRead()}
          onOpenTransaction={(signature) => {
            const tx = transactions.find((item) => item.txHash === signature);
            if (tx) setSelectedTransaction(tx);
          }}
          t={t}
        />
      );
    }

    // Profile (opened from the email/handle in the Header). A cross closes it
    // straight back to home — no bell here, notifications live on the home header.
    if (activeFlow === 'profile') {
      return (
        <div className="h-full flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-5 pt-3 pb-1 shrink-0">
            <button
              onClick={() => setActiveFlow(null)}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-[#1e1e22] border border-white/10 hover:border-white/25 hover:text-white text-zinc-300 active:scale-[0.95] transition-all cursor-pointer"
              aria-label="Cerrar perfil"
            >
              <X className="w-4 h-4" />
            </button>
            <h1 className="text-lg font-semibold text-white tracking-tight">Perfil</h1>
            <div className="w-8" />
          </div>
          <div className="flex-1 min-h-0">
            <SettingsView
              onLogout={handleLogout}
              language={language}
              onLanguageChange={setLanguage}
              t={t}
              dynamicEmail={dynamicUser?.email ?? undefined}
              solanaAddress={solanaWallet?.address}
            />
          </div>
        </div>
      );
    }

    // 2. Tab Navigation Screens (Home, Transfer, Activity inside phone)
    if (activeTab === 'transfer') {
      return (
        <TransferFlow
          balance={balance}
          balanceError={balanceError}
          balanceLoading={isBalanceLoading}
          solanaWallet={solanaWallet}
          onClose={() => {
            setActiveTab('home');
            setIsInTransferSubflow(false);
          }}
          onTransferComplete={handleTransferComplete}
          onSubflowChange={setIsInTransferSubflow}
          paymentLinks={paymentLinks}
          resumePaymentLink={resumePaymentLink}
          onResumePaymentLinkConsumed={() => setResumePaymentLink(null)}
        />
      );
    }

    // Activity tab: full transaction history (also reached from "See All")
    if (activeTab === 'activity') {
      return (
        <AllTransactionsModal
          transactions={activity}
          onSelectTransaction={handleSelectActivity}
          onClose={() => setActiveTab('home')}
        />
      );
    }

    // Default Home Screen (Pixel-accurate to uploaded screenshots)
    return (
      <div className="h-full overflow-y-auto select-none">
        <Header
          handle={accountLabel}
          onOpenProfile={() => setActiveFlow('profile')}
          onOpenNotifications={handleOpenNotifications}
          unreadCount={unreadNotifications}
        />

        <BalanceCard
          balance={balance}
          balanceLoading={isBalanceLoading}
          isBalanceHidden={isBalanceHidden}
          onDeposit={() => setActiveFlow('deposit')}
          onWithdraw={() => setActiveFlow('withdraw')}
          t={t}
        />
        {balanceError && (
          <p role="alert" className="mx-5 mb-3 text-xs text-red-300">
            No se pudo leer el balance de tu wallet Solana: {balanceError}
          </p>
        )}
        {solBalanceError && (
          <p role="alert" className="mx-5 mb-3 text-xs text-red-300">
            No se pudo leer el saldo SOL de tu wallet: {solBalanceError}
          </p>
        )}
        {isBalanceLoading && (
          <p aria-live="polite" className="mx-5 mb-3 text-xs text-zinc-400">
            Consultando el balance de tu wallet Solana…
          </p>
        )}

        <HomeSurveyCard
          copy={surveyCopy[language]}
          onStart={() => setIsSurveyOpen(true)}
          completed={isSurveyDone}
        />

        <SolanaAssetsCard
          balance={balance}
          solBalance={solBalance}
          balanceLoading={isBalanceLoading}
          isBalanceHidden={isBalanceHidden}
          t={t}
        />

        <RecentTransactions
          transactions={activity}
          onSelectTransaction={handleSelectActivity}
          onSeeAll={() => setActiveTab('activity')}
          t={t}
          loading={isTransactionsLoading}
          error={transactionsError}
        />
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#070709] flex items-center justify-center p-0 sm:p-4 font-sans selection:bg-[#ff5a1f] selection:text-white antialiased">
      {/* Centered Phone Frame */}
      <div className="w-full flex justify-center py-2 sm:py-4">
        <PhoneFrame isFramed={true}>
          {/* Notification Toast */}
          <NotificationToast toast={toast} onDismiss={() => setToast(null)} />

          {/* Invisible: live DB → UI propagation over Neon Realtime */}
          {solanaWallet && realtimeClient && (
            <LiveTransactionsBridge
              walletAddress={solanaWallet.address as string}
              onRows={handleLiveTransactions}
              onStatus={(live) => handleRealtimeStatus('transactions', live)}
            />
          )}

          {/* The charges of this account, live. The webhook settles a link
              and this is what makes the pending row vanish in real time. */}
          {solanaWallet && realtimeClient && (
            <LivePaymentLinksBridge
              walletAddress={solanaWallet.address as string}
              onLinks={handleLiveLinks}
              onStatus={(live) => handleRealtimeStatus('paymentLinks', live)}
            />
          )}

          {/* Screen Content */}
          <div className="relative flex-1 flex flex-col h-full overflow-hidden">
            {renderScreenContent()}

            {/* Bottom Nav Bar (Home, Transfer, Activity) - Hidden on /pay route */}
            {activeFlow === null && (!isInTransferSubflow || activeTab !== 'transfer') && window.location.pathname !== '/pay' && (
              <BottomNav
                activeTab={activeTab}
                onTabChange={handleTabChange}
                onOpenQrScanner={() => setActiveFlow('qr_scanner')}
                t={t}
              />
            )}

            {/* Transaction Receipt Modal - Rendered strictly inside phone interface */}
            {selectedTransaction && (
              <TransactionReceiptModal
                transaction={selectedTransaction}
                onClose={() => setSelectedTransaction(null)}
                userEmail={dynamicUser?.email ?? null}
              />
            )}

            {/* The survey - also inside the phone interface, over the home */}
            {isSurveyOpen && (
              <HomeSurveyModal
                copy={surveyCopy[language]}
                identity={{
                  email: dynamicUser?.email,
                  firstName: dynamicUser?.firstName,
                  lastName: dynamicUser?.lastName,
                }}
                onClose={() => {
                  setIsSurveyOpen(false);
                  // Closing hands the card its CTA back. The answers are not
                  // persisted yet, so the next survey starts from scratch —
                  // no page reload needed to answer again.
                  setIsSurveyDone(false);
                }}
                onSubmitted={() => setIsSurveyDone(true)}
              />
            )}

            {/* The bug report entry - floating, so it is reachable from
                every screen of the app, not only from the settings. */}
            {window.location.pathname !== '/pay' && (
              <BugReportButton
                onClick={handleOpenBugReport}
                label={bugReportCopy[language].title}
              />
            )}

            {isBugReportOpen && (
              <BugReportSheet
                copy={bugReportCopy[language]}
                areaLabels={bugAreaLabels[language]}
                initialArea={bugReportArea}
                context={{
                  version: __APP_VERSION__,
                  commit: __APP_COMMIT__,
                  platform: navigator.userAgent,
                  language,
                  network: chain.describeNetwork(),
                  walletAddress: (solanaWallet?.address as string) ?? null,
                  occurredAt: new Date().toISOString(),
                }}
                onClose={() => setBugReportOpen(false)}
              />
            )}
          </div>
        </PhoneFrame>
      </div>
    </div>
  );
}
