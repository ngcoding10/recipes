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

export const FIREBASE_CONFIG: FirebaseWebConfig | null = {
  apiKey: 'AIzaSyBS9L5-lAQXibNvtXDXDeBDRXVIWRIg7v0',
  authDomain: 'combination-23e84.firebaseapp.com',
  projectId: 'combination-23e84',
  storageBucket: 'combination-23e84.firebasestorage.app',
  messagingSenderId: '102320113071',
  appId: '1:102320113071:web:b7b91336dd83b42d181b5a',
};

export const APP_CHECK_SITE_KEY: string | null = null;
