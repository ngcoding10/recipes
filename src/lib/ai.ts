/**
 * AI features: recipe writing and the label second opinion.
 *
 * Both need a Google sign-in. Requests go to the shared backend's Cloud Functions, which hold
 * the prompts and the API key and apply a daily limit per account.
 */
import type { GeneratedRecipe, LabelCheck, LabelCheckRequest, RecipeRequest, Usage } from './ai-shared';
import { callFunction, firebaseEnabled } from './firebase';

export type { Usage };

export class AiError extends Error {}

function requireSignIn(signedIn: boolean, what: string): void {
  if (!firebaseEnabled) throw new AiError('Sign-in is not set up on this site yet, so the AI features are switched off.');
  if (!signedIn) throw new AiError(`Sign in with Google ${what}.`);
}

/** Write a new recipe (New page). */
export async function generateRecipe(req: RecipeRequest, signedIn: boolean): Promise<{ recipe: GeneratedRecipe; usage: Usage }> {
  requireSignIn(signedIn, 'to generate recipes');
  return callFunction<RecipeRequest, { recipe: GeneratedRecipe; usage: Usage }>('pantryGenerateRecipe', req);
}

/** Second-opinion label check (Scan page). */
export async function checkLabel(req: LabelCheckRequest, signedIn: boolean): Promise<{ result: LabelCheck; usage: Usage }> {
  requireSignIn(signedIn, 'for the AI check');
  return callFunction<LabelCheckRequest, { result: LabelCheck; usage: Usage }>('pantryCheckLabel', req);
}

/** Downscale a photo to keep uploads small, and return it as base64 JPEG. */
export async function fileToJpegBase64(file: File, maxSide = 1400): Promise<string> {
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
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}
