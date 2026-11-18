/**
 * Firebase web config: paste it here to switch on Google sign-in, cloud-saved pantries and
 * recipes, and AI that runs on the site owner's key (see docs/SETUP-FIREBASE.md).
 *
 * Firebase console → Project settings → Your apps → Web app → "SDK setup and configuration"
 * → Config. These values are public identifiers, not secrets; access is controlled by the
 * Firestore rules and the Cloud Functions in /functions.
 *
 * While this is null the site works exactly as before: everything stays on the device and the
 * AI features use a personal API key from the Account page.
 */
export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
  storageBucket?: string;
  messagingSenderId?: string;
}

export const FIREBASE_CONFIG: FirebaseWebConfig | null = null;

/** Region the Cloud Functions are deployed to (must match functions/src/index.ts). */
export const FUNCTIONS_REGION = 'us-central1';
