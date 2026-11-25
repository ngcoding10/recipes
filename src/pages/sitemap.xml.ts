import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { INGREDIENTS } from '../lib/ingredient-db';

// Real, indexable pages only (no account, redirects or query-string views).
export const GET: APIRoute = async ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const url = (p: string) => new URL(`${base}${p}`, site).href;
  const recipes = await getCollection('recipes');
  const paths = ['/', '/pantry/', '/new/', '/scan/', '/products/', '/ingredients/', '/privacy/', '/terms/',
    ...recipes.map((r) => `/${r.id}/`), ...INGREDIENTS.map((i) => `/ingredients/${i.id}/`)];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${paths.map((p) => `  <url><loc>${url(p)}</loc></url>`).join('\n')}\n</urlset>\n`;
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
};
