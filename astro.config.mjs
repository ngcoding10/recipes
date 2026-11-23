// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

// NOTE: `site` and `base` are set for GitHub Pages project-site deployment.
// The site will live at https://<user>.github.io/recipes/
// If you deploy to a custom domain or a user/organization page, set base to '/'.
export default defineConfig({
  site: 'https://ngcoding10.github.io',
  base: '/recipes',
  trailingSlash: 'ignore',
  integrations: [react()],
  build: {
    format: 'directory',
  },
  vite: {
    // The Firebase SDK is large but loads only on demand (dynamic import), never
    // with the page, so the default 500 KB chunk warning does not apply to it.
    build: { chunkSizeWarningLimit: 800 },
  },
});
