// Types for core.js (the shared Firebase module, copied unchanged from the backend repository).
// Only the parts The Pantry uses are described in detail.
import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { Functions } from 'firebase/functions';

export const CORE_VERSION: string;
export const FIREBASE_SDK_VERSION: string;
export const REGION: string;
export const USERNAME_RE: RegExp;
export function normalizeUsername(s: unknown): string;
export function validUsername(s: string): boolean;
export function loadSdkFromCdn(version?: string): Promise<CoreSdk>;
export function wantsEmulator(appName: string): boolean;

export interface CoreSdk {
  app: typeof import('firebase/app');
  auth: typeof import('firebase/auth');
  firestore: typeof import('firebase/firestore');
  functions: typeof import('firebase/functions');
  appCheck: typeof import('firebase/app-check');
}

export interface CoreUser {
  uid: string;
  name: string;
  email: string;
  photo: string;
  emailVerified: boolean;
  providers: string[];
}

export interface CoreAccount { uid: string; username: string; displayName: string }

export interface Core {
  appName: string;
  emulator: boolean;
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  functions: Functions;
  F: typeof import('firebase/firestore');
  A: typeof import('firebase/auth');
  ready: Promise<CoreUser | null>;
  readonly user: CoreUser | null;
  onUser(cb: (user: CoreUser | null) => void): () => void;
  /** Call directly from the click handler, with nothing awaited before it. */
  signInWithGoogle(): Promise<CoreUser | null>;
  signInWithEmail(email: string, password: string): Promise<CoreUser>;
  signUpWithEmail(email: string, password: string, displayName?: string): Promise<CoreUser>;
  resetPassword(email: string): Promise<void>;
  updatePassword(password: string): Promise<void>;
  signOut(): Promise<void>;
  emulatorSignIn(email: string, name?: string): Promise<CoreUser>;
  account: {
    normalize(s: unknown): string;
    valid(s: string): boolean;
    get(uid?: string): Promise<CoreAccount | null>;
    ownerOf(name: string): Promise<string | null>;
    isFree(name: string): Promise<boolean>;
    suggest(seed: string): Promise<string>;
    claim(rawName: string, options?: { displayName?: string; extra?: (batch: unknown) => unknown }): Promise<CoreAccount>;
  };
  call<O = unknown>(name: string, data?: unknown, options?: { timeout?: number }): Promise<O>;
  deleteMyData(app?: string): Promise<{ deleted: string[]; accountDeleted: boolean }>;
}

export function createCore(options: {
  appName: string;
  sdk: CoreSdk;
  config: object | null;
  appCheckSiteKey?: string | null;
  emulator?: boolean;
  offlineCache?: boolean;
}): Core;
