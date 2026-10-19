import { assetBySymbol, chain, rpc, type Address } from '../adapters';
import type { Transaction } from '../types/wallet';

const SIGNATURE_PAGE_SIZE = 50;
const SIGNATURE_PAGES = 2;
// The public devnet endpoint answers ~10 heavy getTransaction calls per short
// window, then 429s the caller (verified empirically). One call every ~400ms
// stays under the limit; a full two-wallet backfill is ~15s, which is fine
// for a background job.
const TRANSACTION_BATCH_SIZE = 1;
const RPC_PACE_MS = 400;
const USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface SignatureInfo {
  signature: string;
  blockTime: number | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asBigInt(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value);
  return null;
}

function asTimestamp(value: unknown): number | null {
  const timestamp = typeof value === 'bigint'
    ? Number(value)
    : typeof value === 'number' ? value : null;
  return timestamp !== null && Number.isFinite(timestamp) ? timestamp : null;
}

function accountKeyString(key: unknown): string | null {
  if (typeof key === 'string') return key;
  const record = asRecord(key);
  return typeof record?.pubkey === 'string' ? record.pubkey : null;
}

function transactionTimestamp(blockTime: number | null): { date: Date; label: string } {
  if (blockTime === null || !Number.isFinite(blockTime)) {
    return { date: new Date(0), label: 'Fecha no disponible' };
  }
  const date = new Date(blockTime * 1_000);
  return { date, label: date.toLocaleString() };
}

function parseTokenDelta(
  meta: Record<string, unknown>,
  owner: string,
  mint: string,
  ata?: string
): { delta: bigint; decimals: number } {
  const amounts = new Map<number, { pre: bigint; post: bigint; decimals: number }>();

  const readBalances = (field: 'preTokenBalances' | 'postTokenBalances', side: 'pre' | 'post') => {
    for (const entry of asArray(meta[field])) {
      const record = asRecord(entry);
      const uiTokenAmount = asRecord(record?.uiTokenAmount);
      // Match by owner OR by ATA address — a payment to an existing ATA
      // only lists the ATA in pre/postTokenBalances, not the owner wallet.
      const matchesOwner = record?.owner === owner;
      const matchesAta = ata && record?.owner === ata;
      if (!matchesOwner && !matchesAta) continue;
      if (record.mint !== mint) continue;
      if (!uiTokenAmount) continue;
      const tokenAmount = asBigInt(uiTokenAmount?.amount);
      if (typeof record.accountIndex !== 'number' || tokenAmount === null) continue;

      const previous = amounts.get(record.accountIndex) ?? { pre: 0n, post: 0n, decimals: 0 };
      previous[side] = tokenAmount;
      previous.decimals = typeof uiTokenAmount.decimals === 'number' ? uiTokenAmount.decimals : 0;
      amounts.set(record.accountIndex, previous);
    }
  };

  readBalances('preTokenBalances', 'pre');
  readBalances('postTokenBalances', 'post');
  let delta = 0n;
  let decimals = 0;
  for (const balance of amounts.values()) {
    delta += balance.post - balance.pre;
    decimals = balance.decimals;
  }
  return { delta, decimals };
}

function toUiAmount(base: bigint, decimals: number): number {
  const factor = 10 ** decimals;
  return Number(base) / factor;
}

const SYSTEM_PROGRAM_ID = '11111111111111111111111111111111';

/**
 * Whether the transaction actually moved native SOL to or from the wallet.
 *
 * With `jsonParsed`, a native transfer decodes to
 * `{ parsed: { info: { source, destination } } }` under the System Program.
 * Anything else that debits the wallet — most commonly the rent for creating
 * the recipient's associated token account — is a cost of the transaction, not a
 * movement the user made.
 */
function hasNativeSolTransfer(message: Record<string, unknown>, owner: string): boolean {
  for (const instruction of asArray(message.instructions)) {
    const record = asRecord(instruction);
    if (!record || String(record.programId) !== SYSTEM_PROGRAM_ID) continue;
    const info = asRecord(asRecord(record.parsed)?.info);
    if (!info) continue;
    if (String(info.source) === owner || String(info.destination) === owner) return true;
  }
  return false;
}

