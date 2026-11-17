import all from '../data/ingredients.json';

/** One scored ingredient, as exported from the database build. */
export interface IngredientEntry {
  id: string;
  name: string;
  group: string;
  class: string;
  score: number;
  tier: string;
  rating_basis: string;
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
  /** [display name, brand key] */
  top_brands: [string, string][];
  sources: string[];
}

export const INGREDIENTS = all as IngredientEntry[];
