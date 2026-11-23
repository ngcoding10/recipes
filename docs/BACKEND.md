# Backend

The backend (Firestore rules, Cloud Functions, AI prompts, the shared `core.js`) lives in [github.com/ngcoding10/backend-combination](https://github.com/ngcoding10/backend-combination), one Firebase project shared with other apps.
This repo holds only the website and the public web config (`src/config/firebase.ts`); `src/lib/core.js` and `src/lib/fuzzy.js` are unchanged copies of the backend's `web/core.js` and `web/fuzzy.js`, so edit them there and copy them again.
The Pantry uses `pantry_users/{uid}` (+ `/recipes`) and the functions `pantryGenerateRecipe`, `pantryCheckLabel` and `accountDeleteMyData`; sign-in needs `ngcoding10.github.io` and `ascoding11.github.io` on the project's authorized domains.
When ingredient scores change, run `npm run --silent export:zero-list` and save the output as the backend's `functions/data/pantry-zero-list.json`.
Local testing: run the backend's emulators, then open `http://localhost:4321/recipes/?emulator`.
