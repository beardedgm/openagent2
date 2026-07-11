import { AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useEvents } from '../api/hooks';
import type { EventOccurrence } from '../api/types';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { Button } from '../components/ui/Button';
import { addDays, monthGrid, sameLocalDay, startOfWeek } from '../utils/calendarGrid';

type View = 'month' | 'week' | 'day';
const VIEWS: View[] = ['month', 'week', 'day'];

function rangeFor(view: View, anchor: Date): { from: Date; to: Date } {
  if (view === 'month') {
    const cells = monthGrid(anchor.getFullYear(), anchor.getMonth());
    return { from: cells[0].date, to: addDays(cells[41].date, 1) };
  }
  if (view === 'week') {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 7) };
  }
  const from = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  return { from, to: addDays(from, 1) };
}

function shift(view: View, anchor: Date, dir: 1 | -1): Date {
  if (view === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
  return addDays(anchor, view === 'week' ? 7 * dir : dir);
}

// Overlap test, not a start-day match: a multi-day event must appear in every day cell it
// spans, and an event that started before the visible range must still render on the days
// it covers (bucketing on startAt alone would drop it entirely).
function occursOnDay(o: EventOccurrence, day: Date): boolean {
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const dayEnd = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate() + 1);
  return new Date(o.startAt) < dayEnd && new Date(o.endAt) > dayStart;
}

export function CalendarPage() {
  const [view, setView] = useState<View>('month'); // PRD 5.4: default Month
  const [anchor, setAnchor] = useState(() => new Date());
  const navigate = useNavigate();
  const { from, to } = rangeFor(view, anchor);
  const { data: occurrences, isLoading } = useEvents(from.toISOString(), to.toISOString());

  const title =
    view === 'month'
      ? anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
      : view === 'week'
        ? `Week of ${startOfWeek(anchor).toLocaleDateString()}`
        : anchor.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  const occLabel = (o: EventOccurrence) => (
    <button
      key={`${o.event.id}-${o.startAt}`}
      onClick={() => navigate(`/calendar/${o.event.id}`)}
      style={{
        display: 'flex', alignItems: 'center', gap: 4, width: '100%', textAlign: 'left',
        background: o.event.kind === 'personal' ? 'transparent' : 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
        border: o.event.kind === 'personal' ? '1px dashed var(--color-border)' : 'none',
        borderRadius: 'var(--radius-sm)', padding: '1px 4px', fontSize: 12, color: 'var(--color-text)',
      }}
    >
      {o.event.mandatory && <AlertCircle size={12} aria-label="Mandatory event" style={{ color: 'var(--color-danger)', flexShrink: 0 }} />}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.event.title}</span>
    </button>
  );

  const listDays = (days: Date[]) => {
    const hasAny = days.some((day) => (occurrences ?? []).some((o) => occursOnDay(o, day)));
    return (
      <Card>
        {view === 'week' && !hasAny && (
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>No events this week.</p>
        )}
        {days.map((day) => {
          const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
          const todays = (occurrences ?? []).filter((o) => occursOnDay(o, day));
          if (todays.length === 0 && view === 'week') return null;
          return (
            <div key={day.toISOString()} style={{ padding: 'var(--space-2) 0', borderBottom: '1px solid var(--color-border)' }}>
              <strong style={{ fontSize: 14 }}>{day.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</strong>
              {todays.length === 0 && <p style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>No events.</p>}
              {todays.map((o) => (
                <div key={`${o.event.id}-${o.startAt}`} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'baseline', minHeight: 32 }}>
                  <span style={{ fontSize: 13, color: 'var(--color-text-muted)', width: 90, flexShrink: 0 }}>
                    {o.event.allDay
                      ? 'All day'
                      : new Date(o.startAt) < dayStart
                        ? 'Ongoing'
                        : new Date(o.startAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  </span>
                  {occLabel(o)}
                </div>
              ))}
            </div>
          );
        })}
      </Card>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 22, flex: 1, minWidth: 200 }}>{title}</h1>
        <button aria-label="Previous" onClick={() => setAnchor(shift(view, anchor, -1))} style={{ width: 44, height: 44, display: 'grid', placeItems: 'center', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text)' }}>
          <ChevronLeft size={18} />
        </button>
        <Button variant="secondary" onClick={() => setAnchor(new Date())}>Today</Button>
        <button aria-label="Next" onClick={() => setAnchor(shift(view, anchor, 1))} style={{ width: 44, height: 44, display: 'grid', placeItems: 'center', background: 'transparent', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', color: 'var(--color-text)' }}>
          <ChevronRight size={18} />
        </button>
        {VIEWS.map((v) => (
          <Button key={v} variant={view === v ? 'primary' : 'secondary'} aria-pressed={view === v} onClick={() => setView(v)}>
            {v[0].toUpperCase() + v.slice(1)}
          </Button>
        ))}
        <Link
          to="/calendar/new"
          style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 var(--space-4)', borderRadius: 'var(--radius-sm)', background: 'var(--color-accent)', color: '#fff', fontWeight: 600, textDecoration: 'none' }}
        >
          New event
        </Link>
      </div>

      {isLoading && <Spinner label="Loading calendar" />}

      {view === 'month' && (
        <Card style={{ padding: 'var(--space-2)', overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(90px, 1fr))', gap: 2 }}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d} style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-muted)', padding: 4 }}>{d}</div>
            ))}
            {monthGrid(anchor.getFullYear(), anchor.getMonth()).map((cell) => {
              const todays = (occurrences ?? []).filter((o) => occursOnDay(o, cell.date));
              return (
                <div
                  key={cell.date.toISOString()}
                  style={{
                    minHeight: 88, padding: 2, borderRadius: 'var(--radius-sm)',
                    background: cell.inMonth ? 'transparent' : 'color-mix(in srgb, var(--color-border) 30%, transparent)',
                    outline: sameLocalDay(cell.date, new Date()) ? '2px solid var(--color-accent)' : 'none',
                  }}
                >
                  <div style={{ fontSize: 12, color: cell.inMonth ? 'var(--color-text)' : 'var(--color-text-muted)', padding: 2 }}>
                    {cell.date.getDate()}
                  </div>
                  {todays.slice(0, 3).map(occLabel)}
                  {todays.length > 3 && (
                    <button
                      onClick={() => { setAnchor(cell.date); setView('day'); }}
                      style={{ fontSize: 11, color: 'var(--color-text-muted)', background: 'transparent', border: 'none', padding: '1px 4px' }}
                    >
                      +{todays.length - 3} more
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
      {view === 'week' && listDays(Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i)))}
      {view === 'day' && listDays([new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())])}
    </div>
  );
}
