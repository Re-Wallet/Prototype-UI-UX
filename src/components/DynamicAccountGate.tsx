import { useState, type ReactNode } from 'react';
import { useGetWalletAccounts, useInitStatus, useLogout, useUser } from '@dynamic-labs-sdk/react-hooks';
import { LoaderCircle, Wallet } from 'lucide-react';
import { PhoneFrame } from './PhoneFrame';
import { SignInScreen } from './DynamicSignIn';
import { useEnsureSolanaWallet } from '../services/dynamicWallet';

function EntryFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#070709] flex items-center justify-center p-0 sm:p-4 font-sans antialiased">
      <div className="w-full flex justify-center py-2 sm:py-4">
        <PhoneFrame>
          <div className="flex-1 overflow-y-auto px-6 py-8">
            {children}
          </div>
        </PhoneFrame>
      </div>
    </div>
  );
}

function WalletSetupScreen({
  email,
  error,
  logoutError,
  isCreating,
  onRetry,
  onLogout,
}: {
  email?: string;
  error: string | null;
  logoutError: string | null;
  isCreating: boolean;
  onRetry: () => void;
  onLogout: () => void;
}) {
  const title = error
    ? 'Wallet setup needs attention'
    : isCreating
      ? 'Creating your Solana wallet'
      : 'Solana wallet not found';
  const message = error
    ?? (isCreating
      ? `Signed in${email ? ` as ${email}` : ''}. Your embedded wallet is being prepared.`
      : 'Enable Solana embedded wallets for this Dynamic environment, then try again.');

  return (
    <div className="flex min-h-full flex-col items-center justify-center text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#ff5a1f]/15 text-[#ff5a1f]">
        {isCreating && !error
          ? <LoaderCircle className="h-8 w-8 animate-spin" />
          : <Wallet className="h-8 w-8" />}
      </div>
      <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-[#ff5a1f]">
        Anonymus · Solana
      </p>
      <h1 className="mb-3 text-2xl font-bold text-white">
        {title}
      </h1>
      <p className="mb-6 max-w-xs text-sm leading-6 text-zinc-400">
        {message}
      </p>
      {!isCreating && (
        <button
          className="mb-4 h-11 w-full rounded-xl bg-[#ff5a1f] text-sm font-bold text-white transition hover:bg-[#ff713e]"
          onClick={onRetry}
          type="button"
        >
          Try again
        </button>
      )}
      {logoutError && (
        <p aria-live="polite" className="mb-4 text-xs leading-5 text-red-300">
          Could not sign out: {logoutError}
        </p>
      )}
      <button
        className="text-xs font-semibold text-zinc-400 transition hover:text-white"
        onClick={onLogout}
        type="button"
      >
        Sign out
      </button>
    </div>
  );
}

export function DynamicAccountGate({ children }: { children: ReactNode }) {
  const { data: initStatus, error: initError } = useInitStatus();
  const { data: user } = useUser();
  const { data: walletAccounts = [], isLoading: areWalletAccountsLoading } = useGetWalletAccounts();
  const { mutateAsync: logout } = useLogout();
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const {
    walletError,
    isCreating: isCreatingWallet,
    createSolanaWalletIfMissing,
  } = useEnsureSolanaWallet();

  const handleSetupLogout = async () => {
    setLogoutError(null);
    try {
      await logout();
    } catch (error) {
      setLogoutError(
        error instanceof Error ? error.message : 'Something went wrong. Please try again.'
      );
    }
  };

  const solanaWallet = walletAccounts.find((account) => account.chain === 'SOL');

  if (initStatus === 'failed') {
    return (
      <EntryFrame>
        <p className="text-sm leading-6 text-red-300">
          Dynamic could not initialize: {initError?.message ?? 'Unknown initialization error'}
        </p>
      </EntryFrame>
    );
  }

  if (initStatus !== 'finished') {
    return (
      <EntryFrame>
        <div className="flex h-full items-center justify-center gap-3 text-sm text-zinc-400">
          <LoaderCircle className="h-5 w-5 animate-spin text-[#ff5a1f]" />
          Conectando…
        </div>
      </EntryFrame>
    );
  }

  if (!user) {
    return <EntryFrame><SignInScreen /></EntryFrame>;
  }

  if (areWalletAccountsLoading || !solanaWallet) {
    return (
      <EntryFrame>
        <WalletSetupScreen
          email={user.email ?? undefined}
          error={walletError}
          logoutError={logoutError}
          isCreating={isCreatingWallet || areWalletAccountsLoading}
          onRetry={() => void createSolanaWalletIfMissing()}
          onLogout={() => void handleSetupLogout()}
        />
      </EntryFrame>
    );
  }

  return children;
}
