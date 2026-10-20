import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useCreateWaasWalletAccounts, useGetWalletAccounts, useInitStatus, useLogout, useOnEvent, useSendEmailOTP, useUser, useVerifyOTP } from '@dynamic-labs-sdk/react-hooks';
import { getChainsMissingWaasWalletAccounts } from '@dynamic-labs-sdk/client/waas';
import { ArrowLeft, LoaderCircle, Mail, Wallet } from 'lucide-react';
import { PhoneFrame } from './PhoneFrame';
import type { Language } from '../i18n/translations';
import { getStoredLanguage, storeLanguage, subscribeLanguage } from '../i18n/language';

/** Sign-in copy: the gate mounts outside <WalletApp>, so it keeps its own map. */
const signInCopy: Record<Language, {
  title: string;
  subtitle: string;
  emailLabel: string;
  emailPlaceholder: string;
  sendCode: string;
  verify: string;
  changeEmail: string;
  codeSentTo: string;
  language: string;
}> = {
  en: {
    title: 'Your wallet starts here',
    subtitle: 'Sign in with your email. We create your digital dollars wallet on Solana.',
    emailLabel: 'Email address',
    emailPlaceholder: 'you@example.com',
    sendCode: 'Send verification code',
    verify: 'Verify and continue',
    changeEmail: 'Change email',
    codeSentTo: 'Verification code sent to',
    language: 'Language',
  },
  es: {
    title: 'Tu billetera empieza acá',
    subtitle: 'Ingresá con tu email. Nosotros creamos tu billetera de dólares digitales en Solana.',
    emailLabel: 'Correo electrónico',
    emailPlaceholder: 'tu@ejemplo.com',
    sendCode: 'Enviar código de verificación',
    verify: 'Verificar y continuar',
    changeEmail: 'Cambiar correo',
    codeSentTo: 'Código de verificación enviado a',
    language: 'Idioma',
  },
};

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
  // Chosen at sign-in and persisted, so the wallet app boots in that language.
  const [language, setLanguageState] = useState<Language>(getStoredLanguage);
  const copy = signInCopy[language];
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

  useEffect(() => subscribeLanguage(setLanguageState), []);

  const handleLanguageChange = (next: Language) => {
    setLanguageState(next);
    storeLanguage(next);
  };

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
      {/* self-start is required: the column flex container stretches items on
          the cross axis, which would distort the lockup horizontally. */}
      <img
        alt="Re Wallet"
        className="mb-7 h-14 w-auto self-start select-none"
        decoding="async"
        src="/rewallet-lockup.png"
      />
      <h1 className="mb-3 text-3xl font-bold tracking-tight text-white">
        {copy.title}
      </h1>
      <p className="mb-8 text-sm leading-6 text-zinc-400">
        {copy.subtitle}
      </p>

      <form className="space-y-4" onSubmit={handleSubmit}>
        {!otpVerification ? (
          <label className="block">
            <span className="mb-2 block text-xs font-semibold text-zinc-300">{copy.emailLabel}</span>
            <span className="flex h-12 items-center gap-3 rounded-xl border border-white/10 bg-[#18181b] px-4 focus-within:border-[#ff5a1f]/70">
              <Mail className="h-4 w-4 shrink-0 text-zinc-500" />
              <input
                autoComplete="email"
                className="w-full bg-transparent text-sm text-white outline-none placeholder:text-zinc-600"
                onChange={(event) => setEmail(event.target.value)}
                placeholder={copy.emailPlaceholder}
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
              {copy.changeEmail}
            </button>
            <label className="block">
              <span className="mb-2 block text-xs font-semibold text-zinc-300">
                {copy.codeSentTo} {email}
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

        {/* Language toggle: configure es/en before the first screen of the app. */}
        {!otpVerification && (
          <div className="flex items-center justify-center gap-2.5 pt-1">
            <span className="text-xs font-semibold text-zinc-500">{copy.language}</span>
            <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-[#18181b] p-1">
              <button
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                  language === 'es'
                    ? 'bg-[#ff5a1f] text-white shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
                onClick={() => handleLanguageChange('es')}
                type="button"
              >
                Español
              </button>
              <button
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                  language === 'en'
                    ? 'bg-[#ff5a1f] text-white shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
                onClick={() => handleLanguageChange('en')}
                type="button"
              >
                English
              </button>
            </div>
          </div>
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
          {otpVerification ? copy.verify : copy.sendCode}
        </button>
      </form>
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
