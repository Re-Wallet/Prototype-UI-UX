import { Transaction, Contact, CurrencyConfig } from '../types/wallet';

export const INITIAL_USER = {
  name: 'Catalina Soto',
  handle: '@cata_soto',
  email: 'cata.soto@mozaik.money',
  avatarBg: 'bg-[#ff1f71]',
  walletAddress: '0x8F4A...B93C',
  country: 'Chile',
  phone: '+56 9 8765 4321',
};

export const SUPPORTED_CURRENCIES: CurrencyConfig[] = [
  { code: 'EUR', symbol: '€', ratePerUsdc: 0.8664, label: 'Euro (€)' },
  { code: 'USD', symbol: '$', ratePerUsdc: 1.0, label: 'US Dollar ($)' },
  { code: 'CLP', symbol: '$', ratePerUsdc: 945.5, label: 'Peso Chileno (CLP)' },
  { code: 'ARS', symbol: '$', ratePerUsdc: 1180.0, label: 'Peso Argentino (ARS)' },
  { code: 'COP', symbol: '$', ratePerUsdc: 4200.0, label: 'Peso Colombiano (COP)' },
  { code: 'MXN', symbol: '$', ratePerUsdc: 19.8, label: 'Peso Mexicano (MXN)' },
];

export const INITIAL_TRANSACTIONS: Transaction[] = [
  {
    id: 'tx-1',
    title: 'Khipu deposit',
    type: 'deposit',
    status: 'in_progress',
    amount: 50,
    fiatAmount: 43.32,
    fiatCurrency: 'EUR',
    timestamp: 'Today at 10:41 PM',
    date: new Date(),
    method: 'Khipu Instant Bank Transfer',
    referenceId: 'KHP-92817402',
    note: 'Carga de saldo vía cuenta corriente',
  },
  {
    id: 'tx-2',
    title: '@benja_munoz',
    counterparty: '@benja_munoz',
    type: 'sent',
    status: 'completed',
    amount: 102,
    fiatAmount: 88.37,
    fiatCurrency: 'EUR',
    timestamp: 'Today at 10:41 PM',
    date: new Date(Date.now() - 60000),
    method: 'Mozaik Instant P2P',
    referenceId: 'MOZ-3381920',
    note: 'Pago cuota arriendo oficina',
  },
  {
    id: 'tx-3',
    title: '@benja_munoz',
    counterparty: '@benja_munoz',
    type: 'received',
    status: 'completed',
    amount: 275.25,
    fiatAmount: 238.48,
    fiatCurrency: 'EUR',
    timestamp: 'Today at 10:39 PM',
    date: new Date(Date.now() - 180000),
    method: 'Mozaik Instant P2P',
    referenceId: 'MOZ-3381890',
    note: 'Liquidación proyecto diseño UX',
  },
  {
    id: 'tx-4',
    title: 'Retiro',
    type: 'withdrawal',
    status: 'completed',
    amount: 50,
    fiatAmount: 43.32,
    fiatCurrency: 'EUR',
    timestamp: 'Today at 10:38 PM',
    date: new Date(Date.now() - 240000),
    method: 'Base Network (USDC)',
    referenceId: '0x3c9f...8a12',
    txHash: '0x3c9fb64177b94ad15fce824143a992bb1842045e7aa42d48bf56327e5ec08a12',
    note: 'Retiro a cold wallet hardware',
  },
  {
    id: 'tx-5',
    title: 'Crypto deposit',
    type: 'deposit',
    status: 'completed',
    amount: 300,
    fiatAmount: 259.92,
    fiatCurrency: 'EUR',
    timestamp: 'Today at 10:37 PM',
    date: new Date(Date.now() - 300000),
    method: 'Polygon Network (USDC)',
    referenceId: '0x7e1a...43d1',
    txHash: '0x7e1ab238a8cf384918e390cbfd22384a9238374a00cb392a838520bfd21843d1',
    note: 'Depósito cobro cliente internacional',
  },
];

export const INITIAL_CONTACTS: Contact[] = [
  {
    id: 'c-1',
    name: 'Coni Rojas',
    handle: '@coni_rojas',
    avatarBg: 'bg-gradient-to-tr from-[#6b21a8] to-[#ea580c]',
    avatarEmoji: '◡̈',
    recent: true,
  },
  {
    id: 'c-2',
    name: 'Seba Fuentes',
    handle: '@sebafuentes',
    avatarBg: 'bg-[#581c87]',
    avatarEmoji: '◡̈',
    recent: true,
  },
  {
    id: 'c-3',
    name: 'Benjamín Muñoz',
    handle: '@benja_munoz',
    avatarBg: 'bg-gradient-to-tr from-[#ea580c] to-[#7e22ce]',
    avatarEmoji: '◡̈',
    recent: true,
  },
  {
    id: 'c-4',
    name: 'Vale',
    handle: '@vale',
    avatarBg: 'bg-[#f59e0b]',
    avatarEmoji: '◡̈',
    recent: true,
  },
];

export const VALUE_PROPOSITION_INFO = {
  tagline: 'Tu dinero en dólares digitales, sin fronteras y sin fricción.',
  summary:
    'Mozaik conecta el sistema bancario local de Latinoamérica con la economía digital global utilizando dólares digitales (USDC). Permite cobrar a clientes, transferir instantáneamente a contactos sin comisiones y fondear o retirar vía bancos locales o redes cripto en segundos.',
  pillars: [
    {
      title: 'Billetera Self-Custodial en Dólares Digitales (USDC)',
      description:
        'Tus fondos se mantienen 1:1 respaldados en USDC (dólares digitales emitidos y auditados). Tú mantienes el control total sin riesgo de devaluación en pesos.',
      badge: 'Moneda Fuerte',
    },
    {
      title: 'Rampas Locales Instantáneas (Khipu, ETpay, SPEI, Bancos)',
      description:
        'Deposita y retira desde tu cuenta bancaria en Chile, Colombia, Argentina, México o Perú sin lidiar con trámites de divisas internacionales.',
      badge: 'On/Off Ramps',
    },
    {
      title: 'Cobros Fáciles con Enlaces y Códigos QR',
      description:
        'Genera links de cobro personalizados en 5 segundos. Compártelos por WhatsApp, Telegram o cópialos en tu factura para que tus clientes paguen sin fricción.',
      badge: 'Checkout & Links',
    },
    {
      title: 'Transferencias P2P Instantáneas con $0 Comisiones',
      description:
        'Envía dinero a cualquier usuario por su @handle en tiempo real y sin costos ocultos, sin importar en qué país se encuentre.',
      badge: 'Cero Comisiones',
    },
    {
      title: 'Multicadena de Alta Velocidad (Base, Polygon, Arbitrum)',
      description:
        'Compatibilidad nativa con las redes de Layer 2 más rápidas y económicas para interactuar libremente con el ecosistema cripto global.',
      badge: 'Multi-Chain',
    },
  ],
};
