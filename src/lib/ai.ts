/**
 * Browser-side Anthropic client for the optional AI features.
 *
 * The site is static (GitHub Pages), so there is no server to hold a key.
 * The user pastes their own API key once; it lives in localStorage on that
 * device only and is sent to api.anthropic.com and nowhere else.
 */

const KEY_STORAGE = 'pantry.anthropicKey';
export const MODEL = 'claude-sonnet-5-5';
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

/** One non-streaming Messages API call. Returns the concatenated text. */
export async function askClaude(opts: { system: string; content: ContentBlock[] | string; maxTokens?: number; temperature?: number }): Promise<string> {
  const key = getKey();
  if (!key) throw new AiError('No API key saved. Add one in Settings.', 0);

  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: opts.maxTokens ?? 2000,
        temperature: opts.temperature ?? 0.4,
        system: opts.system,
        messages: [{ role: 'user', content: opts.content }],
      }),
    });
  } catch {
    throw new AiError('Could not reach Anthropic. Check your connection and try again.');
  }

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message ?? ''; } catch { /* ignore */ }
    if (res.status === 401) throw new AiError('That API key was rejected. Check it in Settings.', 401);
    if (res.status === 400 && /credit|billing/i.test(detail)) throw new AiError('Your Anthropic account has no credit left. Top up at console.anthropic.com.', 400);
    if (res.status === 429) throw new AiError('Rate limited by Anthropic. Wait a moment and try again.', 429);
    throw new AiError(detail || `Request failed (${res.status}).`, res.status);
  }
  const json = await res.json();
  return (json.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
}

/** Pull the first JSON object out of a model reply (tolerates ```json fences). */
export function extractJson<T = unknown>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < 0) throw new AiError('The model did not return structured data. Try again.');
  return JSON.parse(body.slice(start, end + 1)) as T;
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
