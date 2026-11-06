import type { RecipeData } from '../lib/types';
import { labelize } from '../lib/format';

interface Props {
  recipe: RecipeData;
  href: string;
  /** Optional line rendered under the title (e.g. "Uses 3 of your 4 ingredients"). */
  note?: string;
}

function timeLabel(r: RecipeData): string | null {
  if (r.totalTimeMin != null) {
    const h = Math.floor(r.totalTimeMin / 60);
    const m = r.totalTimeMin % 60;
    if (h === 0) return `${m} min`;
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
  }
  if (r.totalTimeText && !/not\s|unavailable|n\/a/i.test(r.totalTimeText)) return r.totalTimeText;
  return null;
}

/** Pick a friendly glyph for the card tile from the recipe's tags. */
export function foodEmoji(r: RecipeData): string {
  const bag = new Set([...r.proteinTags, ...r.mealTags, ...r.tags, ...r.keywords].map((s) => s.toLowerCase()));
  const title = r.title.toLowerCase();
  const has = (...k: string[]) => k.some((x) => bag.has(x) || title.includes(x));
  if (has('salmon', 'tuna', 'fish', 'cod', 'shrimp', 'prawn')) return '🐟';
  if (has('chicken', 'turkey')) return '🍗';
  if (has('beef', 'steak', 'lamb')) return '🥩';
  if (has('pork', 'bacon', 'ham')) return '🥓';
  if (has('pasta', 'noodle', 'spaghetti', 'ramen')) return '🍝';
  if (has('soup', 'stew', 'broth')) return '🍲';
  if (has('salad')) return '🥗';
  if (has('taco', 'burrito', 'wrap')) return '🌮';
  if (has('pizza')) return '🍕';
  if (has('burger', 'sandwich')) return '🍔';
  if (has('egg', 'eggs', 'omelette', 'frittata')) return '🍳';
  if (has('smoothie', 'shake', 'drink')) return '🥤';
  if (has('cake', 'brownie', 'cookie', 'muffin', 'dessert', 'chocolate')) return '🍰';
  if (has('pancake', 'waffle', 'oats', 'oatmeal', 'granola', 'breakfast')) return '🥞';
  if (has('rice', 'bowl')) return '🍚';
  if (has('tofu', 'vegan', 'vegetarian', 'vegetable')) return '🥦';
  if (has('bread', 'toast', 'bagel')) return '🍞';
  if (has('snack')) return '🥨';
  return '🍽️';
}

/** Deterministic soft gradient so tiles vary without images. */
function tileStyle(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const h2 = (h + 40) % 360;
  return { background: `linear-gradient(135deg, hsl(${h} 70% 93%), hsl(${h2} 65% 88%))` };
}

export default function RecipeCard({ recipe, href, note }: Props) {
  const r = recipe;
  const time = timeLabel(r);
  const cal = r.nutrition?.calories && /\d/.test(r.nutrition.calories) ? r.nutrition.calories : undefined;
  const cuisine = r.cuisine && r.cuisine.length <= 24 ? r.cuisine : undefined;
  const tags = [...r.proteinTags.slice(0, 1), ...r.tags.filter((t) => ['quick', 'low-calorie', 'high-protein', 'meal-prep', 'vegan', 'vegetarian'].includes(t)).slice(0, 2)];
  return (
    <a className="card" href={href}>
      <div className="card__media" style={r.image ? undefined : tileStyle(r.id)}>
        {r.image ? (
          <img src={r.image} alt="" loading="lazy" width={800} height={500} />
        ) : (
          <span className="card__emoji" aria-hidden="true">{foodEmoji(r)}</span>
        )}
        <span className="codeword card__codeword">{r.id}</span>
        {cal && <span className="card__cal">{cal.replace(/^~?/, '')} kcal</span>}
      </div>

      <div className="card__body">
        <h3 className="card__title">{r.title}</h3>
        {note && <p className="card__note">{note}</p>}
        <div className="card__meta">
          {time && (
            <span className="card__meta-item">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
              {time}
            </span>
          )}
          {cuisine && <span className="card__meta-item">{labelize(cuisine)}</span>}
          {r.difficulty && <span className="card__meta-item">{r.difficulty}</span>}
        </div>
        {tags.length > 0 && (
          <div className="card__tags">
            {tags.map((t) => <span key={t} className="pill">{labelize(t)}</span>)}
          </div>
        )}
      </div>
    </a>
  );
}