export function parseWalletTransaction(
  rawTransaction: unknown,
  owner: Address,
  signatureInfo: SignatureInfo,
  ata?: Address
): Transaction[] {
  const transactionRecord = asRecord(rawTransaction);
  const meta = asRecord(transactionRecord?.meta);
  const transaction = asRecord(transactionRecord?.transaction);
  const message = asRecord(transaction?.message);
  if (!meta || !message || meta.err !== null) return [];

  const keys = asArray(message.accountKeys).map(accountKeyString);
  const ownerIndex = keys.indexOf(owner);
  const ataIndex = ata ? keys.indexOf(ata) : -1;
  // A payment to an existing ATA only includes the ATA in account keys, not
  // the owner wallet. Accept the transaction when either is present.
  if (ownerIndex < 0 && ataIndex < 0) return [];
  // When owner is not in keys but ATA is (payment to existing ATA), use ATA as reference
  const referenceIndex = ownerIndex >= 0 ? ownerIndex : ataIndex;

  const timestamp = transactionTimestamp(signatureInfo.blockTime);
  const signature = signatureInfo.signature;
  const movements: Transaction[] = [];
  const preBalances = asArray(meta.preBalances);
  const postBalances = asArray(meta.postBalances);
  const balanceIndex = ownerIndex >= 0 ? ownerIndex : ataIndex;
  const preLamports = asBigInt(preBalances[balanceIndex]);
  const postLamports = asBigInt(postBalances[balanceIndex]);
  if (preLamports !== null && postLamports !== null) {
    const fee = keys[0] === owner ? asBigInt(meta.fee) ?? 0n : 0n;
    const delta = postLamports - preLamports + fee;
    // Adding back `fee` absorbs the network fee. What remains is either a real
    // SOL movement or a cost of the transaction, and only the former belongs in
    // a consumer's history: a USDC withdrawal to a new recipient creates their
    // associated token account, and that ~0.002 SOL rent would otherwise show up
    // as its own "Envío SOL" row right under the payment.
    if (delta !== 0n && hasNativeSolTransfer(message, owner)) {
      const amount = Math.abs(Number(delta)) / 1_000_000_000;
      const incoming = delta > 0n;
      movements.push({
        id: `${signature}-SOL`,
        title: `${incoming ? 'Ingreso' : 'Envío'} SOL`,
        type: incoming ? 'deposit' : 'withdrawal',
        status: incoming ? 'completed' : 'in_progress',
        amount,
        assetSymbol: 'SOL',
        fiatAmount: null,
        fiatCurrency: 'USD',
        timestamp: timestamp.label,
        date: timestamp.date,
        method: 'Solana',
        referenceId: signature,
        txHash: signature,
        walletAddress: owner,
      });
    }
  }

  const { delta, decimals } = parseTokenDelta(meta, owner, USDC_MINT, ata);
  if (delta !== 0n) {
    const amount = Math.abs(toUiAmount(delta, decimals));
    const incoming = delta > 0n;
    // Withdrawals (sent) start as in_progress, deposits (received) as completed
    const status = incoming ? 'completed' : 'in_progress';
    movements.push({
      id: `${signature}-USDC`,
      title: `${incoming ? 'Ingreso' : 'Envío'} USDC`,
      type: incoming ? 'received' : 'sent',
      status,
      amount,
      assetSymbol: 'USDC',
      fiatAmount: amount,
      fiatCurrency: 'USD',
      timestamp: timestamp.label,
      date: timestamp.date,
      method: 'Solana USDC',
      referenceId: signature,
      txHash: signature,
      walletAddress: owner,
    });
  }

  return movements;
}

async function getAddressSignatures(address: Address): Promise<SignatureInfo[]> {
  const signatures: SignatureInfo[] = [];
  let before: string | undefined;

  for (let pageIndex = 0; pageIndex < SIGNATURE_PAGES; pageIndex++) {
    const page = await rpc().getSignaturesForAddress(address as never, {
      commitment: 'confirmed',
      limit: SIGNATURE_PAGE_SIZE,
      ...(before ? { before } : {}),
    }).send();
    signatures.push(...page
      .filter((entry) => entry.err === null)
      .map((entry) => ({
        signature: String(entry.signature),
        blockTime: asTimestamp(entry.blockTime),
      })));
    if (page.length < SIGNATURE_PAGE_SIZE) break;
    before = String(page[page.length - 1]?.signature ?? '');
    if (!before) break;
  }
  return signatures;
}

export async function getWalletTransactions(owner: Address): Promise<Transaction[]> {
  const usdc = assetBySymbol('USDC', chain.network().cluster);
  if (!usdc) throw new Error(`USDC no está configurado para ${chain.network().cluster}.`);

  const [associatedTokenAccount, ownedTokenAccounts] = await Promise.all([
    chain.deriveAta(owner, usdc),
    chain.getTokenAccountAddresses(owner, usdc),
  ]);
  // Signature pages are fetched sequentially: the burst of parallel pages is
  // what trips the shared endpoint's rate limit in the first place.
  const signatureAddresses = [
    owner,
    ...new Set([associatedTokenAccount, ...ownedTokenAccounts]),
  ];
  const signatureSets: SignatureInfo[][] = [];
  for (const [index, address] of signatureAddresses.entries()) {
    if (index > 0) await sleep(RPC_PACE_MS);
    signatureSets.push(await getAddressSignatures(address));
  }
  const signatures = new Map<string, SignatureInfo>();
  for (const entry of signatureSets.flat()) {
    signatures.set(entry.signature, entry);
  }
  const orderedSignatures = [...signatures.values()]
    .sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0));

  const history: Transaction[] = [];
  for (let index = 0; index < orderedSignatures.length; index += TRANSACTION_BATCH_SIZE) {
    if (index > 0) await sleep(RPC_PACE_MS);
    const batch = orderedSignatures.slice(index, index + TRANSACTION_BATCH_SIZE);
    const parsedTransactions = await Promise.all(batch.map(async (entry) => {
      const response = await rpc().getTransaction(entry.signature as never, {
        commitment: 'confirmed',
        encoding: 'jsonParsed',
        maxSupportedTransactionVersion: 0,
      }).send();
      return parseWalletTransaction(response, owner, entry, associatedTokenAccount);
    }));
    history.push(...parsedTransactions.flat());
  }
  return history.sort((a, b) => b.date.getTime() - a.date.getTime());
}
