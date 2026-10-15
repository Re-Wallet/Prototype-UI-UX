export type Language = 'es' | 'en';

export interface Translations {
  // Navigation
  navHome: string;
  navTransfer: string;
  navSettings: string;

  // Header & Balance
  yourBalance: string;
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
  fullName: string;
  email: string;
  registeredPhone: string;
  language: string;
  logout: string;
  logoutConfirmMessage: string;

  // Keypad
  balanceLabel: string;
  continue: string;
  insufficientBalance: string;

  // Withdraw Flow
  withdrawTitle: string;
  confirmWithdraw: string;
  totalToWithdraw: string;
  blockchainNetwork: string;
  destinationAddress: string;
  scanQrCode: string;
  tapToActivateCamera: string;
  scanningBase: string;
  detectBaseQr: string;
  qrScannedSuccess: string;
  destinationOnBase: string;
  baseQrScanned: string;
  withdrawalFee: string;
  zeroFees: string;
  estimatedTime: string;
  confirmWithdrawAction: string;
  withdrawSent: string;
  withdrawSentDesc: string;
  backToWallet: string;

  // Deposit Flow
  cryptoDeposit: string;
  scanToDeposit: string;
  yourAddress: string;
  simulateDepositArrival: string;
  detectingDeposit: string;
  depositSuccessTitle: string;
  depositSuccessDesc: string;
  creditedAmount: string;
  network: string;
  reference: string;
  newBalance: string;
  goToHome: string;
  close: string;

  // Transfer / Send Flow
  send: string;
  to: string;
  searchByUsername: string;
  choose: string;
  recentContacts: string;
  or: string;
  generatePaymentLink: string;
  amountToSend: string;
  noteOptional: string;
  notePlaceholder: string;
  sendFee: string;
  instantSpeed: string;
  confirmAndSend: string;
  transferSentTitle: string;
  transferSentDesc: string;

  // Payment Link Flow
  paymentLinkTitle: string;
  amountToCharge: string;
  conceptLabel: string;
  conceptPlaceholder: string;
  clientPayerLabel: string;
  clientPayerPlaceholder: string;
  chargeHandle: string;
  chargeFee: string;
  generateLinkAndQr: string;
  paymentReceivedTitle: string;
  shareableLink: string;
  copyLink: string;
  linkCopied: string;
  simulateClientPay: string;
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
    navHome: 'Home',
    navTransfer: 'Transfer',
    navSettings: 'Settings',

    yourBalance: 'Saldo actual',
    hideBalance: 'Ocultar saldo',
    showBalance: 'Mostrar saldo',
    deposit: 'Deposit',
    withdraw: 'Retiro',
    qrChargeTooltip: 'Cobrar por QR / Payment Link',

    recents: 'Recents',
    seeAll: 'See All',
    noTransactions: 'No hay transacciones recientes',
    createdInProgress: 'Created · In progress',
    sentCompleted: 'Sent · Completed',
    receivedCompleted: 'Received · Completed',
    withdrawnCompleted: 'Retiro · Completed',
    depositedCompleted: 'Deposited · Completed',

    profileTitle: 'Perfil de Usuario',
    fullName: 'Nombre y Apellido',
    email: 'Correo',
    registeredPhone: 'Teléfono registro',
    language: 'Idioma',
    logout: 'Cerrar sesión',
    logoutConfirmMessage: 'Se reestableció el saldo a Ⓢ 423.25.',

    balanceLabel: 'Balance:',
    continue: 'Continuar',
    insufficientBalance: 'Saldo Insuficiente',

    withdrawTitle: 'Retiro',
    confirmWithdraw: 'Confirmar Retiro',
    totalToWithdraw: 'Total a Retirar',
    blockchainNetwork: 'Red blockchain (USDC)',
    destinationAddress: 'Dirección de destino',
    scanQrCode: 'Escanear código QR',
    tapToActivateCamera: 'Toca el botón para activar la cámara',
    scanningBase: '● Escaneando Base',
    detectBaseQr: 'Detectar QR Base',
    qrScannedSuccess: '¡QR Escaneado!',
    destinationOnBase: 'Destino detectado en Base',
    baseQrScanned: 'QR Base Escaneado',
    withdrawalFee: 'Comisión de Retiro Mozaik',
    zeroFees: '$0.00 (Sin comisiones)',
    estimatedTime: '1 - 3 minutos',
    confirmWithdrawAction: 'Confirmar Retiro de',
    withdrawSent: '¡Retiro Enviado!',
    withdrawSentDesc: 'Los fondos están en camino a tu destino seleccionado.',
    backToWallet: 'Volver a la Billetera',

    cryptoDeposit: 'Crypto Deposit',
    scanToDeposit: 'Escanea para depositar USDC',
    yourAddress: 'Tu dirección',
    simulateDepositArrival: 'Simular llegada de depósito',
    detectingDeposit: 'Detectando transacción...',
    depositSuccessTitle: '¡Depósito Exitoso!',
    depositSuccessDesc: 'Se han acreditado tus dólares digitales en tu billetera Mozaik.',
    creditedAmount: 'Monto Acreditado',
    network: 'Red',
    reference: 'Referencia',
    newBalance: 'Nuevo Saldo',
    goToHome: 'Ir al Inicio',
    close: 'Cerrar',

