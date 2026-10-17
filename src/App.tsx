/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import { useGetWalletAccounts, useLogout, useUser } from '@dynamic-labs-sdk/react-hooks';
import { isSolanaWalletAccount } from '@dynamic-labs-sdk/solana';
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
import { QrScannerFlow } from './components/QrScannerFlow';
import { PhoneFrame } from './components/PhoneFrame';
import { Transaction } from './types/wallet';
import { Language, translations } from './i18n/translations';
import { DynamicAccountGate } from './components/DynamicAccountGate';
import { assetBySymbol, chain, type Address } from './adapters';
import { getWalletTransactions } from './services/solanaHistory';
import { WebPaymentPage } from './components/WebPaymentPage';

export default function App() {
  return (
    <DynamicAccountGate>
      <WalletApp />
    </DynamicAccountGate>
  );
}

function WalletApp() {
  // English is the product default; Spanish remains available from settings.
  const [language, setLanguage] = useState<Language>('en');
  const t = translations[language];
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

  const refreshBalance = useCallback(async () => {
    if (!solanaWallet) {
      setBalance(0);
      setSolBalance(0);
      setBalanceError('No se encontró la wallet Solana de esta cuenta.');
      setSolBalanceError('No se encontró la wallet Solana de esta cuenta.');
      setIsBalanceLoading(false);
      return;
    }

    setIsBalanceLoading(true);
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
      const onChainTransactions = await getWalletTransactions(solanaWallet.address as Address);
      setTransactions((current) => {
        const merged = new Map<string, Transaction>();
        for (const tx of current) {
          merged.set(`${tx.txHash ?? tx.id}:${tx.assetSymbol ?? 'USDC'}`, tx);
        }
        for (const tx of onChainTransactions) {
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

  useEffect(() => {
    void refreshBalance();
    void refreshTransactions();
  }, [refreshBalance, refreshTransactions]);

  // Navigation and active flows (Navbar has only: home, transfer, settings)
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [activeFlow, setActiveFlow] = useState<
    'deposit' | 'withdraw' | 'transfer' | 'all_transactions' | 'qr_scanner' | null
  >(null);
  const [transferInitialMode, setTransferInitialMode] = useState<'send' | 'payment_link'>('send');
  const [transferInitialRecipient, setTransferInitialRecipient] = useState<string | undefined>(undefined);
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
    setIsInTransferSubflow(false);
  };

  // Transaction Event Handlers
  const handleWithdrawComplete = (newTx: Transaction) => {
    setTransactions((prev) => [newTx, ...prev]);
    void refreshBalance();
    void refreshTransactions();
    showToast('Envío enviado a Solana', 'La transacción fue firmada por tu wallet Solana.');
  };

  const handleTransferComplete = (newTx: Transaction) => {
    setTransactions((prev) => [newTx, ...prev]);
    void refreshBalance();
    void refreshTransactions();
    showToast('Envío enviado a Solana', 'La transacción fue firmada por tu wallet Solana.');
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

  const handleRepeatTransaction = (tx: Transaction) => {
    if (tx.counterparty) {
      setTransferInitialRecipient(tx.counterparty);
      setTransferInitialMode('send');
      setActiveFlow('transfer');
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
          onRefreshBalance={refreshBalance}
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
            setTransferInitialRecipient(undefined);
            setIsInTransferSubflow(false);
          }}
          onTransferComplete={handleTransferComplete}
          initialMode={transferInitialMode}
          initialRecipient={transferInitialRecipient}
          onSubflowChange={setIsInTransferSubflow}
        />
      );
    }

    if (activeFlow === 'qr_scanner') {
      return <QrScannerFlow onClose={() => setActiveFlow(null)} t={t} />;
    }

    if (activeFlow === 'all_transactions') {
      return (
        <AllTransactionsModal
          transactions={transactions}
          onSelectTransaction={(tx) => setSelectedTransaction(tx)}
          onClose={() => setActiveFlow(null)}
        />
      );
    }

    // 2. Tab Navigation Screens (Only Home, Transfer, Settings inside phone)
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
          initialMode="send"
          onSubflowChange={setIsInTransferSubflow}
        />
      );
    }

    if (activeTab === 'settings') {
      return (
        <div className="h-full overflow-y-auto">
          <Header
            handle={accountLabel}
            onOpenProfile={() => setActiveTab('home')}
            onOpenQrScanner={() => setActiveFlow('qr_scanner')}
          />
          <SettingsView
            onLogout={handleLogout}
            language={language}
            onLanguageChange={setLanguage}
            t={t}
            dynamicEmail={dynamicUser?.email ?? undefined}
            solanaAddress={solanaWallet?.address}
          />
        </div>
      );
    }

    // Default Home Screen (Pixel-accurate to uploaded screenshots)
    return (
      <div className="h-full overflow-y-auto select-none">
        <Header
          handle={accountLabel}
          onOpenProfile={() => setActiveTab('settings')}
          onOpenQrScanner={() => setActiveFlow('qr_scanner')}
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
          onSeeAll={() => setActiveFlow('all_transactions')}
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

            {/* Bottom Nav Bar (Home, Transfer, Settings) - Hidden on /pay route */}
            {activeFlow === null && (!isInTransferSubflow || activeTab !== 'transfer') && window.location.pathname !== '/pay' && (
              <BottomNav activeTab={activeTab} onTabChange={handleTabChange} t={t} />
            )}

            {/* Transaction Receipt Modal - Rendered strictly inside phone interface */}
            {selectedTransaction && (
              <TransactionReceiptModal
                transaction={selectedTransaction}
                onClose={() => setSelectedTransaction(null)}
                onRepeatTransaction={handleRepeatTransaction}
              />
            )}
          </div>
        </PhoneFrame>
      </div>
    </div>
  );
}
