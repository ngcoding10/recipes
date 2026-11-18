/**
 * Prompts and output schemas for the AI features, shared by the browser (your own API key)
 * and the Firebase Cloud Functions (the site owner's key). One source, so both paths give
 * the same kind of answer.
 *
 * Schemas use Zod v4 (the import the SDK's structured-output helper expects) and avoid
 * min/max constraints, which structured outputs do not accept.
 */
import * as z from 'zod/v4';

export const MODEL = 'claude-opus-5-5';
export const EFFORT = 'medium' as const;

// ---------------------------------------------------------------------------------------------
// New recipe
// ---------------------------------------------------------------------------------------------
export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack', 'dessert'] as const;
export type Meal = (typeof MEALS)[number];
export const DIETS = ['vegetarian', 'vegan', 'pescatarian', 'gluten-free', 'dairy-free', 'high-protein', 'low-carb', 'nut-free'] as const;

export const RecipeRequestSchema = z.object({
  ingredients: z.array(z.string()),
  meal: z.enum(MEALS),
  servings: z.number(),
  maxMinutes: z.number(),           // 0 = no limit
  diets: z.array(z.string()),
  strict: z.boolean(),              // only listed ingredients + staples
  avoidZero: z.boolean(),           // keep away from ingredients scored 0 on this site
  note: z.string(),
});
export type RecipeRequest = z.infer<typeof RecipeRequestSchema>;

export const GeneratedRecipeSchema = z.object({
  title: z.string(),
  description: z.string(),
  meal: z.enum(MEALS),
  servings: z.number(),
  prepMin: z.number(),
  cookMin: z.number(),
  totalTimeMin: z.number(),
  difficulty: z.enum(['Easy', 'Medium', 'Hard']),
  ingredients: z.array(z.object({
    amount: z.number(),             // 0 when "to taste"
    unit: z.string(),
    us: z.string(),                 // US equivalent, or ""
    item: z.string(),
    note: z.string(),
    fromPantry: z.boolean(),
  })),
  steps: z.array(z.string()),
  tips: z.array(z.string()),
  nutrition: z.object({ calories: z.number(), protein_g: z.number(), carbs_g: z.number(), fat_g: z.number(), fiber_g: z.number() }),
  needsToBuy: z.array(z.string()),
});
export type GeneratedRecipe = z.infer<typeof GeneratedRecipeSchema>;

export const STAPLES = 'salt, black pepper, olive or neutral oil, butter, garlic, onion, common dried herbs and spices, vinegar, lemon, soy sauce, flour, sugar, water';

/**
 * @param zeroList names of ingredients this site scores 0 (any cancer link), so the model can
 *                 avoid them when the user asks; passed in so the browser and server agree.
 */
export function recipePrompt(req: RecipeRequest, zeroList: string[]): { system: string; user: string } {
  const system = `You are a careful home-cooking recipe developer. You write one realistic, tested-feeling recipe that a home cook can follow without guessing.

How to write it:
- Build the recipe around the ingredients the cook has. Mark each ingredient with fromPantry = true when it comes from their list.
- ${req.strict ? `Use only the listed ingredients plus these staples: ${STAPLES}. Do not add anything else, and leave needsToBuy empty.` : `Prefer the listed ingredients. You may add a few common extras; put every extra that is not a basic staple (${STAPLES}) in needsToBuy.`}
- The meal type is ${req.meal}; the dish should make sense for that meal.
- Amounts: metric in amount + unit (g, ml, tbsp, tsp, or a count with unit ""), with a US equivalent in "us" when it helps. Use 0 and unit "to taste" for seasoning to taste. Decimals, never fractions.
- Steps: one action per step, with heat level, times, temperatures in °F and °C, and a doneness cue (internal temperature for meat, fish and eggs dishes where it matters).
- Times are minutes; totalTimeMin = prepMin + cookMin.${req.maxMinutes > 0 ? ` totalTimeMin must be ${req.maxMinutes} or less.` : ''}
- Nutrition is a per-serving estimate in kcal and grams.
- Never invent brand names. Keep the title plain and appetising.${req.diets.length ? `\n- Dietary requirements (all must hold): ${req.diets.join(', ')}.` : ''}${req.avoidZero && zeroList.length ? `\n- This site scores these ingredients 0 because they have a cancer link. Do not use them or anything made from them (for example no bacon, ham or sausage, no alcohol or vanilla extract, no smoked paprika or liquid smoke): ${zeroList.join('; ')}.` : ''}
- If the ingredients cannot make a sensible ${req.meal}, make the closest good dish you can and say so in the description.`;
  const user = `Ingredients I have: ${req.ingredients.join(', ') || '(none listed: suggest something from staples)'}.
Meal: ${req.meal}. Servings: ${req.servings}.${req.maxMinutes > 0 ? ` Time limit: ${req.maxMinutes} minutes.` : ''}${req.note ? `\nMy notes: ${req.note}` : ''}`;
  return { system, user };
}

