/**
 * The public web config of the shared Firebase project. Both values are public identifiers
 * (not secrets), pasted from the Firebase console:
 *   FIREBASE_CONFIG     Project settings → Your apps → Web app → Config
 *   APP_CHECK_SITE_KEY  App Check → the web app's reCAPTCHA Enterprise site key
 * The backend itself (rules, Cloud Functions) lives in another repository: see docs/BACKEND.md.
 *
 * While FIREBASE_CONFIG is null the site is local-only: no sign-in, the pantry and saved
 * recipes stay on the device, and the AI features say that sign-in is not set up yet.
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

export const APP_CHECK_SITE_KEY: string | null = null;
