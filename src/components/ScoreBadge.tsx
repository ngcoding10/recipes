import { band, BAND_LABEL } from '../lib/scoring';

interface Props {
  score: number;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** Show the band label ("High concern") next to the number. */
  label?: boolean;
}

/** The 0 to 100 ingredient score as a colored tile. Color follows the five bands. */
export default function ScoreBadge({ score, size = 'sm', label = false }: Props) {
  const b = band(score);
  return (
    <span className={`score score--${b} score--${size}`} title={`${score}/100 · ${BAND_LABEL[b]}`}>
      <span className="score__num" aria-hidden="true">{score}</span>
      <span className="visually-hidden">Score {score} out of 100, {BAND_LABEL[b]}</span>
      {label && <span className="score__label" aria-hidden="true">{BAND_LABEL[b]}</span>}
    </span>
  );
}