// ---------------------------------------------------------------------------------------------
// Label second opinion (Scan page)
// ---------------------------------------------------------------------------------------------
export const LabelCheckSchema = z.object({
  productGuess: z.string(),
  score: z.number(),
  summary: z.string(),
  nutritionNotes: z.string(),
  items: z.array(z.object({ name: z.string(), score: z.number(), note: z.string() })),
  concerns: z.array(z.object({ title: z.string(), severity: z.enum(['low', 'moderate', 'high']), detail: z.string() })),
  positives: z.array(z.string()),
  swaps: z.array(z.string()),
  confidence: z.enum(['low', 'medium', 'high']),
});
export type LabelCheck = z.infer<typeof LabelCheckSchema>;

export interface LabelCheckRequest {
  kind: 'food' | 'cosmetic' | 'household';
  text: string;                 // OCR or pasted label text
  hasImage: boolean;
  flagged: string[];            // what the site's own database already found, with scores
}

export function labelPrompt(req: LabelCheckRequest): { system: string; user: string } {
  const system = `You are a careful food-label, cosmetic-ingredient and nutrition analyst giving a second opinion next to a website's own ingredient scores. You only state classifications you are sure of, and you say when something is uncertain or not visible. This is educational, not medical advice.

The website's scoring rule, which you must follow for every item score:
- 0 = any cancer link: an IARC Group 1, 2A or 2B classification, a US NTP listing, an EU carcinogen class, a cancer-based ban, a carcinogenic contaminant or breakdown product from making the ingredient, tumour findings in animal studies, or a cancer association in a human cohort study.
- 1 to 100 = everything else, on the remaining evidence (hormone activity, gut effects, allergy, heart and metabolic links, regulatory limits). 1-24 high concern, 25-49 moderate, 50-74 limited, 75-100 low.
- Sugar, salt and saturated fat are diet effects, not cancer links.
- When the website already scored an ingredient, reuse its score.

Overall product score: for food, about 60% nutrition quality (Nutri-Score-like), 30% additives, 10% degree of processing; for cosmetics and household products, the worst ingredient sets the band. Distinguish "possibly carcinogenic (IARC 2B)" from "carcinogenic (Group 1)" and from hormone or allergy concerns. Never diagnose. If the image is not a product, say so in the summary and give score 0.`;
  const user = `Analyse this ${req.kind} product. ${req.hasImage ? 'A photo is attached.' : 'There is no photo; use the label text only.'}
Label text read by OCR (may contain errors):
"""${req.text.slice(0, 4000)}"""
The website's database already scored: ${req.flagged.length ? req.flagged.join('; ') : 'nothing flagged'}.
In nutritionNotes, ${req.kind === 'food' ? "say what the nutrition panel or the visible food suggests about sugar, salt, saturated fat, fibre and protein, or 'not visible'" : 'say what the product type and claims suggest about exposure (leave-on or rinse-off, spray or cream, use on children)'}.`;
  return { system, user };
}
