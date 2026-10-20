/**
 * Invisible bridge between Neon Realtime and WalletApp state.
 *
 * Fetches a sealed capability for the connected wallet, subscribes through
 * `useLiveQuery` (which owns cleanup and renews the capability via
 * `refreshQuery`), maps each authoritative row snapshot with the same
 * mapper the REST path uses, and pushes the mapped rows upward.
 *
 * Renders null. The fetch gate is part of the contract: `useLiveQuery`
 * rejects malformed/absent capabilities, so the subscription only mounts
 * once a seal has been fetched.
 */

import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from '@neon/realtime-react';
import type { SealedLiveQuery } from '@neon/realtime/client';

import { fetchSealedTransactions } from '../services/walletApi';
import {
  mapLiveTransactionRow,
  type LiveTransactionRow,
} from '../services/transactionMapper';
import type { Transaction } from '../types/wallet';

interface LiveSubscriptionProps {
  sealedQuery: SealedLiveQuery<LiveTransactionRow>;
  refreshQuery: () => Promise<SealedLiveQuery<LiveTransactionRow>>;
  onRows: (rows: Transaction[]) => void;
}

function LiveSubscription({ sealedQuery, refreshQuery, onRows }: LiveSubscriptionProps) {
  // `data` is the complete authoritative row set after each atomic batch —
  // replace semantics upstream, not a delta.
  const { data } = useLiveQuery(sealedQuery, { refreshQuery });

  useEffect(() => {
    if (!data) return;
    onRows(data.map(mapLiveTransactionRow));
  }, [data, onRows]);

  return null;
}

export interface LiveTransactionsBridgeProps {
  walletAddress: string;
  onRows: (rows: Transaction[]) => void;
}

export function LiveTransactionsBridge({ walletAddress, onRows }: LiveTransactionsBridgeProps) {
  const [sealedQuery, setSealedQuery] = useState<SealedLiveQuery<LiveTransactionRow> | null>(
    null
  );

  useEffect(() => {
    let cancelled = false;
    setSealedQuery(null);
    void fetchSealedTransactions(walletAddress).then((sealed) => {
      if (!cancelled) setSealedQuery(sealed);
    });
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  // Capability renewal must mint the SAME query or the SDK rejects it;
  // throwing on a soft-null makes the hook retry while the current seal is
  // still valid.
  const refreshQuery = useCallback(
    () =>
      fetchSealedTransactions(walletAddress).then((sealed) => {
        if (!sealed) {
          throw new Error('Could not renew the Realtime capability.');
        }
        return sealed;
      }),
    [walletAddress]
  );

  if (!sealedQuery) return null;
  return <LiveSubscription sealedQuery={sealedQuery} refreshQuery={refreshQuery} onRows={onRows} />;
}