    send: 'Send',
    to: 'To',
    searchByUsername: 'Search by username',
    choose: 'Elegir',
    recentContacts: 'Recent',
    or: 'Or',
    generatePaymentLink: 'Generate a payment link',
    amountToSend: 'Monto a Enviar',
    noteOptional: 'Nota o motivo (opcional)',
    notePlaceholder: 'Ej. Almuerzo, diseño, honorarios...',
    sendFee: 'Comisión de Envío',
    instantSpeed: 'Inmediata (0 segundos)',
    confirmAndSend: 'Confirmar y Enviar',
    transferSentTitle: '¡Transferencia Enviada!',
    transferSentDesc: 'ya tiene disponibles los dólares digitales en su cuenta.',

    paymentLinkTitle: 'Payment Link',
    amountToCharge: 'Monto a Cobrar',
    conceptLabel: 'Concepto o descripción',
    conceptPlaceholder: 'Ej. Honorarios diseño, consultoría, cuota...',
    clientPayerLabel: 'Cliente o empresa a cobrar (referencia)',
    clientPayerPlaceholder: 'Nombre del pagador...',
    chargeHandle: 'Tu Handle de Cobro',
    chargeFee: 'Comisión de Cobro Mozaik',
    generateLinkAndQr: 'Generar Link & QR',
    paymentReceivedTitle: '¡Cobro Recibido con Éxito!',
    shareableLink: 'Enlace de cobro para compartir',
    copyLink: 'Copiar Link',
    linkCopied: '¡Copiado!',
    simulateClientPay: 'Simular pago de cliente ahora',
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
    hideBalance: 'Hide balance',
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
    fullName: 'Full Name',
    email: 'Email',
    registeredPhone: 'Registered Phone',
    language: 'Language',
    logout: 'Log Out',
    logoutConfirmMessage: 'Session balance reset to Ⓢ 423.25.',

    balanceLabel: 'Balance:',
    continue: 'Continue',
    insufficientBalance: 'Insufficient Balance',

    withdrawTitle: 'Withdraw',
    confirmWithdraw: 'Confirm Withdrawal',
    totalToWithdraw: 'Total to Withdraw',
    blockchainNetwork: 'Blockchain Network (USDC)',
    destinationAddress: 'Destination Address',
    scanQrCode: 'Scan QR Code',
    tapToActivateCamera: 'Tap button to activate camera',
    scanningBase: '● Scanning Base',
    detectBaseQr: 'Detect Base QR',
    qrScannedSuccess: 'QR Code Scanned!',
    destinationOnBase: 'Destination detected on Base',
    baseQrScanned: 'Base QR Scanned',
    withdrawalFee: 'Mozaik Withdrawal Fee',
    zeroFees: '$0.00 (Zero Fees)',
    estimatedTime: '1 - 3 minutes',
    confirmWithdrawAction: 'Confirm Withdrawal of',
    withdrawSent: 'Withdrawal Sent!',
    withdrawSentDesc: 'Funds are on their way to your selected destination.',
    backToWallet: 'Back to Wallet',

    cryptoDeposit: 'Crypto Deposit',
    scanToDeposit: 'Scan to deposit USDC',
    yourAddress: 'Your address',
    simulateDepositArrival: 'Simulate incoming deposit',
    detectingDeposit: 'Detecting incoming transaction...',
    depositSuccessTitle: 'Deposit Successful!',
    depositSuccessDesc: 'Digital dollars have been credited to your Mozaik wallet.',
    creditedAmount: 'Credited Amount',
    network: 'Network',
    reference: 'Reference',
    newBalance: 'New Balance',
    goToHome: 'Go to Home',
    close: 'Close',

    send: 'Send',
    to: 'To',
    searchByUsername: 'Search by username',
    choose: 'Select',
    recentContacts: 'Recent',
    or: 'Or',
    generatePaymentLink: 'Generate a payment link',
    amountToSend: 'Amount to Send',
    noteOptional: 'Note or memo (optional)',
    notePlaceholder: 'E.g. Lunch, design project, fees...',
    sendFee: 'Transfer Fee',
    instantSpeed: 'Instant (0 seconds)',
    confirmAndSend: 'Confirm & Send',
    transferSentTitle: 'Transfer Sent!',
    transferSentDesc: 'now has the digital dollars available in their account.',

    paymentLinkTitle: 'Payment Link',
    amountToCharge: 'Amount to Charge',
    conceptLabel: 'Concept or description',
    conceptPlaceholder: 'E.g. UX design fee, consulting, split...',
    clientPayerLabel: 'Client or payer (reference)',
    clientPayerPlaceholder: 'Payer company or name...',
    chargeHandle: 'Your Payment Handle',
    chargeFee: 'Mozaik Collection Fee',
    generateLinkAndQr: 'Generate Link & QR',
    paymentReceivedTitle: 'Payment Received Successfully!',
    shareableLink: 'Shareable payment link',
    copyLink: 'Copy Link',
    linkCopied: 'Copied!',
    simulateClientPay: 'Simulate client payment now',
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
