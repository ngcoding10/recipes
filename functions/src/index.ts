/**
 * Cloud Functions for The Pantry: AI recipe writing and the AI label check, paid by the site
 * owner's Anthropic key and limited per Google account per day.
 *
 * Setup (docs/SETUP-FIREBASE.md):
 *   firebase functions:secrets:set ANTHROPIC_API_KEY
 *   firebase deploy --only functions,firestore:rules
 * Optional limits (defaults below) are asked for on first deploy, or set in functions/.env:
 *   DAILY_LIMIT_PER_USER=10  DAILY_LIMIT_TOTAL=300
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineInt, defineSecret } from 'firebase-functions/params';
import * as logger from 'firebase-functions/logger';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { MODEL, EFFORT } from '../../src/lib/ai-shared';
import { handleCheckLabel, handleGenerateRecipe, UserFacingError, type Deps, type Usage } from './handlers';

initializeApp();
const db = getFirestore();

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const DAILY_LIMIT_PER_USER = defineInt('DAILY_LIMIT_PER_USER', { default: 10, description: 'AI requests each Google account may make per day' });
const DAILY_LIMIT_TOTAL = defineInt('DAILY_LIMIT_TOTAL', { default: 300, description: 'AI requests for the whole site per day (a spending cap)' });

// The website's origins. Callable functions reject other sites' pages.
const CORS = [/^https:\/\/nicorgutierrez08-eng\.github\.io$/, /^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/];

const today = () => new Date().toISOString().slice(0, 10); // UTC day

function deps(): Deps {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value(), maxRetries: 2 });
  return {
    async ask(schema, system, content, maxTokens) {
      const res = await client.messages.parse({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: content as any }],
        output_config: { effort: EFFORT, format: zodOutputFormat(schema as any) },
      });
      logger.info('anthropic usage', { model: MODEL, input: res.usage.input_tokens, output: res.usage.output_tokens, stop: res.stop_reason });
      if (res.stop_reason === 'refusal') throw new UserFacingError('failed-precondition', 'The model declined this request. Try different wording.');
      if (!res.parsed_output) throw new UserFacingError('internal', 'The model did not return the expected format. Try again.');
      return res.parsed_output as any;
    },
    async consume(uid): Promise<Usage> {
      const day = today();
      const userRef = db.doc(`usage/${day}_${uid}`);
      const totalRef = db.doc(`usage/${day}_total`);
      const perUser = DAILY_LIMIT_PER_USER.value();
      const total = DAILY_LIMIT_TOTAL.value();
      return db.runTransaction(async (tx) => {
        const [u, t] = await Promise.all([tx.get(userRef), tx.get(totalRef)]);
        const used = (u.get('count') as number | undefined) ?? 0;
        const all = (t.get('count') as number | undefined) ?? 0;
        if (used >= perUser) throw new UserFacingError('resource-exhausted', `You have used all ${perUser} AI requests for today. They reset at midnight UTC.`);
        if (all >= total) throw new UserFacingError('resource-exhausted', 'The site has reached its AI limit for today. Try again tomorrow, or add your own API key on the Account page.');
        tx.set(userRef, { count: used + 1, uid, day }, { merge: true });
        tx.set(totalRef, { count: all + 1, day }, { merge: true });
        return { used: used + 1, limit: perUser };
      });
    },
    async refund(uid) {
      const day = today();
      await Promise.all([
        db.doc(`usage/${day}_${uid}`).set({ count: FieldValue.increment(-1) }, { merge: true }),
        db.doc(`usage/${day}_total`).set({ count: FieldValue.increment(-1) }, { merge: true }),
      ]);
    },
  };
}

/** Turn any failure into a message the page can show. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e: any) {
    if (e instanceof UserFacingError) throw new HttpsError(e.code, e.message);
    const status: number | undefined = e?.status;
    logger.error('AI request failed', { status, message: e?.message });
    if (status === 429 || status === 529 || status === 503) throw new HttpsError('unavailable', 'The AI service is busy. Try again in a minute.');
    if (status === 400 && /credit|billing/i.test(e?.message ?? '')) throw new HttpsError('failed-precondition', 'The site has run out of AI credit. Try again later, or use your own API key.');
    throw new HttpsError('internal', 'The AI request failed. Try again.');
  }
}

const opts = { region: 'us-central1', cors: CORS, secrets: [ANTHROPIC_API_KEY], timeoutSeconds: 120, memory: '512MiB' as const, maxInstances: 5 };

export const generateRecipe = onCall(opts, (req) => run(() => handleGenerateRecipe(req.auth?.uid, req.data, deps())));
export const checkLabel = onCall(opts, (req) => run(() => handleCheckLabel(req.auth?.uid, req.data, deps())));
