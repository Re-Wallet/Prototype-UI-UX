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
  fetchSnapshot(): Promise<WalletSnapshot>;
}

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:3001';

/**
 * Fallback snapshot keeps every screen functional when the prototype API
 * is not running (npm run api).
 */
const mockSnapshot: WalletSnapshot = {
  user: INITIAL_USER,
  balance: 423.25,
  transactions: INITIAL_TRANSACTIONS,
  contacts: INITIAL_CONTACTS,
};

function clone(snapshot: WalletSnapshot): WalletSnapshot {
  return {
    ...snapshot,
    transactions: [...snapshot.transactions],
    contacts: [...snapshot.contacts],
  };
}

export const mockWalletRepository: WalletRepository = {
  getSnapshot: () => clone(mockSnapshot),
  fetchSnapshot: async () => clone(mockSnapshot),
};

/**
 * Talks to the prototype API (server.ts). Falls back to the mock snapshot if
 * the API is unreachable so the UI never renders an empty shell.
 */
export const httpWalletRepository: WalletRepository = {
  getSnapshot: () => clone(mockSnapshot),

  fetchSnapshot: async () => {
    try {
      const response = await fetch(`${API_BASE}/api/wallet`);
      if (!response.ok) throw new Error(`API ${response.status}`);

      const data = (await response.json()) as {
        user: {
          name: string;
          handle: string;
          email: string | null;
          phone: string | null;
          avatarBg: string;
          walletAddress: string;
          country: string | null;
        };
        balance: number;
        transactions: Transaction[];
        contacts: Contact[];
      };

      return {
        user: {
          name: data.user.name,
          handle: data.user.handle,
          email: data.user.email ?? '',
          phone: data.user.phone ?? '',
          avatarBg: data.user.avatarBg,
          walletAddress: data.user.walletAddress,
          country: data.user.country ?? '',
        },
        balance: data.balance,
        transactions: data.transactions,
        contacts: data.contacts,
      };
    } catch {
      // API offline: keep the prototype usable with local mock data.
      return clone(mockSnapshot);
    }
  },
};

const useApi = (import.meta.env.VITE_USE_API as string | undefined) === 'true';

export const walletRepository: WalletRepository = useApi
  ? httpWalletRepository
  : mockWalletRepository;

export function getInitialWalletSnapshot(): WalletSnapshot {
  return walletRepository.getSnapshot();
}

export function resetWalletSnapshot(): WalletSnapshot {
  return clone(mockSnapshot);
}

export { API_BASE };
