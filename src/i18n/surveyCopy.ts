import type { SurveyQ1, SurveyQ2, SurveyQ3, SurveyQ4 } from '../services/survey';
import type { Language } from './translations';

/**
 * Copy for the in-app survey.
 *
 * It lives apart from the global `Translations` map for the same reason the
 * sign-in gate keeps its own map: the survey is a self-contained flow, and
 * its strings are long enough to bury the navigation and balance keys.
 *
 * The option values are typed against the survey model, so renaming an
 * answer key in `services/survey.ts` breaks the build here instead of
 * producing an option the server would reject.
 */

export interface SurveyOptionCopy<T extends string> {
  value: T;
  label: string;
}

export interface SurveyCopy {
  /** Badge on the home card. */
  badge: string;
  cardTitle: string;
  cardSubtitle: string;
  cardCta: string;

  title: string;
  intro: string;
  /** Says exactly what the answer is attributed to — and what it is not. */
  privacy: string;
  multipleHint: string;
  optionalTag: string;

  submit: string;
  sending: string;
  errorIncomplete: string;
  /** The account gave us no email to attribute the answer to. */
  errorIdentity: string;

  successTitle: string;
  successBody: string;
  successCta: string;

  questions: {
    q1: { legend: string; options: SurveyOptionCopy<SurveyQ1>[] };
    q2: { legend: string; options: SurveyOptionCopy<SurveyQ2>[] };
    q3: { legend: string; options: SurveyOptionCopy<SurveyQ3>[] };
    q4: { legend: string; options: SurveyOptionCopy<SurveyQ4>[] };
  };
}

export const surveyCopy: Record<Language, SurveyCopy> = {
  es: {
    badge: 'ANÓNIMA',
    cardTitle: 'Contanos sobre vos y tus necesidades',
    cardSubtitle: '4 preguntas · 30 segundos',
    cardCta: 'Responder',

    title: 'Encuesta anónima',
    intro: 'Cuatro preguntas rápidas para entender a quién le servimos.',
    privacy:
      'Usamos el email de tu cuenta solo para saber que la respuesta es tuya. No la vinculamos con tu wallet, tu saldo ni tus movimientos.',
    multipleHint: 'Podés elegir más de una opción.',
    optionalTag: 'Opcional',

    submit: 'ENVIAR RESPUESTAS',
    sending: 'Enviando…',
    errorIncomplete: 'Faltan respuestas por completar.',
    errorIdentity: 'No pudimos identificar tu cuenta para enviar la respuesta.',

    successTitle: '¡Gracias!',
    successBody: 'Tu respuesta nos ayuda a construir la billetera que realmente necesitás.',
    successCta: 'Cerrar',

    questions: {
      q1: {
        legend: '¿Cuál es tu objetivo principal hoy?',
        options: [
          { value: 'ahorrar', label: 'Ahorrar y protegerme de la inflación' },
          { value: 'remesas', label: 'Pagar o enviar dinero a familiares o amigos (remesas)' },
        ],
      },
      q2: {
        legend: '¿Cómo manejás tus dólares hoy?',
        options: [
          { value: 'efectivo', label: 'Efectivo (colchón o caja de seguridad)' },
          { value: 'banco', label: 'En el banco tradicional (caja de ahorro en dólares)' },
          { value: 'apps', label: 'En apps como Lemon, Belo, Ualá u otras' },
          { value: 'exchanges', label: 'En exchanges cripto (Binance, Ripio, etc.)' },
          { value: 'sin_dolares', label: 'No tengo dólares' },
        ],
      },
      q3: {
        legend: '¿Qué es lo que más te frena de las wallets cripto actuales?',
        options: [
          { value: 'miedo_claves', label: 'Me da miedo perder la clave o hacer clic mal' },
          { value: 'redes_gas', label: 'No entiendo de redes o gas' },
          { value: 'comisiones', label: 'Las comisiones son muy altas' },
          { value: 'no_necesito', label: 'No las necesito' },
        ],
      },
      q4: {
        legend: '¿Cuánto pensás mover el primer mes?',
        options: [
          { value: 'lt_50', label: 'Menos de $50' },
          { value: '50_200', label: '$50 – $200' },
          { value: '200_1000', label: '$200 – $1000' },
          { value: 'gt_1000', label: 'Más de $1000' },
        ],
      },
    },
  },

  en: {
    badge: 'ANONYMOUS',
    cardTitle: 'Tell us about you & your needs',
    cardSubtitle: '4 questions · 30 seconds',
    cardCta: 'Answer',

    title: 'Anonymous survey',
    intro: 'Four quick questions to understand who we are building for.',
    privacy:
      'We use the email on your account only to know the answer is yours. It is never linked to your wallet, your balance or your transactions.',
    multipleHint: 'You can pick more than one option.',
    optionalTag: 'Optional',

    submit: 'SEND ANSWERS',
    sending: 'Sending…',
    errorIncomplete: 'Some questions are still missing.',
    errorIdentity: 'We could not identify your account to send the answer.',

    successTitle: 'Thank you!',
    successBody: 'Your answer helps us build the wallet people actually need.',
    successCta: 'Close',

    questions: {
      q1: {
        legend: 'What is your main goal today?',
        options: [
          { value: 'ahorrar', label: 'Save and protect myself from inflation' },
          { value: 'remesas', label: 'Pay or send money to family and friends (remittances)' },
        ],
      },
      q2: {
        legend: 'How do you handle your dollars today?',
        options: [
          { value: 'efectivo', label: 'Cash (under the mattress or in a safe)' },
          { value: 'banco', label: 'In a traditional bank (dollar savings account)' },
          { value: 'apps', label: 'In apps like Lemon, Belo, Ualá or others' },
          { value: 'exchanges', label: 'In crypto exchanges (Binance, Ripio, etc.)' },
          { value: 'sin_dolares', label: 'I do not have dollars' },
        ],
      },
      q3: {
        legend: 'What stops you the most from using crypto wallets?',
        options: [
          { value: 'miedo_claves', label: 'I am afraid of losing the key or clicking wrong' },
          { value: 'redes_gas', label: 'I do not understand networks or gas' },
          { value: 'comisiones', label: 'The fees are too high' },
          { value: 'no_necesito', label: 'I do not need them' },
        ],
      },
      q4: {
        legend: 'How much do you plan to move in the first month?',
        options: [
          { value: 'lt_50', label: 'Less than $50' },
          { value: '50_200', label: '$50 – $200' },
          { value: '200_1000', label: '$200 – $1000' },
          { value: 'gt_1000', label: 'More than $1000' },
        ],
      },
    },
  },
};
