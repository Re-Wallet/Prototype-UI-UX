export type Language = 'es' | 'en';

export interface Translations {
  // Navigation
  navHome: string;
  navTransfer: string;
  navSettings: string;

  // Header & Balance
  yourBalance: string;
  solanaAssets: string;
  solBalance: string;
  usdcBalance: string;
  hideBalance: string;
  showBalance: string;
  deposit: string;
  withdraw: string;
  qrChargeTooltip: string;

  // Recent Transactions
  recents: string;
  seeAll: string;
  noTransactions: string;
  createdInProgress: string;
  sentCompleted: string;
  receivedCompleted: string;
  withdrawnCompleted: string;
  depositedCompleted: string;

  // Profile / Settings
  profileTitle: string;
  email: string;
  language: string;
  logout: string;

  // Keypad
  balanceLabel: string;
  continue: string;
  back: string;
  qrScannerTitle: string;
  qrScannerHint: string;
  qrScannerActivate: string;
  qrScannerDetected: string;
  qrScannerConfirm: string;
  qrScannerRescan: string;
  qrScannerDenied: string;
  qrScannerUnsupported: string;
  qrScannerPrivacy: string;
  insufficientBalance: string;

  // Withdraw Flow
  withdrawTitle: string;
  confirmWithdraw: string;
  totalToWithdraw: string;
  blockchainNetwork: string;
  destinationAddress: string;
  scanQrCode: string;
  tapToActivateCamera: string;
  confirmWithdrawAction: string;
  withdrawSent: string;
  backToWallet: string;

  // Deposit Flow
  cryptoDeposit: string;
  scanToDeposit: string;
  yourAddress: string;
  network: string;
  reference: string;
  close: string;

  // Transfer / Send Flow
  send: string;
  to: string;
  searchByUsername: string;
  choose: string;
  or: string;
  generatePaymentLink: string;
  amountToSend: string;
  noteOptional: string;
  notePlaceholder: string;
  sendFee: string;
  instantSpeed: string;
  confirmAndSend: string;
  transferSentTitle: string;

  // Payment Link Flow
  paymentLinkTitle: string;
  amountToCharge: string;
  conceptLabel: string;
  conceptPlaceholder: string;
  chargeHandle: string;
  chargeFee: string;
  generateLinkAndQr: string;
  paymentReceivedTitle: string;
  shareableLink: string;
  copyLink: string;
  linkCopied: string;
  finishAndReturn: string;

  // Receipt Modal
  receiptTitle: string;
  status: string;
  completedSuccess: string;
  inProgressValidation: string;
  methodOrNetwork: string;
  counterparty: string;
  referenceId: string;
  blockchainHash: string;
  noteMemo: string;
  download: string;
  downloaded: string;
  share: string;
  repeatTransferTo: string;
}

