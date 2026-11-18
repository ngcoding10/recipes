/**
 * AI features: recipe writing and the label second opinion.
 *
 * Two routes. When Firebase is set up and you are signed in with Google, requests go to the
 * site's Cloud Functions, which hold the owner's key and apply daily limits. Otherwise you can
 * paste your own Anthropic API key; it stays in localStorage on this device and is sent only
 * to api.anthropic.com.
 */

import type { ZodType } from 'zod/v4';
import { MODEL, EFFORT, GeneratedRecipeSchema, LabelCheckSchema, recipePrompt, labelPrompt, type GeneratedRecipe, type LabelCheck, type LabelCheckRequest, type RecipeRequest } from './ai-shared';
import { callFunction, firebaseEnabled } from './firebase';

export { MODEL };
const KEY_STORAGE = 'pantry.anthropicKey';
export const KEY_EVENT = 'pantry:key';

export function getKey(): string {
  try { return localStorage.getItem(KEY_STORAGE) ?? ''; } catch { return ''; }
}
export function setKey(key: string): void {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key.trim());
    else localStorage.removeItem(KEY_STORAGE);
  } catch { /* private mode etc. */ }
  try { window.dispatchEvent(new CustomEvent(KEY_EVENT)); } catch { /* noop */ }
}
export function maskKey(key: string): string {
  if (!key) return '';
  return key.length <= 12 ? '••••' : `${key.slice(0, 10)}…${key.slice(-4)}`;
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

export class AiError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}

/**
 * One structured Messages API call with the person's own key, straight from the browser.
 * Uses the official SDK; the output is validated against the Zod schema before it is returned.
 */
async function askWithOwnKey<T>(schema: ZodType<T>, system: string, content: ContentBlock[] | string, maxTokens: number): Promise<T> {
  const key = getKey();
  if (!key) throw new AiError('No API key saved. Add one on the Account page.', 0);
  const [{ default: Anthropic }, { zodOutputFormat }] = await Promise.all([
    import('@anthropic-ai/sdk'), import('@anthropic-ai/sdk/helpers/zod'),
  ]);
  // The key belongs to the person using the page and is sent only to api.anthropic.com.
  const client = new Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2 });
  try {
    const res = await client.messages.parse({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: content as any }],
      output_config: { effort: EFFORT, format: zodOutputFormat(schema as any) },
    });
    if (res.stop_reason === 'refusal') throw new AiError('The model declined this request. Try different wording.');
    if (res.stop_reason === 'max_tokens') throw new AiError('The answer was cut off. Try again.');
    if (!res.parsed_output) throw new AiError('The model did not return the expected format. Try again.');
    return res.parsed_output as T;
  } catch (e: any) {
    if (e instanceof AiError) throw e;
    const status: number | undefined = e?.status;
    const detail: string = e?.error?.error?.message ?? e?.message ?? '';
    if (status === 401) throw new AiError('That API key was rejected. Check it on the Account page.', 401);
    if (status === 400 && /credit|billing/i.test(detail)) throw new AiError('Your Anthropic account has no credit left. Top up at console.anthropic.com.', 400);
    if (status === 429) throw new AiError('Rate limited by Anthropic. Wait a moment and try again.', 429);
    if (status === 529 || status === 503) throw new AiError('Anthropic is busy right now. Try again in a minute.', status);
    if (!status) throw new AiError('Could not reach Anthropic. Check your connection and try again.');
    throw new AiError(detail || `Request failed (${status}).`, status);
  }
}

/** Which way an AI request will run, for the UI. */
export type AiRoute = 'account' | 'own-key' | 'none';
export function aiRoute(signedIn: boolean): AiRoute {
  if (firebaseEnabled && signedIn) return 'account';
  if (getKey()) return 'own-key';
  return 'none';
}

export interface Usage { used: number; limit: number }

/** Write a new recipe: on the site's account when signed in, otherwise with your own key. */
export async function generateRecipe(req: RecipeRequest, signedIn: boolean): Promise<{ recipe: GeneratedRecipe; usage?: Usage }> {
  const route = aiRoute(signedIn);
  if (route === 'account') return callFunction<RecipeRequest, { recipe: GeneratedRecipe; usage: Usage }>('generateRecipe', req);
  if (route === 'none') throw new AiError(firebaseEnabled ? 'Sign in with Google (or add your own API key) to generate recipes.' : 'Add an Anthropic API key on the Account page to generate recipes.');
  const { zeroIngredientNames } = await import('./zero-list');
  const { system, user } = recipePrompt(req, req.avoidZero ? zeroIngredientNames() : []);
  return { recipe: await askWithOwnKey(GeneratedRecipeSchema, system, user, 6000) };
}

/** Second-opinion label check (Scan page). */
export async function checkLabel(req: LabelCheckRequest, image: (ContentBlock & { type: 'image' }) | null, signedIn: boolean): Promise<{ result: LabelCheck; usage?: Usage }> {
  const route = aiRoute(signedIn);
  if (route === 'account') return callFunction<LabelCheckRequest & { image: string | null }, { result: LabelCheck; usage: Usage }>('checkLabel', { ...req, image: image ? image.source.data : null });
  if (route === 'none') throw new AiError(firebaseEnabled ? 'Sign in with Google (or add your own API key) for the AI check.' : 'Add an Anthropic API key on the Account page for the AI check.');
  const { system, user } = labelPrompt(req);
  const content: ContentBlock[] = [...(image ? [image] : []), { type: 'text', text: user }];
  return { result: await askWithOwnKey(LabelCheckSchema, system, content, 6000) };
}

/** Downscale an image file to keep uploads small, and return base64 JPEG. */
export async function fileToImageBlock(file: File, maxSide = 1400): Promise<ContentBlock & { type: 'image' }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new AiError('Could not read that image.'));
      el.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new AiError('Canvas unavailable.');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: dataUrl.split(',')[1] } };
  } finally {
    URL.revokeObjectURL(url);
  }
}
