/**
 * The logic of each Cloud Function, free of Firebase and Anthropic wiring so it can be tested
 * with fakes (src/handlers.test.ts). index.ts supplies the real dependencies.
 */
import type { ZodType } from 'zod/v4';
import {
  GeneratedRecipeSchema, LabelCheckSchema, RecipeRequestSchema, recipePrompt, labelPrompt,
  type GeneratedRecipe, type LabelCheck, type RecipeRequest,
} from '../../src/lib/ai-shared';
import { zeroIngredientNames } from '../../src/lib/zero-list';

export interface Usage { used: number; limit: number }

export class UserFacingError extends Error {
  constructor(public code: 'invalid-argument' | 'unauthenticated' | 'resource-exhausted' | 'failed-precondition' | 'unavailable' | 'internal', message: string) { super(message); }
}

export type Content = string | Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg'; data: string } }>;

export interface Deps {
  /** One structured model call; resolves to the parsed object. */
  ask<T>(schema: ZodType<T>, system: string, content: Content, maxTokens: number): Promise<T>;
  /** Count one request for this user today; throws resource-exhausted when over a limit. */
  consume(uid: string): Promise<Usage>;
  /** Give the request back when the model call failed. */
  refund(uid: string): Promise<void>;
}

const MAX_INGREDIENTS = 40;
const MAX_TEXT = 6000;
const MAX_IMAGE_B64 = 2_500_000; // about 1.8 MB of JPEG; the site sends ~1400 px images

const clean = (s: unknown, n: number) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);

/** Validate and normalise a recipe request from the browser. */
export function parseRecipeRequest(data: unknown): RecipeRequest {
  const r = RecipeRequestSchema.safeParse(data);
  if (!r.success) throw new UserFacingError('invalid-argument', 'That request was not understood. Reload the page and try again.');
  const v = r.data;
  const ingredients = [...new Set(v.ingredients.map((i) => clean(i, 60).toLowerCase()).filter(Boolean))].slice(0, MAX_INGREDIENTS);
  return {
    ingredients,
    meal: v.meal,
    servings: Math.min(12, Math.max(1, Math.round(v.servings) || 2)),
    maxMinutes: Math.min(240, Math.max(0, Math.round(v.maxMinutes) || 0)),
    diets: v.diets.map((d) => clean(d, 30)).filter(Boolean).slice(0, 8),
    strict: v.strict,
    avoidZero: v.avoidZero,
    note: clean(v.note, 300),
  };
}

async function metered<T>(uid: string | undefined, deps: Deps, run: () => Promise<T>): Promise<{ value: T; usage: Usage }> {
  if (!uid) throw new UserFacingError('unauthenticated', 'Sign in with Google first.');
  const usage = await deps.consume(uid);
  try {
    return { value: await run(), usage };
  } catch (e) {
    await deps.refund(uid).catch(() => {});
    throw e;
  }
}

export async function handleGenerateRecipe(uid: string | undefined, data: unknown, deps: Deps): Promise<{ recipe: GeneratedRecipe; usage: Usage }> {
  const req = parseRecipeRequest(data);
  const { system, user } = recipePrompt(req, req.avoidZero ? zeroIngredientNames() : []);
  const { value, usage } = await metered(uid, deps, () => deps.ask(GeneratedRecipeSchema, system, user, 6000));
  return { recipe: value, usage };
}

export async function handleCheckLabel(uid: string | undefined, data: any, deps: Deps): Promise<{ result: LabelCheck; usage: Usage }> {
  const kind = data?.kind === 'cosmetic' || data?.kind === 'household' ? data.kind : 'food';
  const text = clean(data?.text, MAX_TEXT);
  const image = typeof data?.image === 'string' && data.image.length ? data.image : null;
  if (image && (image.length > MAX_IMAGE_B64 || !/^[A-Za-z0-9+/=]+$/.test(image.slice(0, 2000)))) throw new UserFacingError('invalid-argument', 'That photo is too large or not a JPEG.');
  if (!text && !image) throw new UserFacingError('invalid-argument', 'There is no label text or photo to check.');
  const flagged = Array.isArray(data?.flagged) ? data.flagged.slice(0, 40).map((f: unknown) => clean(f, 120)) : [];
  const { system, user } = labelPrompt({ kind, text, hasImage: !!image, flagged });
  const content: Content = [
    ...(image ? [{ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: image } }] : []),
    { type: 'text' as const, text: user },
  ];
  const { value, usage } = await metered(uid, deps, () => deps.ask(LabelCheckSchema, system, content, 6000));
  value.score = Math.max(0, Math.min(100, Math.round(value.score)));
  return { result: value, usage };
}
