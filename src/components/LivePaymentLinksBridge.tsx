/**
 * Invisible bridge between Neon Realtime and payment-link state.
 *
 * Fetches a sealed capability for the connected wallet, subscribes through
 * `useLiveQuery` (which owns cleanup and renews the capability via
 * `refreshQuery`), maps each authoritative row snapshot with the same
 * mapper the REST path uses, and pushes the mapped links upward.
 *
 * This is what lets the collector's screen switch to "Pago recibido" the
 * moment the webhook settles the link — no polling, no manual refresh.
 *
 * Renders null. The fetch gate is part of the contract: `useLiveQuery`
 * rejects malformed/absent capabilities, so the subscription only mounts
 * once a seal has been fetched.
 */

import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from '@neon/realtime-react';
import type { SealedLiveQuery } from '@neon/realtime/client';

import {
  fetchSealedPaymentLinks,
  mapLivePaymentLink,
  type LivePaymentLinkRow,
  type PaymentLinkDto,
} from '../services/walletApi';

interface LiveSubscriptionProps {
  sealedQuery: SealedLiveQuery<LivePaymentLinkRow>;
  refreshQuery: () => Promise<SealedLiveQuery<LivePaymentLinkRow>>;
  onLinks: (links: PaymentLinkDto[]) => void;
}

function LiveSubscription({ sealedQuery, refreshQuery, onLinks }: LiveSubscriptionProps) {
  // `data` is the complete authoritative row set after each atomic batch —
  // replace semantics upstream, not a delta.
  const { data } = useLiveQuery(sealedQuery, { refreshQuery });

  useEffect(() => {
    if (!data) return;
    onLinks(data.map(mapLivePaymentLink));
  }, [data, onLinks]);

  return null;
}

export interface LivePaymentLinksBridgeProps {
  walletAddress: string;
  onLinks: (links: PaymentLinkDto[]) => void;
}

export function LivePaymentLinksBridge({ walletAddress, onLinks }: LivePaymentLinksBridgeProps) {
  const [sealedQuery, setSealedQuery] = useState<
    SealedLiveQuery<LivePaymentLinkRow> | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    setSealedQuery(null);
    void fetchSealedPaymentLinks(walletAddress).then((sealed) => {
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
      fetchSealedPaymentLinks(walletAddress).then((sealed) => {
        if (!sealed) {
          throw new Error('Could not renew the Realtime capability.');
        }
        return sealed;
      }),
    [walletAddress]
  );

  if (!sealedQuery) return null;
  return <LiveSubscription sealedQuery={sealedQuery} refreshQuery={refreshQuery} onLinks={onLinks} />;
}
