import { ADDITIVES } from '../data/additives';

/** Names of food ingredients this site scores 0 (any cancer link), for "avoid" instructions to the AI. */
export function zeroIngredientNames(): string[] {
  return ADDITIVES.filter((a) => {
    const d = a.domain ?? 'any';
    const list = Array.isArray(d) ? d : [d];
    return a.score === 0 && (list.includes('any') || list.includes('food'));
  }).map((a) => a.name);
}
