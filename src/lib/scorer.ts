/** The site's shared scorer instance, built from the exported database rules. */
import scoringData from '../data/scoring.json';
import lite from '../data/ingredients-lite.json';
import { createScorer, type LiteIngredient, type ScoringData } from './scoring';

export const scorer = createScorer(scoringData as unknown as ScoringData, lite as LiteIngredient[]);
export const liteIngredients = lite as LiteIngredient[];
