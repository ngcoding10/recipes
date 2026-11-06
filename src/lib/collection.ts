import type { CollectionEntry } from 'astro:content';
import type { RecipeData } from './types';

/** Map a content-collection entry to the slim shape the React islands use. */
export function toRecipeData(entry: CollectionEntry<'recipes'>, base: string): RecipeData {
  const d = entry.data;
  return {
    slug: entry.id,
    id: d.id,
    title: d.title,
    description: d.description,
    servings: d.servings,
    servingSize: d.servingSize,
    totalTimeMin: d.workingTotalTime ?? d.totalTimeMin,
    totalTimeText: d.totalTimeText,
    cuisine: d.cuisine,
    meal: d.meal,
    mealTags: d.mealTags ?? [],
    protein: d.protein,
    proteinTags: d.proteinTags ?? [],
    difficulty: d.difficulty,
    difficultyText: d.difficultyText,
    cost: d.cost,
    dietary: d.dietary,
    dietaryTags: d.dietaryTags ?? [],
    tags: d.tags ?? [],
    allergens: d.allergens,
    equipment: d.equipment,
    cookingMethod: d.cookingMethod,
    flavor: d.flavor,
    texture: d.texture,
    mealPrep: d.mealPrep,
    freezer: d.freezer,
    source: d.source,
    verification: d.verification,
    provenance: d.provenance,
    nutrition: d.workingNutrition
      ? { ...d.nutrition, calories: d.workingNutrition.calories ?? d.nutrition?.calories }
      : d.nutrition,
    keywords: d.keywords ?? [],
    ingredients: d.ingredients ?? [],
    image: d.image ? `${base}${d.image}` : undefined,
  };
}
