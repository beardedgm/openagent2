import { Link } from 'react-router-dom';
import { useUpcomingEvents } from '../../api/hooks';
import type { EventOccurrence } from '../../api/types';
import { Card } from '../ui/Card';

// Mirrors CalendarPage/EventDetailPage's date formatting: all-day events show just the date,
// timed events show the full start date/time.
function formatStart(o: EventOccurrence) {
  return o.event.allDay ? new Date(o.startAt).toLocaleDateString() : new Date(o.startAt).toLocaleString();
}

export function EventsWidget() {
  const { data: occurrences } = useUpcomingEvents();

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'baseline' }}>
        <h2 style={{ fontSize: 18, flex: 1 }}>Upcoming events</h2>
        <Link to="/calendar" style={{ fontSize: 14 }}>View calendar</Link>
      </div>
      {occurrences?.length === 0 && (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>No upcoming events.</p>
      )}
      {occurrences?.map((o) => (
        <div
          key={`${o.event.id}-${o.startAt}`}
          style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', minHeight: 44, borderBottom: '1px solid var(--color-border)' }}
        >
          <Link to={`/calendar/${o.event.id}`} style={{ flex: 1, color: 'var(--color-text)', fontSize: 14, fontWeight: 600 }}>
            {o.event.title}
          </Link>
          <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{formatStart(o)}</span>
        </div>
      ))}
    </Card>
  );
}
