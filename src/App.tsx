/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
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
import { PhoneFrame } from './components/PhoneFrame';
import { INITIAL_USER, INITIAL_TRANSACTIONS } from './data/mockData';
import { Transaction } from './types/wallet';
import { Language, translations } from './i18n/translations';

export default function App() {
  // Language state (default Spanish, with English toggle)
  const [language, setLanguage] = useState<Language>('es');
  const t = translations[language];

  const toggleLanguage = () => {
    setLanguage((prev) => (prev === 'es' ? 'en' : 'es'));
  };

  // Wallet core state initialized to match the user's provided screenshots
  const [balance, setBalance] = useState<number>(423.25);
  const [isBalanceHidden, setIsBalanceHidden] = useState<boolean>(false);
  const [transactions, setTransactions] = useState<Transaction[]>(INITIAL_TRANSACTIONS);

  // Navigation and active flows (Navbar has only: home, transfer, settings)
  const [activeTab, setActiveTab] = useState<NavTab>('home');
  const [activeFlow, setActiveFlow] = useState<
    'deposit' | 'withdraw' | 'transfer' | 'all_transactions' | null
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
  const handleDepositComplete = (newTx: Transaction) => {
    setTransactions((prev) => [newTx, ...prev]);
    setBalance((prev) => prev + newTx.amount);
    showToast(
      '¡Depósito Exitoso!',
      `Se han acreditado Ⓢ ${newTx.amount.toFixed(2)} mediante ${newTx.method}`,
      newTx.amount
    );
  };

  const handleWithdrawComplete = (newTx: Transaction) => {
    setTransactions((prev) => [newTx, ...prev]);
    setBalance((prev) => Math.max(0, prev - newTx.amount));
    showToast(
      'Retiro Procesado',
      `Se enviaron Ⓢ ${newTx.amount.toFixed(2)} a ${newTx.method}`
    );
  };

  const handleTransferComplete = (newTx: Transaction) => {
    setTransactions((prev) => [newTx, ...prev]);
    setBalance((prev) => Math.max(0, prev - newTx.amount));
    showToast(
      'Transferencia Enviada',
      `Enviaste Ⓢ ${newTx.amount.toFixed(2)} a ${newTx.counterparty}`
    );
  };

  const handleReceivePayment = (newTx: Transaction) => {
    setTransactions((prev) => [newTx, ...prev]);
    setBalance((prev) => prev + newTx.amount);
    showToast(
      '¡Pago Recibido!',
      `${newTx.counterparty} pagó tu link por Ⓢ ${newTx.amount.toFixed(2)}`,
      newTx.amount
    );
  };

  const handleResetData = () => {
    setBalance(423.25);
    setTransactions(INITIAL_TRANSACTIONS);
    setIsBalanceHidden(false);
    showToast('Sesión Reiniciada', 'Se reestableció el saldo a Ⓢ 423.25.');
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
    // 1. Fullscreen Subflows
    if (activeFlow === 'deposit') {
      return (
        <DepositFlow
          balance={balance}
          onClose={() => setActiveFlow(null)}
          onDepositComplete={handleDepositComplete}
        />
      );
    }

    if (activeFlow === 'withdraw') {
      return (
        <WithdrawFlow
          balance={balance}
          onClose={() => setActiveFlow(null)}
          onWithdrawComplete={handleWithdrawComplete}
        />
      );
    }

    if (activeFlow === 'transfer') {
      return (
        <TransferFlow
          balance={balance}
          onClose={() => {
            setActiveFlow(null);
            setTransferInitialRecipient(undefined);
            setIsInTransferSubflow(false);
          }}
          onTransferComplete={handleTransferComplete}
          onReceivePayment={handleReceivePayment}
          initialMode={transferInitialMode}
          initialRecipient={transferInitialRecipient}
          onSubflowChange={setIsInTransferSubflow}
        />
      );
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
          onClose={() => {
            setActiveTab('home');
            setIsInTransferSubflow(false);
          }}
          onTransferComplete={handleTransferComplete}
          onReceivePayment={handleReceivePayment}
          initialMode="send"
          onSubflowChange={setIsInTransferSubflow}
        />
      );
    }

    if (activeTab === 'settings') {
      return (
        <div className="h-full overflow-y-auto">
          {/* Header with @cata_soto, language toggle, and eye icon */}
          <Header
            handle={INITIAL_USER.handle}
            isBalanceHidden={isBalanceHidden}
            onToggleBalance={() => setIsBalanceHidden(!isBalanceHidden)}
            onOpenProfile={() => setActiveTab('settings')}
            language={language}
            onToggleLanguage={toggleLanguage}
            t={t}
          />
          <SettingsView
            onLogout={handleResetData}
            language={language}
            onLanguageChange={setLanguage}
            t={t}
          />
        </div>
      );
    }

    // Default Home Screen (Pixel-accurate to uploaded screenshots)
    return (
      <div className="h-full overflow-y-auto select-none">
        <Header
          handle={INITIAL_USER.handle}
          onOpenProfile={() => setActiveTab('settings')}
          language={language}
          onToggleLanguage={toggleLanguage}
          t={t}
        />

        <BalanceCard
          balance={balance}
          isBalanceHidden={isBalanceHidden}
          onDeposit={() => setActiveFlow('deposit')}
          onWithdraw={() => setActiveFlow('withdraw')}
          onQrCharge={() => {
            setTransferInitialMode('payment_link');
            setActiveFlow('transfer');
          }}
          t={t}
        />

        <RecentTransactions
          transactions={transactions}
          onSelectTransaction={(tx) => setSelectedTransaction(tx)}
          onSeeAll={() => setActiveFlow('all_transactions')}
          t={t}
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

            {/* Bottom Nav Bar (Home, Transfer, Settings) - Positioned strictly inside the phone container */}
            {activeFlow === null && (!isInTransferSubflow || activeTab !== 'transfer') && (
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
