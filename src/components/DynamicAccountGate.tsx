import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useCreateWaasWalletAccounts, useGetWalletAccounts, useInitStatus, useLogout, useOnEvent, useSendEmailOTP, useUser, useVerifyOTP } from '@dynamic-labs-sdk/react-hooks';
import { getChainsMissingWaasWalletAccounts } from '@dynamic-labs-sdk/client/waas';
import { ArrowLeft, LoaderCircle, Mail, ShieldCheck, Wallet } from 'lucide-react';
import { PhoneFrame } from './PhoneFrame';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

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

function SignInScreen() {
  const [email, setEmail] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const {
    mutateAsync: sendEmailOTP,
    data: otpVerification,
    isPending: isSending,
    reset: resetEmailOTP,
  } = useSendEmailOTP();
  const {
    mutateAsync: verifyOTP,
    isPending: isVerifying,
    reset: resetVerifyOTP,
  } = useVerifyOTP();

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    try {
      if (!otpVerification) {
        await sendEmailOTP({ email: email.trim() });
        return;
      }

      await verifyOTP({
        otpVerification,
        verificationToken: verificationCode.trim(),
      });
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    }
  };

  const handleBack = () => {
    resetEmailOTP();
    resetVerifyOTP();
    setVerificationCode('');
    setError(null);
  };

  return (
    <div className="flex min-h-full flex-col justify-center">
      <div className="mb-8 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#ff5a1f]/15 text-[#ff5a1f]">
        <Wallet className="h-7 w-7" />
      </div>
      <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-[#ff5a1f]">
        ReWallet · Solana
      </p>
      <h1 className="mb-3 text-3xl font-bold tracking-tight text-white">
        Your wallet starts here
      </h1>
      <p className="mb-8 text-sm leading-6 text-zinc-400">
        Sign in with your email. Dynamic will securely create your embedded Solana wallet.
      </p>

      <form className="space-y-4" onSubmit={handleSubmit}>
        {!otpVerification ? (
          <label className="block">
            <span className="mb-2 block text-xs font-semibold text-zinc-300">Email address</span>
            <span className="flex h-12 items-center gap-3 rounded-xl border border-white/10 bg-[#18181b] px-4 focus-within:border-[#ff5a1f]/70">
              <Mail className="h-4 w-4 shrink-0 text-zinc-500" />
              <input
                autoComplete="email"
                className="w-full bg-transparent text-sm text-white outline-none placeholder:text-zinc-600"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
                type="email"
                value={email}
              />
            </span>
          </label>
        ) : (
          <>
            <button
              className="mb-2 flex items-center gap-2 text-xs font-semibold text-zinc-400 transition hover:text-white"
              onClick={handleBack}
              type="button"
            >
              <ArrowLeft className="h-4 w-4" />
              Change email
            </button>
            <label className="block">
              <span className="mb-2 block text-xs font-semibold text-zinc-300">
                Verification code sent to {email}
              </span>
              <input
                autoComplete="one-time-code"
                className="h-12 w-full rounded-xl border border-white/10 bg-[#18181b] px-4 text-center text-lg tracking-[0.35em] text-white outline-none placeholder:text-zinc-600 focus:border-[#ff5a1f]/70"
                inputMode="numeric"
                maxLength={8}
                onChange={(event) => setVerificationCode(event.target.value)}
                placeholder="••••••"
                required
                value={verificationCode}
              />
            </label>
          </>
        )}

        {error && (
          <p aria-live="polite" className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-300">
            {error}
          </p>
        )}

        <button
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#ff5a1f] text-sm font-bold text-white transition hover:bg-[#ff713e] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={isSending || isVerifying || (otpVerification !== undefined && !verificationCode.trim())}
          type="submit"
        >
          {(isSending || isVerifying) && <LoaderCircle className="h-4 w-4 animate-spin" />}
          {otpVerification ? 'Verify and continue' : 'Send verification code'}
        </button>
      </form>

      <div className="mt-8 flex items-start gap-3 rounded-2xl border border-white/5 bg-[#121214] p-4">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
        <p className="text-xs leading-5 text-zinc-400">
          Your sign-in is secured by Dynamic. Your Solana wallet is created after verification.
        </p>
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
        Dynamic · Solana
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
        className="text-xs font-semibold text-zinc-500 transition hover:text-white"
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
  const { mutateAsync: createWaasWalletAccounts } = useCreateWaasWalletAccounts();
  const { mutateAsync: logout } = useLogout();
  const [walletError, setWalletError] = useState<string | null>(null);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [isCreatingWallet, setIsCreatingWallet] = useState(false);
  const creationPromise = useRef<Promise<void> | null>(null);

  const createSolanaWalletIfMissing = useCallback(async () => {
    if (creationPromise.current) {
      await creationPromise.current;
      return;
    }

    const operation = (async () => {
      setWalletError(null);
      setIsCreatingWallet(true);

      try {
        const missingChains = getChainsMissingWaasWalletAccounts()
          .filter((chain) => chain === 'SOL');
        if (missingChains.length > 0) {
          await createWaasWalletAccounts({ chains: missingChains });
        }
      } catch (creationError) {
        setWalletError(getErrorMessage(creationError));
      } finally {
        setIsCreatingWallet(false);
      }
    })();

    creationPromise.current = operation;
    try {
      await operation;
    } finally {
      creationPromise.current = null;
    }
  }, [createWaasWalletAccounts]);

  useOnEvent({
    event: 'userChanged',
    listener: ({ user: changedUser }) => {
      if (changedUser) void createSolanaWalletIfMissing();
    },
  });

  useEffect(() => {
    if (user) void createSolanaWalletIfMissing();
  }, [user, createSolanaWalletIfMissing]);

  const handleSetupLogout = async () => {
    setLogoutError(null);
    try {
      await logout();
    } catch (error) {
      setLogoutError(getErrorMessage(error));
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
          Connecting to Dynamic…
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
