/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useGetWalletAccounts, useLogout, useUser } from '@dynamic-labs-sdk/react-hooks';
import { isSolanaWalletAccount } from '@dynamic-labs-sdk/solana';
import { X } from 'lucide-react';
import { Header } from './components/Header';
import { BalanceCard } from './components/BalanceCard';
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
import { PhoneFrame } from './components/PhoneFrame';
import { Transaction } from './types/wallet';
import { Language, translations } from './i18n/translations';
import { getStoredLanguage, storeLanguage, subscribeLanguage } from './i18n/language';
import { DynamicAccountGate } from './components/DynamicAccountGate';
import { assetBySymbol, chain, type Address } from './adapters';
import { getWalletTransactions } from './services/solanaHistory';
import { fetchWalletTransactions } from './services/walletApi';
import {
  fetchNotifications,
  fetchWalletBalances,
  markNotificationsRead,
  type WalletNotification,
} from './services/walletApi';
import { WebPaymentPage } from './components/WebPaymentPage';

export default function App() {
  return (
    <DynamicAccountGate>
      <WalletApp />
    </DynamicAccountGate>
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

  const refreshBalance = useCallback(async (options?: { fresh?: boolean }) => {
    if (!solanaWallet) {
      setBalance(0);
      setSolBalance(0);
      setBalanceError('No se encontró la wallet Solana de esta cuenta.');
      setSolBalanceError('No se encontró la wallet Solana de esta cuenta.');
      setIsBalanceLoading(false);
      return;
    }

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

  const refreshTransactions = useCallback(async () => {
    if (!solanaWallet) {
      setTransactions([]);
      setTransactionsError('No se encontró la wallet Solana de esta cuenta.');
      setIsTransactionsLoading(false);
      return;
    }

    setIsTransactionsLoading(true);
    try {
      // Primary source: the local DB (webhook + sweeper projections). The
      // direct RPC path is rate-limited by the RPC provider (429s), so it is
      // only a fallback when the API is offline or returns nothing useful.
      const dbTransactions = await fetchWalletTransactions(
        solanaWallet.address as string
      );
      const sourceTransactions =
        dbTransactions ?? (await getWalletTransactions(solanaWallet.address as Address));

      setTransactions((current) => {
        const merged = new Map<string, Transaction>();
        for (const tx of current) {
          merged.set(`${tx.txHash ?? tx.id}:${tx.assetSymbol ?? 'USDC'}`, tx);
        }
        for (const tx of sourceTransactions) {
          merged.set(`${tx.txHash ?? tx.id}:${tx.assetSymbol ?? 'USDC'}`, tx);
        }
        return [...merged.values()].sort((a, b) => b.date.getTime() - a.date.getTime());
      });
      setTransactionsError(null);
    } catch (error) {
      setTransactionsError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsTransactionsLoading(false);
    }
  }, [solanaWallet?.address]);

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

  useEffect(() => {
    void refreshBalance();
    void refreshTransactions();
    void refreshNotifications();
  }, [refreshBalance, refreshTransactions, refreshNotifications]);

  // The webhook lands seconds after the send, so poll the local feed while the
  // app is open: the bell badge then appears without a manual reload.
  useEffect(() => {
    const interval = setInterval(() => void refreshNotifications(), 20_000);
    return () => clearInterval(interval);
  }, [refreshNotifications]);
  // Navigation and active flows (Navbar has only: home, transfer, activity)
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [activeFlow, setActiveFlow] = useState<
    'deposit' | 'withdraw' | 'transfer' | 'qr_scanner' | 'profile' | 'notifications' | null
  >(null);
  const [isInTransferSubflow, setIsInTransferSubflow] = useState<boolean>(false);

  // Modals & Sheets
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);

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
    if (window.location.pathname === '/pay') {
      return <WebPaymentPage onPaymentSubmitted={handleTransferComplete} />;
    }

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
            <h1 className="text-[17px] font-semibold text-white tracking-tight">Perfil</h1>
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
        />
      );
    }

    // Activity tab: full transaction history (also reached from "See All")
    if (activeTab === 'activity') {
      return (
        <AllTransactionsModal
          transactions={transactions}
          onSelectTransaction={(tx) => setSelectedTransaction(tx)}
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
          solBalance={solBalance}
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

        <RecentTransactions
          transactions={transactions}
          onSelectTransaction={(tx) => setSelectedTransaction(tx)}
          onSeeAll={() => setActiveTab('activity')}
          onRefresh={() => void refreshTransactions()}
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
          </div>
        </PhoneFrame>
      </div>
    </div>
  );
}
