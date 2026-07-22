// crossedDerivation.test.js
//
// Extracts the auto-derive + override logic from ScoringScreen into a pure
// function for testing, since it's stateful logic worth verifying in
// isolation rather than trusting by inspection alone.

import { test } from 'node:test';
import assert from 'node:assert';

function deriveBattersCrossed(stepperValue, crossedOverride) {
  const autoDerivedCrossed = stepperValue > 0;
  return crossedOverride !== null ? crossedOverride : autoDerivedCrossed;
}

function toggleCrossed(stepperValue, crossedOverride) {
  const currentEffectiveValue = crossedOverride !== null ? crossedOverride : stepperValue > 0;
  return !currentEffectiveValue;
}

test('No stepper used, no override -> defaults to not crossed', () => {
  assert.strictEqual(deriveBattersCrossed(0, null), false);
});

test('Stepper used, no override -> defaults to crossed', () => {
  assert.strictEqual(deriveBattersCrossed(1, null), true);
});

test('Stepper used, but scorer overrides to false via swap icon', () => {
  assert.strictEqual(deriveBattersCrossed(1, false), false);
});

test('No stepper used, but scorer overrides to true via swap icon', () => {
  assert.strictEqual(deriveBattersCrossed(0, true), true);
});

test('Toggling from the auto-derived true state flips to false', () => {
  const result = toggleCrossed(1, null); // auto says true, no override yet
  assert.strictEqual(result, false);
});

test('Toggling from the auto-derived false state flips to true', () => {
  const result = toggleCrossed(0, null); // auto says false, no override yet
  assert.strictEqual(result, true);
});

test('Toggling an existing override flips it again, not back to auto', () => {
  const result = toggleCrossed(1, false); // override already set to false
  assert.strictEqual(result, true);
});

test('Reset (override cleared) returns to auto-derivation, not stuck on last override', () => {
  // Simulates resetBallInputs() setting crossedOverride back to null for the next ball.
  const afterReset = deriveBattersCrossed(0, null);
  assert.strictEqual(afterReset, false);
});
