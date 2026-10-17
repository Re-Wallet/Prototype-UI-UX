import { assetByMint, chain, type Address } from '../adapters';
import { amountFromUi } from '../contracts/tokens';
import type { SupportedCluster } from '../contracts/tokens';

export interface WebPaymentIntent {
  recipient: Address;
  amount: number | null;
  mint: Address;
  cluster: SupportedCluster;
  message: string;
}

export function createWebPaymentUrl(intent: WebPaymentIntent, origin: string): string {
  if (!chain.isBase58(intent.recipient) || !chain.isBase58(intent.mint)) {
    throw new Error('La solicitud contiene una dirección Solana no válida.');
  }
  const asset = assetByMint(intent.mint, intent.cluster);
  if (!asset) throw new Error(`El token no está disponible en ${intent.cluster}.`);
  if (intent.amount !== null) {
    if (!Number.isFinite(intent.amount) || intent.amount <= 0) {
      throw new Error('El importe solicitado debe ser mayor que cero.');
    }
    const fraction = intent.amount.toString().split('.')[1] ?? '';
    if (fraction.length > asset.decimals) {
      throw new Error(`El importe no puede superar ${asset.decimals} decimales.`);
    }
    if (amountFromUi(intent.amount, asset).base <= 0n) {
      throw new Error('El importe es menor que la unidad mínima de USDC.');
    }
  }

  const url = new URL('/pay', origin);
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) {
    throw new Error('Los enlaces de pago deben usar HTTPS.');
  }
  url.searchParams.set('recipient', intent.recipient);
  url.searchParams.set('mint', intent.mint);
  url.searchParams.set('cluster', intent.cluster);
  if (intent.amount !== null) url.searchParams.set('amount', intent.amount.toFixed(asset.decimals));
  if (intent.message.trim()) url.searchParams.set('message', intent.message.trim());
  return url.toString();
}

export function parseWebPaymentUrl(locationHref: string): WebPaymentIntent | null {
  let url: URL;
  try {
    url = new URL(locationHref);
  } catch {
    return null;
  }
  if (url.pathname !== '/pay') return null;

  const recipient = url.searchParams.get('recipient');
  const mint = url.searchParams.get('mint');
  const cluster = url.searchParams.get('cluster');
  const rawAmount = url.searchParams.get('amount');
  const message = url.searchParams.get('message') ?? '';
  if (
    !recipient ||
    !mint ||
    !chain.isBase58(recipient) ||
    !chain.isBase58(mint) ||
    (cluster !== 'devnet' && cluster !== 'mainnet-beta')
  ) {
    return null;
  }

  const asset = assetByMint(mint, cluster);
  if (!asset) return null;
  let amount: number | null = null;
  if (rawAmount !== null) {
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(rawAmount)) return null;
    if ((rawAmount.split('.')[1] ?? '').length > asset.decimals) return null;
    amount = Number(rawAmount);
    if (!Number.isFinite(amount) || amount <= 0) return null;
    try {
      amountFromUi(amount, asset);
    } catch {
      return null;
    }
  }

  return {
    recipient: recipient as Address,
    amount,
    mint: mint as Address,
    cluster,
    message,
  };
}
