import { INITIAL_CONTACTS, INITIAL_TRANSACTIONS, INITIAL_USER } from '../data/mockData';
import type { Contact, Transaction } from '../types/wallet';

export interface WalletUser {
  name: string;
  handle: string;
  email: string;
  avatarBg: string;
  walletAddress: string;
  country: string;
  phone: string;
}

export interface WalletSnapshot {
  user: WalletUser;
  balance: number;
  transactions: Transaction[];
  contacts: Contact[];
}

export interface WalletRepository {
  getSnapshot(): WalletSnapshot;
}

/**
 * Temporary adapter for the UI. Replace this implementation with API calls
 * without changing the wallet screens or their state contracts.
 */
export const mockWalletRepository: WalletRepository = {
  getSnapshot: () => ({
    user: INITIAL_USER,
    balance: 423.25,
    transactions: INITIAL_TRANSACTIONS,
    contacts: INITIAL_CONTACTS,
  }),
};

export const walletRepository = mockWalletRepository;

export function getInitialWalletSnapshot(): WalletSnapshot {
  const snapshot = walletRepository.getSnapshot();

  return {
    ...snapshot,
    transactions: [...snapshot.transactions],
    contacts: [...snapshot.contacts],
  };
}

export function resetWalletSnapshot(): WalletSnapshot {
  return getInitialWalletSnapshot();
}
