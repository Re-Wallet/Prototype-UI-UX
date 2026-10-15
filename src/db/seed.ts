/**
 * Seed the prototype database with devnet demo data.
 *
 * Run with: npm run db:seed
 * Safe to re-run: it clears the demo user's rows before inserting.
 */

import { eq, inArray } from 'drizzle-orm';

import { db, sqlite } from './index';
import {
  contacts,
  fiatRates,
  notifications,
  paymentLinks,
  qrScans,
  transactions,
  userSettings,
  users,
} from './schema';
import {
  fakeDevnetSignature,
  generateReferenceId,
  SEED_ADDRESSES,
} from '../lib/devnet';

const DEMO_EMAIL = 'cata.soto@rewallet.app';
const DEMO_HANDLE = '@cata_soto';

async function main() {
  console.log('🌱 Seeding ReWallet prototype database...\n');

  // ---------------------------------------------------------------------------
  // Fiat rates
  // ---------------------------------------------------------------------------
  await db.delete(fiatRates);
  await db.insert(fiatRates).values([
    { quoteCurrency: 'USD', rate: 1.0, source: 'manual' },
    { quoteCurrency: 'EUR', rate: 0.92, source: 'coingecko' },
    { quoteCurrency: 'ARS', rate: 1050.0, source: 'manual' },
    { quoteCurrency: 'CLP', rate: 950.0, source: 'manual' },
    { quoteCurrency: 'COP', rate: 4100.0, source: 'manual' },
    { quoteCurrency: 'MXN', rate: 18.5, source: 'manual' },
  ]);
  console.log('  ✓ fiat_rates (6)');

  // ---------------------------------------------------------------------------
  // Demo user (idempotent: wipe previous demo data first)
  // ---------------------------------------------------------------------------
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, DEMO_EMAIL))
    .limit(1);

  if (existing.length > 0) {
    const previousId = existing[0].id;
    await db.delete(notifications).where(eq(notifications.userId, previousId));
    await db.delete(qrScans).where(eq(qrScans.userId, previousId));
    await db.delete(transactions).where(eq(transactions.userId, previousId));
    await db.delete(paymentLinks).where(eq(paymentLinks.userId, previousId));
    await db.delete(contacts).where(eq(contacts.userId, previousId));
    await db.delete(userSettings).where(eq(userSettings.userId, previousId));
    await db.delete(users).where(eq(users.id, previousId));
    console.log('  ↺ removed previous demo user');
  }

  const [demoUser] = await db
    .insert(users)
    .values({
      id: 1, // Stable id so the demo wallet is always the primary user.
      publicKey: SEED_ADDRESSES.cataSoto,
      handle: DEMO_HANDLE,
      name: 'Catalina Soto',
      email: DEMO_EMAIL,
      phone: '+56 9 8765 4321',
      avatarBg: 'bg-[#ff1f71]',
      avatarEmoji: '◡̈',
      country: 'CL',
      language: 'en',
      balanceUsdc: 423.25,
      balanceSol: 2.5,
      kycStatus: 'verified',
      lastLoginAt: new Date(),
    })
    .returning();

  console.log(`  ✓ users (1) id=${demoUser.id} handle=${demoUser.handle}`);

  await db.insert(userSettings).values({
    userId: demoUser.id,
    language: 'en',
    currency: 'USD',
    hideBalance: false,
    notificationsPush: true,
    notificationsEmail: false,
    securityBiometric: true,
    autoLockMinutes: 5,
    theme: 'dark',
  });
  console.log('  ✓ user_settings (1)');

  // ---------------------------------------------------------------------------
  // Peer users (counterparties)
  // ---------------------------------------------------------------------------
  const peerSeed = [
    { handle: '@benja_munoz', name: 'Benjamín Muñoz', publicKey: SEED_ADDRESSES.benjaMunoz, avatarBg: 'bg-[#ff5a1f]' },
    { handle: '@coni_rojas', name: 'Coni Rojas', publicKey: SEED_ADDRESSES.coniRojas, avatarBg: 'bg-[#26e5c8]' },
    { handle: '@sebafuentes', name: 'Seba Fuentes', publicKey: SEED_ADDRESSES.sebaFuentes, avatarBg: 'bg-[#6366f1]' },
    { handle: '@vale', name: 'Vale', publicKey: SEED_ADDRESSES.vale, avatarBg: 'bg-[#f59e0b]' },
  ];

  const existingPeers = await db
    .select({ id: users.id, handle: users.handle })
    .from(users)
    .where(inArray(users.handle, peerSeed.map((p) => p.handle)));

  const peerIds = new Map(existingPeers.map((p) => [p.handle, p.id]));

  for (const peer of peerSeed) {
    if (peerIds.has(peer.handle)) continue;
    const [row] = await db
      .insert(users)
      .values({
        publicKey: peer.publicKey,
        handle: peer.handle,
        name: peer.name,
        avatarBg: peer.avatarBg,
        avatarEmoji: '◡̈',
        balanceUsdc: 100,
        balanceSol: 1,
      })
      .returning({ id: users.id });
    peerIds.set(peer.handle, row.id);
  }
  console.log(`  ✓ users peers (${peerSeed.length})`);

  // ---------------------------------------------------------------------------
  // Contacts
  // ---------------------------------------------------------------------------
  await db.insert(contacts).values(
    peerSeed.map((peer, i) => ({
      userId: demoUser.id,
      contactUserId: peerIds.get(peer.handle) ?? null,
      handle: peer.handle,
      name: peer.name,
      publicKey: peer.publicKey,
      avatarBg: peer.avatarBg,
      avatarEmoji: '◡̈',
      isFavorite: i < 2,
      isVerified: true,
    }))
  );
  console.log(`  ✓ contacts (${peerSeed.length})`);

  // ---------------------------------------------------------------------------
  // Transactions
  // ---------------------------------------------------------------------------
  const now = Date.now();
  const minute = 60_000;

  const [sentTx] = await db
    .insert(transactions)
    .values({
      userId: demoUser.id,
      type: 'sent',
      status: 'completed',
      amountUsdc: 102,
      fiatAmount: 88.37,
      fiatCurrency: 'EUR',
      fiatRate: 0.8664,
      counterpartyId: peerIds.get('@benja_munoz') ?? null,
      counterpartyHandle: '@benja_munoz',
      counterpartyName: 'Benjamín Muñoz',
      counterpartyPubkey: SEED_ADDRESSES.benjaMunoz,
      method: 'ReWallet Instant P2P',
      network: 'solana',
      referenceId: generateReferenceId('MOZ'),
      solanaSignature: fakeDevnetSignature('sent-benja'),
      referencePubkey: SEED_ADDRESSES.benjaMunoz,
      memo: 'Pago cuota arriendo oficina',
      note: 'Pago cuota arriendo oficina',
      confirmations: 32,
      confirmedAt: new Date(now - 60 * minute),
    })
    .returning();

  const [receivedTx] = await db
    .insert(transactions)
    .values({
      userId: demoUser.id,
      type: 'received',
      status: 'completed',
      amountUsdc: 275.25,
      fiatAmount: 238.48,
      fiatCurrency: 'EUR',
      fiatRate: 0.8664,
      counterpartyId: peerIds.get('@benja_munoz') ?? null,
      counterpartyHandle: '@benja_munoz',
      counterpartyName: 'Benjamín Muñoz',
      counterpartyPubkey: SEED_ADDRESSES.benjaMunoz,
      method: 'ReWallet Instant P2P',
      network: 'solana',
      referenceId: generateReferenceId('MOZ'),
      solanaSignature: fakeDevnetSignature('received-benja'),
      referencePubkey: SEED_ADDRESSES.benjaMunoz,
      memo: 'Liquidación proyecto diseño UX',
      note: 'Liquidación proyecto diseño UX',
      confirmations: 64,
      confirmedAt: new Date(now - 3 * minute),
    })
    .returning();

  await db.insert(transactions).values([
    {
      userId: demoUser.id,
      type: 'deposit',
      status: 'pending',
      amountUsdc: 50,
      fiatAmount: 43.32,
      fiatCurrency: 'EUR',
      fiatRate: 0.8664,
      method: 'Khipu Instant Bank Transfer',
      network: 'solana',
      referenceId: generateReferenceId('KHP'),
      note: 'Carga de saldo vía cuenta corriente',
      confirmations: 0,
    },
    {
      userId: demoUser.id,
      type: 'withdrawal',
      status: 'completed',
      amountUsdc: 50,
      fiatAmount: 43.32,
      fiatCurrency: 'EUR',
      fiatRate: 0.8664,
      method: 'Solana Network (USDC)',
      network: 'solana',
      referenceId: generateReferenceId('WDR'),
      solanaSignature: fakeDevnetSignature('withdraw-1'),
      counterpartyPubkey: SEED_ADDRESSES.vale,
      memo: 'Retiro a cold wallet',
      note: 'Retiro a cold wallet hardware',
      confirmations: 128,
      confirmedAt: new Date(now - 4 * minute),
    },
    {
      userId: demoUser.id,
      type: 'deposit',
      status: 'completed',
      amountUsdc: 300,
      fiatAmount: 259.92,
      fiatCurrency: 'EUR',
      fiatRate: 0.8664,
      method: 'Solana Network (USDC)',
      network: 'solana',
      referenceId: generateReferenceId('DEP'),
      solanaSignature: fakeDevnetSignature('deposit-300'),
      memo: 'Depósito cobro cliente internacional',
      note: 'Depósito cobro cliente internacional',
      confirmations: 256,
      confirmedAt: new Date(now - 5 * minute),
    },
  ]);
  console.log('  ✓ transactions (5)');

  // ---------------------------------------------------------------------------
  // Payment link (paid by a client)
  // ---------------------------------------------------------------------------
  const [paidLink] = await db
    .insert(paymentLinks)
    .values({
      userId: demoUser.id,
      slug: 'servicios-diseno-ux',
      referencePubkey: SEED_ADDRESSES.sebaFuentes,
      amountUsdc: 45,
      currency: 'USDC',
      concept: 'Servicios de Diseño & UX',
      clientName: 'Startup LatAm Inc.',
      status: 'paid',
      paidAmountUsdc: 45,
      paidAt: new Date(now - 30 * minute),
      paidByPubkey: SEED_ADDRESSES.sebaFuentes,
      metadataJson: { source: 'prototype-seed' },
    })
    .returning();

  await db.insert(transactions).values({
    userId: demoUser.id,
    type: 'received',
    status: 'completed',
    amountUsdc: 45,
    method: 'ReWallet Payment Link',
    network: 'solana',
    referenceId: generateReferenceId('PAY'),
    solanaSignature: fakeDevnetSignature('link-paid-1'),
    referencePubkey: SEED_ADDRESSES.sebaFuentes,
    paymentLinkId: paidLink.id,
    counterpartyHandle: '@sebafuentes',
    counterpartyName: 'Startup LatAm Inc.',
    note: 'Cobro pagado por Startup LatAm Inc.',
    confirmations: 16,
    confirmedAt: new Date(now - 30 * minute),
  });

  await db.insert(paymentLinks).values({
    userId: demoUser.id,
    slug: 'consultoria-abierta',
    referencePubkey: SEED_ADDRESSES.coniRojas,
    amountUsdc: null,
    currency: 'USDC',
    concept: 'Consultoría abierta',
    clientName: null,
    status: 'active',
    metadataJson: { source: 'prototype-seed' },
  });
  console.log('  ✓ payment_links (2, 1 paid)');

  // ---------------------------------------------------------------------------
  // QR scans
  // ---------------------------------------------------------------------------
  await db.insert(qrScans).values([
    {
      userId: demoUser.id,
      referencePubkey: SEED_ADDRESSES.sebaFuentes,
      paymentLinkId: paidLink.id,
      scannedAmountUsdc: 45,
      scannedConcept: 'Servicios de Diseño & UX',
      scannedLabel: 'ReWallet',
      status: 'completed',
      resultTxId: receivedTx.id,
      scannedAt: new Date(now - 32 * minute),
      completedAt: new Date(now - 30 * minute),
    },
    {
      userId: demoUser.id,
      referencePubkey: SEED_ADDRESSES.coniRojas,
      scannedAmountUsdc: 20,
      scannedConcept: 'Cena equipo',
      scannedLabel: 'ReWallet',
      status: 'scanned',
      scannedAt: new Date(now - 10 * minute),
    },
  ]);
  console.log('  ✓ qr_scans (2)');

  // ---------------------------------------------------------------------------
  // Notifications
  // ---------------------------------------------------------------------------
  await db.insert(notifications).values([
    {
      userId: demoUser.id,
      type: 'payment_received',
      title: '¡Cobro recibido!',
      message: 'Startup LatAm Inc. pagó USD 45.00 por "Servicios de Diseño & UX".',
      referenceTxId: receivedTx.id,
      referencePlId: paidLink.id,
      isRead: false,
      dataJson: { amountUsdc: 45, concept: 'Servicios de Diseño & UX' },
    },
    {
      userId: demoUser.id,
      type: 'payment_sent',
      title: 'Transferencia enviada',
      message: 'Enviaste USD 102.00 a @benja_munoz.',
      referenceTxId: sentTx.id,
      isRead: false,
      dataJson: { amountUsdc: 102 },
    },
    {
      userId: demoUser.id,
      type: 'system',
      title: 'Bienvenido a ReWallet',
      message: 'Estás operando en devnet. Ningún fondo es real.',
      isRead: true,
      readAt: new Date(now - 60 * minute),
    },
  ]);
  console.log('  ✓ notifications (3)');

  console.log('\n✅ Seed complete.');
  console.log(`   Demo user: ${DEMO_HANDLE} (${DEMO_EMAIL})`);
  console.log(`   Balance:   USD ${demoUser.balanceUsdc.toFixed(2)}\n`);

  sqlite.close();
}

main().catch((error) => {
  console.error('\n❌ Seed failed:', error);
  sqlite.close();
  process.exit(1);
});
