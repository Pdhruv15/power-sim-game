import type { ScoreCard } from '../game';

interface Props {
  card: ScoreCard;
  onFix: () => void;
  onReplay: () => void;
}

/** End-of-day score: total, stars, points per part and a short card for each lesson. */
export function ScorePanel({ card, onFix, onReplay }: Props) {
  return (
    <aside className="panel score">
      <header>
        <h2>Day result</h2>
        <span className="stars" aria-label={`${card.stars} of 3 stars`}>
          {[1, 2, 3].map(n => <i key={n} className={n <= card.stars ? 'on' : undefined}>★</i>)}
        </span>
      </header>
      <p className="total"><b>{card.total}</b> / {card.max} points</p>

      <ul className="parts">
        {card.parts.map(p => (
          <li key={p.key}>
            <span>{p.label}</span>
            <b>{p.points} / {p.max}</b>
            <span className="meter"><i style={{ width: `${(p.points / p.max) * 100}%` }} /></span>
          </li>
        ))}
      </ul>

      <ul className="lessons">
        {card.lessons.map((l, i) => (
          <li key={i} className={`lesson ${l.kind}`}>
            <b>{l.kind === 'mistake' ? '✕ ' : l.kind === 'warning' ? '! ' : '✓ '}{l.title}</b>
            <p>{l.text}</p>
          </li>
        ))}
      </ul>

      <div className="actions">
        <button type="button" className="btn primary" onClick={onFix}>Fix the design</button>
        <button type="button" className="btn" onClick={onReplay}>Watch again</button>
      </div>
    </aside>
  );
}
