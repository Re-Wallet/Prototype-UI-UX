/**
 * The in-app survey ("Encuesta anónima").
 *
 * The survey is the same one the landing page runs: four questions about what
 * the user does with their dollars today, what stops them from using crypto
 * wallets, and how much they would move in the first month. The landing asks
 * for name, last name and email first; inside the app that step is gone —
 * the account already knows who the user is, so the survey goes straight to
 * the questions.
 *
 * This module owns the part of the survey that must be correct regardless of
 * the UI: the allowed answer keys, which questions are required, and the wire
 * payload. The payload is shaped exactly like the body of
 * `POST /api/landing/survey` (see server.ts), so connecting the database
 * later is a single call and not a rewrite.
 *
 * The allowed keys are duplicated from the server on purpose: the server
 * validates them too, and a client that drifts from the server would only
 * find out at the 400.
 */

export const SURVEY_Q1_VALUES = ['ahorrar', 'remesas'] as const;
export const SURVEY_Q2_VALUES = [
  'efectivo',
  'banco',
  'apps',
  'exchanges',
  'sin_dolares',
] as const;
export const SURVEY_Q3_VALUES = [
  'miedo_claves',
  'redes_gas',
  'comisiones',
  'no_necesito',
] as const;
export const SURVEY_Q4_VALUES = ['lt_50', '50_200', '200_1000', 'gt_1000'] as const;

export type SurveyQ1 = (typeof SURVEY_Q1_VALUES)[number];
export type SurveyQ2 = (typeof SURVEY_Q2_VALUES)[number];
export type SurveyQ3 = (typeof SURVEY_Q3_VALUES)[number];
export type SurveyQ4 = (typeof SURVEY_Q4_VALUES)[number];

/** The questions the survey asks, in the order they are rendered. */
export type SurveyQuestionId = 'q1' | 'q2' | 'q3' | 'q4';

export interface SurveyAnswers {
  q1: SurveyQ1 | null;
  /** Multi-select: the user can hold dollars in more than one place. */
  q2: SurveyQ2[];
  q3: SurveyQ3 | null;
  /** Optional by design: the amount someone would move is a private guess. */
  q4: SurveyQ4 | null;
}

export const EMPTY_SURVEY_ANSWERS: SurveyAnswers = {
  q1: null,
  q2: [],
  q3: null,
  q4: null,
};

/**
 * Who the answer belongs to.
 *
 * Everything here comes from the signed-in account — the user never types it.
 * `email` is the one field the answer is attributed to; the name is only
 * there because the future survey row keeps it.
 */
export interface SurveyIdentity {
  email: string | null | undefined;
  firstName?: string | null;
  lastName?: string | null;
}

/**
 * The body of `POST /api/landing/survey`.
 *
 * `name` and `lastName` mirror the `landing_survey_responses` columns, which
 * are NOT NULL today. They are filled with whatever the account exposes and
 * may come back empty; the database step has to decide between relaxing the
 * constraint and splitting the account name.
 */
export interface SurveyPayload {
  name: string;
  lastName: string;
  email: string;
  q1: SurveyQ1;
  q2: SurveyQ2[];
  q3: SurveyQ3;
  q4: SurveyQ4 | null;
}

export interface SurveySubmitResult {
  ok: boolean;
  /** False while the survey is not persisted yet. */
  saved: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isQ1(value: unknown): value is SurveyQ1 {
  return SURVEY_Q1_VALUES.includes(value as SurveyQ1);
}

function isQ2(value: unknown): value is SurveyQ2 {
  return SURVEY_Q2_VALUES.includes(value as SurveyQ2);
}

function isQ3(value: unknown): value is SurveyQ3 {
  return SURVEY_Q3_VALUES.includes(value as SurveyQ3);
}

function isQ4(value: unknown): value is SurveyQ4 {
  return SURVEY_Q4_VALUES.includes(value as SurveyQ4);
}

/**
 * The questions still unanswered. `q4` never appears: it is optional.
 */
export function missingSurveyAnswers(answers: SurveyAnswers): SurveyQuestionId[] {
  const missing: SurveyQuestionId[] = [];
  if (!isQ1(answers.q1)) missing.push('q1');
  if (!Array.isArray(answers.q2) || answers.q2.length === 0 || !answers.q2.every(isQ2)) {
    missing.push('q2');
  }
  if (!isQ3(answers.q3)) missing.push('q3');
  return missing;
}

/** True when every required question has a valid answer. */
export function isSurveyComplete(answers: SurveyAnswers): boolean {
  return missingSurveyAnswers(answers).length === 0;
}

/**
 * Build the wire payload, or null when the answers are not ready to be sent.
 *
 * Null covers three cases on purpose: a required question is unanswered, an
 * answer key is not one the server accepts, and there is no email to
 * attribute the answer to.
 */
export function buildSurveyPayload(
  answers: SurveyAnswers,
  identity: SurveyIdentity
): SurveyPayload | null {
  if (!isSurveyComplete(answers)) return null;

  const email = (identity.email ?? '').trim();
  if (!EMAIL_RE.test(email)) return null;

  const { q1, q2, q3, q4 } = answers;
  // `isSurveyComplete` already proved these, but the payload needs the
  // narrowed types — and a cast would hide a future drift between the
  // allowed keys here and the ones the server accepts.
  if (!isQ1(q1)) return null;
  if (!isQ3(q3)) return null;
  if (q4 !== null && !isQ4(q4)) return null;

  return {
    name: (identity.firstName ?? '').trim(),
    lastName: (identity.lastName ?? '').trim(),
    email,
    q1,
    q2: [...q2],
    q3,
    q4: q4 ?? null,
  };
}

/**
 * Hand the payload over.
 *
 * The prototype does not persist anything yet: the answers stay in the UI
 * and the payload is logged so the shape can be inspected while the flow is
 * being tested. The POST to `/api/landing/survey` goes here, behind the same
 * result shape, when the database connection is made.
 */
export async function submitSurvey(payload: SurveyPayload): Promise<SurveySubmitResult> {
  console.info('[survey] payload (not persisted yet)', payload);
  return { ok: true, saved: false };
}
