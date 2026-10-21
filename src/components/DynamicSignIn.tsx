import { useEffect, useState, type FormEvent } from 'react';
import { useSendEmailOTP, useVerifyOTP } from '@dynamic-labs-sdk/react-hooks';
import { ArrowLeft, LoaderCircle, Mail } from 'lucide-react';

import type { Language } from '../i18n/translations';
import { getStoredLanguage, storeLanguage, subscribeLanguage } from '../i18n/language';

/**
 * Sign in with an email code.
 *
 * It lives apart from the account gate because the payment page signs a payer
 * in too: a payer opens the link on another device, without an account, and
 * the request has to be reachable without the app's own sign-in wall.
 */

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


interface SignInScreenProps {
  /**
   * Compact mode: no lockup, no headline, no language toggle.
   *
   * The payment page signs a payer in inside an existing card, where the
   * full-screen sign-in would be a wall of chrome around one form.
   */
  compact?: boolean;
  /** Overrides the default headline (the payment page explains why). */
  title?: string;
  subtitle?: string;
}

export function SignInScreen({ compact = false, title, subtitle }: SignInScreenProps) {
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
      {!compact && (
        <img
          alt="Re Wallet"
          className="mb-7 h-14 w-auto self-start select-none"
          decoding="async"
          src="/rewallet-lockup.png"
        />
      )}
      <h1
        className={
          compact
            ? 'mb-3 text-xl font-bold tracking-tight text-white'
            : 'mb-3 text-3xl font-bold tracking-tight text-white'
        }
      >
        {title ?? copy.title}
      </h1>
      <p className={compact ? 'mb-6 text-sm leading-6 text-zinc-400' : 'mb-8 text-sm leading-6 text-zinc-400'}>
        {subtitle ?? copy.subtitle}
      </p>

      <form className="space-y-4" onSubmit={handleSubmit}>
        {!otpVerification ? (
          <label className="block">
            <span className="mb-2 block text-xs font-semibold text-zinc-300">{copy.emailLabel}</span>
            <span className="flex h-12 items-center gap-3 rounded-xl border border-white/10 bg-[#18181b] px-4 focus-within:border-[#ff5a1f]/70">
              <Mail className="h-4 w-4 shrink-0 text-zinc-400" />
              <input
                autoComplete="email"
                className="w-full bg-transparent text-sm text-white  placeholder:text-zinc-400"
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
                className="h-12 w-full rounded-xl border border-white/10 bg-[#18181b] px-4 text-center text-lg tracking-[0.35em] text-white  placeholder:text-zinc-400 focus:border-[#ff5a1f]/70"
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

        {/* Language toggle: configure es/en before the first screen of the app.
            Hidden in compact mode: the payment page is not where the app
            language is chosen. */}
        {!otpVerification && !compact && (
          <div className="flex items-center justify-center gap-2.5 pt-1">
            <span className="text-xs font-semibold text-zinc-400">{copy.language}</span>
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
