// Tests for the function logic with a fake model and an in-memory usage counter: `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleCheckLabel, handleGenerateRecipe, parseRecipeRequest, UserFacingError, type Deps } from './handlers';

const recipe = {
  title: 'Garlic Spinach Eggs', description: 'Quick.', meal: 'breakfast', servings: 2, prepMin: 5, cookMin: 10, totalTimeMin: 15, difficulty: 'Easy',
  ingredients: [{ amount: 4, unit: '', us: '', item: 'eggs', note: '', fromPantry: true }], steps: ['Cook.'], tips: [],
  nutrition: { calories: 300, protein_g: 20, carbs_g: 5, fat_g: 20, fiber_g: 2 }, needsToBuy: [],
};

function fakeDeps(limit = 2, fail = false) {
  const counts = new Map<string, number>();
  const calls: Array<{ system: string; content: unknown }> = [];
  const deps: Deps = {
    async ask(_schema, system, content) {
      calls.push({ system, content });
      if (fail) throw Object.assign(new Error('overloaded'), { status: 529 });
      return (typeof content === 'string' ? recipe : { productGuess: 'x', score: 140, summary: '', nutritionNotes: '', items: [], concerns: [], positives: [], swaps: [], confidence: 'low' }) as any;
    },
    async consume(uid) {
      const n = (counts.get(uid) ?? 0);
      if (n >= limit) throw new UserFacingError('resource-exhausted', 'limit');
      counts.set(uid, n + 1);
      return { used: n + 1, limit };
    },
    async refund(uid) { counts.set(uid, (counts.get(uid) ?? 1) - 1); },
  };
  return { deps, calls, counts };
}

const goodReq = { ingredients: ['Eggs', 'spinach', 'eggs', ''], meal: 'breakfast', servings: 2, maxMinutes: 20, diets: ['vegetarian'], strict: true, avoidZero: true, note: 'quick' };

test('requests are cleaned and bounded', () => {
  const r = parseRecipeRequest({ ...goodReq, servings: 99, maxMinutes: -5, note: 'x'.repeat(1000) });
  assert.deepEqual(r.ingredients, ['eggs', 'spinach']);
  assert.equal(r.servings, 12);
  assert.equal(r.maxMinutes, 0);
  assert.equal(r.note.length, 300);
});

test('bad input is rejected before anything is spent', async () => {
  const { deps, counts } = fakeDeps();
  await assert.rejects(handleGenerateRecipe('u1', { meal: 'brunch' }, deps), (e: any) => e.code === 'invalid-argument');
  assert.equal(counts.size, 0);
});

test('signed-out callers are refused', async () => {
  const { deps } = fakeDeps();
  await assert.rejects(handleGenerateRecipe(undefined, goodReq, deps), (e: any) => e.code === 'unauthenticated');
});

test('recipe prompt carries meal, limits and the zero list', async () => {
  const { deps, calls } = fakeDeps();
  const out = await handleGenerateRecipe('u1', goodReq, deps);
  assert.equal(out.recipe.title, 'Garlic Spinach Eggs');
  assert.deepEqual(out.usage, { used: 1, limit: 2 });
  assert.match(calls[0].system, /breakfast/);
  assert.match(calls[0].system, /20 or less/);
  assert.match(calls[0].system, /vegetarian/);
  assert.match(calls[0].system, /Processed meat/);
  assert.match(calls[0].system, /Use only the listed ingredients/);
});

test('daily limit is enforced', async () => {
  const { deps } = fakeDeps(1);
  await handleGenerateRecipe('u1', goodReq, deps);
  await assert.rejects(handleGenerateRecipe('u1', goodReq, deps), (e: any) => e.code === 'resource-exhausted');
  await handleGenerateRecipe('u2', goodReq, deps); // other users unaffected
});

test('a failed model call does not use up the allowance', async () => {
  const { deps, counts } = fakeDeps(2, true);
  await assert.rejects(handleGenerateRecipe('u1', goodReq, deps));
  assert.equal(counts.get('u1'), 0);
});

test('label check validates the photo and clamps the score', async () => {
  const { deps, calls } = fakeDeps();
  await assert.rejects(handleCheckLabel('u1', { kind: 'food', text: '', image: null }, deps), (e: any) => e.code === 'invalid-argument');
  await assert.rejects(handleCheckLabel('u1', { kind: 'food', text: 'x', image: '<script>' }, deps), (e: any) => e.code === 'invalid-argument');
  const out = await handleCheckLabel('u1', { kind: 'food', text: 'Ingredients: sugar', image: null, flagged: ['Sugar = 44'] }, deps);
  assert.equal(out.result.score, 100);
  assert.match(JSON.stringify(calls[0].content), /Sugar = 44/);
});
