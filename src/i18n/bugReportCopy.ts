import type { Language } from './translations';

/**
 * Copy for the in-app bug report.
 *
 * Like the survey copy, it keeps its own map: the report sheet is a
 * self-contained flow and its strings do not belong with the navigation and
 * balance keys.
 */

export interface BugReportCopy {
  title: string;
  subtitle: string;

  areaLabel: string;
  whatLabel: string;
  whatPlaceholder: string;
  expectedLabel: string;
  expectedPlaceholder: string;

  contextLabel: string;
  contextShow: string;
  contextHide: string;

  privacyNote: string;
  errorEmpty: string;

  submit: string;
  opened: string;
  blocked: string;
  openAgain: string;
  copyReport: string;
  copied: string;
  close: string;
}

/** The area chips, in the language the app is showing. */
export const bugAreaLabels: Record<Language, Record<string, string>> = {
  es: {
    home: 'Inicio',
    transfer: 'Transferir',
    deposit: 'Depósito',
    withdraw: 'Retiro',
    qr: 'Escanear QR',
    activity: 'Actividad',
    survey: 'Encuesta',
    other: 'Otro',
  },
  en: {
    home: 'Home',
    transfer: 'Transfer',
    deposit: 'Deposit',
    withdraw: 'Withdraw',
    qr: 'QR scan',
    activity: 'Activity',
    survey: 'Survey',
    other: 'Other',
  },
};

export const bugReportCopy: Record<Language, BugReportCopy> = {
  es: {
    title: 'Reportar un problema',
    subtitle: 'Armamos la issue en GitHub con el contexto de tu sesión.',

    areaLabel: '¿Dónde pasó?',
    whatLabel: '¿Qué pasó?',
    whatPlaceholder: 'Qué hiciste y qué pasó en pantalla.',
    expectedLabel: '¿Qué esperabas que pasara? (opcional)',
    expectedPlaceholder: 'Lo que esperabas que hiciera la app.',

    contextLabel: 'Contexto que se adjunta',
    contextShow: 'Ver contexto',
    contextHide: 'Ocultar contexto',

    privacyNote:
      'No incluimos tu email ni ninguna clave privada. Sí incluimos tu address de wallet, que es pública en la red.',
    errorEmpty: 'Contanos qué pasó para armar el reporte.',

    submit: 'ABRIR EN GITHUB',
    opened: 'Abrimos GitHub en una pestaña nueva: revisá el reporte y publicá la issue.',
    blocked: 'El navegador bloqueó la pestaña. Copiá el reporte y pegalo en GitHub.',
    openAgain: 'ABRIR DE NUEVO',
    copyReport: 'COPIAR EL REPORTE',
    copied: '¡Copiado!',
    close: 'Cerrar',
  },

  en: {
    title: 'Report a problem',
    subtitle: 'We build the GitHub issue with your session context.',

    areaLabel: 'Where did it happen?',
    whatLabel: 'What happened?',
    whatPlaceholder: 'What you did and what you saw on screen.',
    expectedLabel: 'What did you expect instead? (optional)',
    expectedPlaceholder: 'What the app was supposed to do.',

    contextLabel: 'Context that gets attached',
    contextShow: 'Show context',
    contextHide: 'Hide context',

    privacyNote:
      'Your email and any private key are never included. Your wallet address is, because it is public on the network.',
    errorEmpty: 'Tell us what happened so we can build the report.',

    submit: 'OPEN IN GITHUB',
    opened: 'GitHub opened in a new tab: review the report and submit the issue.',
    blocked: 'The browser blocked the tab. Copy the report and paste it into GitHub.',
    openAgain: 'OPEN AGAIN',
    copyReport: 'COPY THE REPORT',
    copied: 'Copied!',
    close: 'Close',
  },
};