export const translations: Record<Language, Translations> = {
  es: {
    navHome: 'Inicio',
    navTransfer: 'Transferir',
    navSettings: 'Ajustes',

    yourBalance: 'Saldo actual',
    solanaAssets: 'Activos en Solana',
    solBalance: 'Saldo SOL',
    usdcBalance: 'Saldo USDC',
    hideBalance: 'Ocultar saldo',
    showBalance: 'Mostrar saldo',
    deposit: 'Depósito',
    withdraw: 'Retiro',
    qrChargeTooltip: 'Cobrar por QR / Payment Link',

    recents: 'Reciente',
    seeAll: 'Ver todo',
    noTransactions: 'No hay transacciones recientes',
    createdInProgress: 'Created · In progress',
    sentCompleted: 'Sent · Completed',
    receivedCompleted: 'Received · Completed',
    withdrawnCompleted: 'Retiro · Completed',
    depositedCompleted: 'Deposited · Completed',

    profileTitle: 'Perfil de Usuario',
    email: 'Correo',
    language: 'Idioma',
    logout: 'Cerrar sesión',

    balanceLabel: 'Balance:',
    continue: 'Continuar',
    back: 'Atras',
    qrScannerTitle: 'Escanear QR',
    qrScannerHint: 'Escanea un código QR de pago',
    qrScannerActivate: 'Activar cámara',
    qrScannerDetected: 'QR detectado',
    qrScannerConfirm: 'Confirmar',
    qrScannerRescan: 'Escanear otro',
    qrScannerDenied: 'Acceso a la cámara denegado',
    qrScannerUnsupported: 'Cámara no disponible',
    qrScannerPrivacy: 'El escaneo es local: la imagen nunca sale de tu dispositivo.',
    insufficientBalance: 'Saldo Insuficiente',

    withdrawTitle: 'Retiro',
    confirmWithdraw: 'Confirmar Retiro',
    totalToWithdraw: 'Total a Retirar',
    blockchainNetwork: 'Red blockchain (USDC)',
    destinationAddress: 'Dirección de destino',
    scanQrCode: 'Escanear código QR',
    tapToActivateCamera: 'Toca el botón para activar la cámara',
    confirmWithdrawAction: 'Confirmar Retiro de',
    withdrawSent: '¡Retiro Enviado!',
    backToWallet: 'Volver a la Billetera',

    cryptoDeposit: 'Crypto Deposit',
    scanToDeposit: 'Escanea para depositar USDC',
    yourAddress: 'Tu dirección',
    network: 'Red',
    reference: 'Referencia',
    close: 'Cerrar',

    send: 'Enviar',
    to: 'To',
    searchByUsername: 'Search by username',
    choose: 'Elegir',
    or: 'También puedes',
    generatePaymentLink: 'Generar link de pago',
    amountToSend: 'Monto a Enviar',
    noteOptional: 'Nota o motivo (opcional)',
    notePlaceholder: 'Ej. Almuerzo, diseño, honorarios...',
    sendFee: 'Comisión de Envío',
    instantSpeed: 'Inmediata (0 segundos)',
    confirmAndSend: 'Confirmar y Enviar',
    transferSentTitle: '¡Transferencia Enviada!',

    paymentLinkTitle: 'Payment Link',
    amountToCharge: 'Monto a Cobrar',
    conceptLabel: 'Concepto o descripción',
    conceptPlaceholder: 'Ej. Honorarios diseño, consultoría, cuota...',
    chargeHandle: 'Tu Handle de Cobro',
    chargeFee: 'Comisión de Cobro Mozaik',
    generateLinkAndQr: 'Generar Link & QR',
    paymentReceivedTitle: '¡Cobro Recibido con Éxito!',
    shareableLink: 'Enlace de cobro para compartir',
    copyLink: 'Copiar Link',
    linkCopied: '¡Copiado!',
    finishAndReturn: 'Finalizar y Volver',

    receiptTitle: 'Comprobante de Transacción',
    status: 'Estado',
    completedSuccess: 'Completado con éxito',
    inProgressValidation: 'En proceso de validación',
    methodOrNetwork: 'Método / Red',
    counterparty: 'Contraparte',
    referenceId: 'ID Referencia',
    blockchainHash: 'Hash Blockchain',
    noteMemo: 'Nota / Memo',
    download: 'Descargar',
    downloaded: '¡Descargado!',
    share: 'Compartir',
    repeatTransferTo: 'Repetir transferencia a',
  },

  en: {
    navHome: 'Home',
    navTransfer: 'Transfer',
    navSettings: 'Settings',

    yourBalance: 'Your Balance',
    solanaAssets: 'Assets on Solana',
    solBalance: 'SOL balance',
    usdcBalance: 'USDC balance',
    hideBalance: 'Hide Balance',
    showBalance: 'Show balance',
    deposit: 'Deposit',
    withdraw: 'Withdraw',
    qrChargeTooltip: 'Charge via QR / Payment Link',

    recents: 'Recents',
    seeAll: 'See All',
    noTransactions: 'No recent transactions',
    createdInProgress: 'Created · In progress',
    sentCompleted: 'Sent · Completed',
    receivedCompleted: 'Received · Completed',
    withdrawnCompleted: 'Withdrawn · Completed',
    depositedCompleted: 'Deposited · Completed',

    profileTitle: 'User Profile',
    email: 'Email',
    language: 'Language',
    logout: 'Log Out',

    balanceLabel: 'Balance:',
    continue: 'Continue',
    back: 'Back',
    qrScannerTitle: 'Scan QR',
    qrScannerHint: 'Scan a payment QR code',
    qrScannerActivate: 'Activate camera',
    qrScannerDetected: 'QR detected',
    qrScannerConfirm: 'Confirm',
    qrScannerRescan: 'Scan another',
    qrScannerDenied: 'Camera access denied',
    qrScannerUnsupported: 'Camera unavailable',
    qrScannerPrivacy: 'Scanning is local: the image never leaves your device.',
    insufficientBalance: 'Insufficient Balance',

    withdrawTitle: 'Withdraw',
    confirmWithdraw: 'Confirm Withdrawal',
    totalToWithdraw: 'Total to Withdraw',
    blockchainNetwork: 'Blockchain Network (USDC)',
    destinationAddress: 'Destination Address',
    scanQrCode: 'Scan QR Code',
    tapToActivateCamera: 'Tap button to activate camera',
    confirmWithdrawAction: 'Confirm Withdrawal of',
    withdrawSent: 'Withdrawal Sent!',
    backToWallet: 'Back to Wallet',

    cryptoDeposit: 'Crypto Deposit',
    scanToDeposit: 'Scan to deposit USDC',
    yourAddress: 'Your address',
    network: 'Network',
    reference: 'Reference',
    close: 'Close',

    send: 'Send',
    to: 'To',
    searchByUsername: 'Search by username',
    choose: 'Select',
    or: 'Or',
    generatePaymentLink: 'Generate a payment link',
    amountToSend: 'Amount to Send',
    noteOptional: 'Note or memo (optional)',
    notePlaceholder: 'E.g. Lunch, design project, fees...',
    sendFee: 'Transfer Fee',
    instantSpeed: 'Instant (0 seconds)',
    confirmAndSend: 'Confirm & Send',
    transferSentTitle: 'Transfer Sent!',

    paymentLinkTitle: 'Payment Link',
    amountToCharge: 'Amount to Charge',
    conceptLabel: 'Concept or description',
    conceptPlaceholder: 'E.g. UX design fee, consulting, split...',
    chargeHandle: 'Your Payment Handle',
    chargeFee: 'Mozaik Collection Fee',
    generateLinkAndQr: 'Generate Link & QR',
    paymentReceivedTitle: 'Payment Received Successfully!',
    shareableLink: 'Shareable payment link',
    copyLink: 'Copy Link',
    linkCopied: 'Copied!',
    finishAndReturn: 'Finish & Return',

    receiptTitle: 'Transaction Receipt',
    status: 'Status',
    completedSuccess: 'Completed successfully',
    inProgressValidation: 'Validation in progress',
    methodOrNetwork: 'Method / Network',
    counterparty: 'Counterparty',
    referenceId: 'Reference ID',
    blockchainHash: 'Blockchain Hash',
    noteMemo: 'Note / Memo',
    download: 'Download',
    downloaded: 'Downloaded!',
    share: 'Share',
    repeatTransferTo: 'Repeat transfer to',
  },
};
