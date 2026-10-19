export type TransactionType = 'deposit' | 'withdrawal' | 'sent' | 'received';

export type TransactionStatus = 'in_progress' | 'completed' | 'failed';

export interface Transaction {
  id: string;
  title: string;
  counterparty?: string;
  /** Registered email of the counterparty wallet, when it is a ReWallet user. */
  counterpartyEmail?: string | null;
  type: TransactionType;
  status: TransactionStatus;
  amount: number; // in USDC
  assetSymbol?: 'SOL' | 'USDC';
  fiatAmount: number | null; // in current selected fiat, if known
  fiatCurrency: string;
  timestamp: string; // display string like "Today at 10:41 PM"
  date: Date;
  method?: string; // "Khipu", "ETpay", "Crypto (Base)", "Bank Transfer", etc.
  referenceId?: string;
  note?: string;
  txHash?: string;
  walletAddress?: string;
}

export interface Contact {
  id: string;
  name: string;
  handle: string; // e.g. @benja_munoz
  avatarBg: string;
  avatarEmoji?: string;
  recent?: boolean;
  address?: string; // Solana public key for transfers
  isVerified?: boolean;
}
