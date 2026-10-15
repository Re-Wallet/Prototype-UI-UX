export type TransactionType = 'deposit' | 'withdrawal' | 'sent' | 'received';

export type TransactionStatus = 'in_progress' | 'completed' | 'failed';

export interface Transaction {
  id: string;
  title: string;
  counterparty?: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: number; // in USDC
  fiatAmount: number; // in current selected fiat
  fiatCurrency: string;
  timestamp: string; // display string like "Today at 10:41 PM"
  date: Date;
  method?: string; // "Khipu", "ETpay", "Crypto (Base)", "Bank Transfer", etc.
  referenceId?: string;
  note?: string;
  txHash?: string;
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

export interface CurrencyConfig {
  code: string;
  symbol: string;
  ratePerUsdc: number; // 1 USDC = X fiat
  label: string;
}

export interface PaymentLink {
  id: string;
  title: string;
  amount: number | null; // null for open amount
  handle: string;
  url: string;
  createdAt: Date;
  status: 'active' | 'paid' | 'expired';
}
