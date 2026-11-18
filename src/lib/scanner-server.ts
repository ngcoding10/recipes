/**
 * Build-time access to the scanner's matcher, so recipe pages are checked with
 * exactly the same database as the Scan page. Used at build time only.
 */
import extended from '../../public/data/ingredients.json';
import { buildDataset, lookupDataset, matchIngredient, type Dataset } from './label';

let ds: Dataset | null = null;
function dataset(): Dataset {
  if (!ds) ds = buildDataset(extended);
  return ds;
}

export interface IngredientFlag {
  name: string;
  score: number;
  carc: '' | 'classified' | 'linked';
  why: string;
}

/** Check one recipe ingredient line. Returns null when nothing in the database matches. */
export function checkIngredient(item: string): IngredientFlag | null {
  const m = matchIngredient(item, 'food');
  if (m) return { name: m.name, score: m.score, carc: m.carc?.level ?? '', why: m.carc?.why ?? m.why };
  const r = lookupDataset(item, dataset());
  if (r && r.specific) return { name: r.name, score: r.score, carc: r.carc?.level ?? '', why: r.carc?.why ?? r.note };
  return null;
}
