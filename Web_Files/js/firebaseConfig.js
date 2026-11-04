// Shared Firebase initialization for Authentication and Firestore.
// Vite loads these values from the project-root .env file.
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const requiredConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const missingConfig = Object.entries(requiredConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missingConfig.length) {
  throw new Error(
    `Firebase configuration is incomplete. Missing Vite environment values: ${missingConfig.join(', ')}. ` +
    'Make sure the .env file is in the project root (beside package.json), then restart Vite.'
  );
}

const app = getApps().length ? getApp() : initializeApp(requiredConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
