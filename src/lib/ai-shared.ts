/**
 * Types and option lists for the AI features. The prompts, the model and the output schemas
 * live on the server (the backend repository, see docs/BACKEND.md); the website only sends a
 * request and shows the answer.
 */

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack', 'dessert'] as const;
export type Meal = (typeof MEALS)[number];
export const DIETS = ['vegetarian', 'vegan', 'pescatarian', 'gluten-free', 'dairy-free', 'high-protein', 'low-carb', 'nut-free'] as const;

/** What the New page sends to `pantryGenerateRecipe`. */
export interface RecipeRequest {
  ingredients: string[];
  meal: Meal;
  servings: number;
  maxMinutes: number;   // 0 = no limit
  diets: string[];
  strict: boolean;      // only listed ingredients + staples
  avoidZero: boolean;   // keep away from ingredients scored 0 on this site
  note: string;
}

export interface GeneratedRecipe {
  title: string;
  description: string;
  meal: Meal;
  servings: number;
  prepMin: number;
  cookMin: number;
  totalTimeMin: number;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  ingredients: Array<{
    amount: number;     // 0 when "to taste"
    unit: string;
    us: string;         // US equivalent, or ""
    item: string;
    note: string;
    fromPantry: boolean;
  }>;
  steps: string[];
  tips: string[];
  nutrition: { calories: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number };
  needsToBuy: string[];
}

/** What the Scan page sends to `pantryCheckLabel`. */
export interface LabelCheckRequest {
  kind: 'food' | 'cosmetic' | 'household';
  text: string;             // OCR or pasted label text
  image: string | null;     // base64 JPEG, or null when there is no photo
  flagged: string[];        // what the site's own database already found, with scores
}

export interface LabelCheck {
  productGuess: string;
  score: number;
  summary: string;
  nutritionNotes: string;
  items: Array<{ name: string; score: number; note: string }>;
  concerns: Array<{ title: string; severity: 'low' | 'moderate' | 'high'; detail: string }>;
  positives: string[];
  swaps: string[];
  confidence: 'low' | 'medium' | 'high';
}

/** How many AI requests this account has made today, and its daily limit. */
export interface Usage { used: number; limit: number }
