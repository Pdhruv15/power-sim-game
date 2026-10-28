import type { DayEvent } from '../game';
import { hhmm } from './format';

/** What has happened so far in the day being replayed. Newest first. */
export function EventLog({ events, hour }: { events: DayEvent[]; hour: number }) {
  const seen = events.filter(e => e.hour <= hour).reverse();
  return (
    <section className="panel events" aria-live="polite">
      <h2>Events</h2>
      {seen.length === 0
        ? <p className="muted">Nothing yet. Watch the rooms change colour as the day goes on.</p>
        : (
          <ol>
            {seen.map((e, i) => (
              <li key={i} className={e.kind === 'high' ? 'warn' : 'bad'}>
                <time>{hhmm(e.hour)}</time> {e.text}
              </li>
            ))}
          </ol>
        )}
    </section>
  );
}
