import { useCallback, useEffect, useRef, useState } from 'react';
import { useCreateWaasWalletAccounts, useOnEvent, useUser } from '@dynamic-labs-sdk/react-hooks';
import { getChainsMissingWaasWalletAccounts } from '@dynamic-labs-sdk/client/waas';

/**
 * Makes sure the signed-in account owns a Solana wallet.
 *
 * Dynamic only creates the embedded wallet accounts when it is asked to, and
 * it has to be asked once per sign-in — otherwise the user lands in the app
 * with a session but without a wallet to move money from.
 *
 * It lives here, outside the account gate, because the payment page needs it
 * too: a payer who signs in from a payment link has to end up with a wallet
 * just like a user who signs in from the home screen.
 */

export interface SolanaWalletSetup {
  /** Why the wallet could not be created, if it could not. */
  walletError: string | null;
  /** True while the embedded wallet is being created. */
  isCreating: boolean;
  /** Ask for the wallet again (used by the "Try again" button). */
  createSolanaWalletIfMissing: () => Promise<void>;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export function useEnsureSolanaWallet(): SolanaWalletSetup {
  const { data: user } = useUser();
  const { mutateAsync: createWaasWalletAccounts } = useCreateWaasWalletAccounts();
  const [walletError, setWalletError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  // One creation at a time: the user event and the mount effect can both
  // fire for the same sign-in, and Dynamic would answer the second call
  // with "wallet already exists".
  const creationPromise = useRef<Promise<void> | null>(null);

  const createSolanaWalletIfMissing = useCallback(async () => {
    if (creationPromise.current) {
      await creationPromise.current;
      return;
    }

    const operation = (async () => {
      setWalletError(null);
      setIsCreating(true);

      try {
        const missingChains = getChainsMissingWaasWalletAccounts()
          .filter((chain) => chain === 'SOL');
        if (missingChains.length > 0) {
          await createWaasWalletAccounts({ chains: missingChains });
        }
      } catch (creationError) {
        setWalletError(getErrorMessage(creationError));
      } finally {
        setIsCreating(false);
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

  return { walletError, isCreating, createSolanaWalletIfMissing };
}
