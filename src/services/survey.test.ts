import assert from 'node:assert/strict';
import test from 'node:test';

import {
  EMPTY_SURVEY_ANSWERS,
  buildSurveyPayload,
  isSurveyComplete,
  missingSurveyAnswers,
  submitSurvey,
  type SurveyAnswers,
} from './survey';

const identity = {
  email: 'consulta@rewallet.app',
  firstName: 'Camila',
  lastName: 'Tteriola Vayen',
};

const complete: SurveyAnswers = {
  q1: 'ahorrar',
  q2: ['efectivo', 'apps'],
  q3: 'redes_gas',
  q4: '50_200',
};

test('marks q1, q2 and q3 as missing while q4 stays optional', () => {
  assert.deepEqual(missingSurveyAnswers(EMPTY_SURVEY_ANSWERS), ['q1', 'q2', 'q3']);
  assert.equal(isSurveyComplete(EMPTY_SURVEY_ANSWERS), false);

  const withoutQ4: SurveyAnswers = { ...complete, q4: null };
  assert.deepEqual(missingSurveyAnswers(withoutQ4), []);
  assert.equal(isSurveyComplete(withoutQ4), true);
});

test('requires at least one option for the multi-select question', () => {
  const noQ2: SurveyAnswers = { ...complete, q2: [] };
  assert.deepEqual(missingSurveyAnswers(noQ2), ['q2']);
  assert.equal(isSurveyComplete(noQ2), false);
});

test('builds the exact wire payload the survey endpoint accepts', () => {
  const payload = buildSurveyPayload(complete, identity);

  assert.deepEqual(payload, {
    name: 'Camila',
    lastName: 'Tteriola Vayen',
    email: 'consulta@rewallet.app',
    q1: 'ahorrar',
    q2: ['efectivo', 'apps'],
    q3: 'redes_gas',
    q4: '50_200',
  });
});

test('keeps q4 null when the optional question is skipped', () => {
  const payload = buildSurveyPayload({ ...complete, q4: null }, identity);
  assert.equal(payload?.q4, null);
});

test('refuses to build a payload from incomplete or malformed answers', () => {
  assert.equal(buildSurveyPayload(EMPTY_SURVEY_ANSWERS, identity), null);
  assert.equal(buildSurveyPayload({ ...complete, q1: null }, identity), null);
  assert.equal(
    buildSurveyPayload({ ...complete, q3: 'not_a_valid_option' as never }, identity),
    null
  );
  assert.equal(
    buildSurveyPayload({ ...complete, q2: ['efectivo', 'not_a_valid_option' as never] }, identity),
    null
  );
});

test('refuses to build a payload without an email to attribute it to', () => {
  assert.equal(buildSurveyPayload(complete, { ...identity, email: null }), null);
  assert.equal(buildSurveyPayload(complete, { ...identity, email: '  ' }), null);
  assert.equal(buildSurveyPayload(complete, { ...identity, email: 'not-an-email' }), null);
});

test('does not persist anything yet and says so', async () => {
  const payload = buildSurveyPayload(complete, identity);
  assert.ok(payload);

  const result = await submitSurvey(payload);

  assert.equal(result.ok, true);
  assert.equal(result.saved, false);
});
