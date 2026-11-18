import type { APIRoute } from 'astro';
export const GET: APIRoute = ({ site }) => {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return new Response(`User-agent: *\nAllow: /\nDisallow: ${base}/account/\nDisallow: ${base}/settings/\n\nSitemap: ${new URL(`${base}/sitemap.xml`, site).href}\n`, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
