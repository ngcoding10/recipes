import all from '../data/ingredient-db.json';

/** How the label scanner scores this ingredient (null when the scanner has no entry for it). */
export interface ScannerView {
  name: string;
  score: number;
  carc: '' | 'classified' | 'linked';
  carcWhy: string;
  why: string;
  evidence: string;
  yuka: string;
  source: 'curated' | 'extended';
}

/** One ingredient from the November 2026 ingredient database, plus its scanner score. */
export interface IngredientEntry {
  id: string;
  name: string;
  group: string;
  class: string;
  evidence_note: string;
  iarc_group: string;
  prop65: string;
  ntp_roc: string;
  fda_status: string;
  us_state_actions: string;
  eu_status: string;
  efsa_note: string;
  regulatory_fields_scope: string;
  checked: boolean;
  e_numbers: string[];
  aliases: string[];
  label_variants: number;
  products: number;
  top_brands: [string, string][];
  sources: string[];
  scanner: ScannerView | null;
}

export const INGREDIENTS = all as unknown as IngredientEntry[];

/** Scanner score bands, same as the Scan page legend. */
export function riskClass(score: number, carc?: string): 'c' | '3' | '2' | '1' | '0' {
  if (carc || score === 0) return 'c';
  return score < 25 ? '3' : score < 50 ? '2' : score < 75 ? '1' : '0';
}
export const RISK_NAME: Record<string, string> = {
  c: 'Cancer link',
  '3': 'High concern',
  '2': 'Moderate concern',
  '1': 'Limited concern',
  '0': 'Low concern',
};
