import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useEvent, useMe, useSettings } from '../api/hooks';
import type { CalendarEventInfo, EventRecurrence } from '../api/types';
import { RichTextEditor } from '../components/RichTextEditor';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Field } from '../components/ui/Field';
import { Spinner } from '../components/ui/Spinner';

/** ISO → value usable by <input type="datetime-local"> in the viewer's timezone. */
function toLocalInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "YYYY-MM-DD" (from an <input type="date">) → local midnight of that day. */
function localMidnightFromDateInput(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const controlStyle = {
  minHeight: 44,
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: '0 var(--space-3)',
  background: 'var(--color-surface)',
};

export function EventEditorPage() {
  const { id } = useParams(); // undefined on /calendar/new
  const editing = !!id;
  const { data: eventData, isLoading } = useEvent(id);
  const existing = eventData?.event;
  const { data: settings } = useSettings();
  const { data: me } = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const isAdmin = me?.role === 'broker' || me?.role === 'officeAdmin';
  const isBroker = me?.role === 'broker';

  const [title, setTitle] = useState('');
  const [descriptionHtml, setDescriptionHtml] = useState('');
  const [kind, setKind] = useState<'office' | 'personal'>('personal');
  const [officeId, setOfficeId] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [allDay, setAllDay] = useState(false);
  const [location, setLocation] = useState('');
  const [recurrence, setRecurrence] = useState<EventRecurrence>('none');
  const [recurrenceUntil, setRecurrenceUntil] = useState('');
  const [rsvpEnabled, setRsvpEnabled] = useState(false);
  const [mandatory, setMandatory] = useState(false);
  const [resourceId, setResourceId] = useState('');
  const [seeded, setSeeded] = useState(false);

  // React Router does not remount this page across /calendar/:id/edit → /calendar/new (same
  // element), so reset the form (and the seeding latch) whenever the edited event changes.
  // Declared before the seeding effect so on an id change the reset applies first and the seed
  // re-runs cleanly.
  useEffect(() => {
    setSeeded(false);
    setTitle('');
    setDescriptionHtml('');
    setKind('personal');
    setOfficeId('');
    setStartAt('');
    setEndAt('');
    setAllDay(false);
    setLocation('');
    setRecurrence('none');
    setRecurrenceUntil('');
    setRsvpEnabled(false);
    setMandatory(false);
    setResourceId('');
  }, [id]);

  useEffect(() => {
    if (editing && existing && !seeded) {
      setTitle(existing.title);
      setDescriptionHtml(existing.descriptionHtml);
      setKind(existing.kind);
      setOfficeId(existing.officeId ?? '');
      if (existing.allDay) {
        setStartAt(toLocalInputValue(existing.startAt).slice(0, 10));
        // Stored endAt is the exclusive day-after bound (see save.mutationFn below); show the
        // inclusive end date here so re-saving without changes doesn't push the range forward a day.
        const end = new Date(existing.endAt);
        end.setDate(end.getDate() - 1);
        const pad = (n: number) => String(n).padStart(2, '0');
        setEndAt(`${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`);
      } else {
        setStartAt(toLocalInputValue(existing.startAt));
        setEndAt(toLocalInputValue(existing.endAt));
      }
      setAllDay(existing.allDay);
      setLocation(existing.location);
      setRecurrence(existing.recurrence);
      setRecurrenceUntil(existing.recurrenceUntil ? toLocalInputValue(existing.recurrenceUntil) : '');
      setRsvpEnabled(existing.rsvpEnabled);
      setMandatory(existing.mandatory);
      setResourceId(existing.resourceId ?? '');
      setSeeded(true);
    }
  }, [editing, existing, seeded]);

  const save = useMutation({
    mutationFn: async () => {
      // All-day events store UTC instants anchored to the creator's LOCAL day boundaries:
      // startAt is local midnight of the start date, endAt is local midnight of the day AFTER
      // the end date (an exclusive bound, so a single-day event still has endAt > startAt).
      // Cross-timezone drift for viewers in another timezone is an accepted Phase 1 limitation.
      let startIso: string;
      let endIso: string;
      if (allDay) {
        startIso = localMidnightFromDateInput(startAt).toISOString();
        const end = localMidnightFromDateInput(endAt);
        end.setDate(end.getDate() + 1);
        endIso = end.toISOString();
      } else {
        startIso = new Date(startAt).toISOString();
        endIso = new Date(endAt).toISOString();
      }
      const body = {
        title,
        descriptionHtml,
        ...(editing ? {} : { kind }),
        officeId: officeId || null,
        startAt: startIso,
        endAt: endIso,
        allDay,
        location,
        recurrence,
        recurrenceUntil: recurrenceUntil ? new Date(recurrenceUntil).toISOString() : null,
        rsvpEnabled,
        mandatory,
        resourceId: resourceId || null,
      };
      const res = editing
        ? await api.patch<{ event: CalendarEventInfo }>(`/events/${id}`, body)
        : await api.post<{ event: CalendarEventInfo }>('/events', body);
      return res.data.event;
    },
    onSuccess: async (event) => {
      await qc.invalidateQueries({ queryKey: ['events'] });
      navigate(`/calendar/${event.id}`);
    },
  });

  const errorMessage =
    save.isError && isAxiosError(save.error)
      ? ((save.error.response?.data as { error?: string })?.error ?? 'Could not save the event')
      : undefined;

  if (editing && isLoading) return <Spinner label="Loading event" />;

  return (
    <Card style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, marginBottom: 'var(--space-4)' }}>{editing ? 'Edit event' : 'New event'}</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />

        <div style={{ display: 'grid', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Description</span>
          <RichTextEditor value={descriptionHtml} onChange={setDescriptionHtml} />
        </div>

        {isAdmin && (
          <div style={{ display: 'grid', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
            <label htmlFor="event-kind" style={{ fontWeight: 600, fontSize: 14 }}>
              Event type
            </label>
            <select
              id="event-kind"
              value={kind}
              disabled={editing}
              onChange={(e) => setKind(e.target.value as 'office' | 'personal')}
              style={controlStyle}
            >
              <option value="personal">Personal</option>
              <option value="office">Office</option>
            </select>
          </div>
        )}

        {kind === 'office' && (
          <div style={{ display: 'grid', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
            <label htmlFor="event-office" style={{ fontWeight: 600, fontSize: 14 }}>
              Office
            </label>
            <select
              id="event-office"
              value={officeId}
              onChange={(e) => setOfficeId(e.target.value)}
              style={controlStyle}
            >
              <option value="">Select an office</option>
              {settings?.officeLocations.map((o) => (
                <option key={o._id} value={o._id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
          <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
            <label htmlFor="event-start" style={{ fontWeight: 600, fontSize: 14 }}>
              Starts
            </label>
            <input
              id="event-start"
              type={allDay ? 'date' : 'datetime-local'}
              required
              value={startAt}
              onChange={(e) => setStartAt(e.target.value)}
              style={controlStyle}
            />
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
            <label htmlFor="event-end" style={{ fontWeight: 600, fontSize: 14 }}>
              Ends
            </label>
            <input
              id="event-end"
              type={allDay ? 'date' : 'datetime-local'}
              required
              value={endAt}
              onChange={(e) => setEndAt(e.target.value)}
              style={controlStyle}
            />
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 44, fontSize: 14, marginBottom: 'var(--space-2)' }}>
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) => {
              const checked = e.target.checked;
              setAllDay(checked);
              // Dropping to date-only inputs: truncate any already-picked datetime-local
              // values down to their date part so the <input type="date"> receives a value
              // it understands. Local-midnight anchoring happens on submit, above.
              if (checked) {
                setStartAt((v) => v.slice(0, 10));
                setEndAt((v) => v.slice(0, 10));
              } else {
                // Back to datetime-local, which can't render a date-only value (the fields
                // would blank): append arbitrary default times — the user adjusts.
                setStartAt((v) => (v ? `${v.slice(0, 10)}T09:00` : v));
                setEndAt((v) => (v ? `${v.slice(0, 10)}T10:00` : v));
              }
            }}
            style={{ width: 18, height: 18 }}
          />
          All day
        </label>

        <Field label="Location" value={location} onChange={(e) => setLocation(e.target.value)} />

        <div style={{ display: 'grid', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
          <label htmlFor="event-recurrence" style={{ fontWeight: 600, fontSize: 14 }}>
            Repeats
          </label>
          <select
            id="event-recurrence"
            value={recurrence}
            onChange={(e) => setRecurrence(e.target.value as EventRecurrence)}
            style={controlStyle}
          >
            <option value="none">Does not repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
        </div>

        {recurrence !== 'none' && (
          <div style={{ display: 'grid', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
            <label htmlFor="event-recurrence-until" style={{ fontWeight: 600, fontSize: 14 }}>
              Repeat until
            </label>
            <input
              id="event-recurrence-until"
              type="datetime-local"
              value={recurrenceUntil}
              onChange={(e) => setRecurrenceUntil(e.target.value)}
              style={controlStyle}
            />
          </div>
        )}

        {kind === 'office' && (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 44, fontSize: 14 }}>
              <input
                type="checkbox"
                checked={rsvpEnabled}
                onChange={(e) => setRsvpEnabled(e.target.checked)}
                style={{ width: 18, height: 18 }}
              />
              Allow RSVPs
            </label>
            {isBroker && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 44, fontSize: 14 }}>
                <input
                  type="checkbox"
                  checked={mandatory}
                  onChange={(e) => setMandatory(e.target.checked)}
                  style={{ width: 18, height: 18 }}
                />
                Mandatory attendance
              </label>
            )}
            <div style={{ display: 'grid', gap: 'var(--space-1)', margin: 'var(--space-3) 0 var(--space-4)' }}>
              <label htmlFor="event-resource" style={{ fontWeight: 600, fontSize: 14 }}>
                Resource
              </label>
              <select
                id="event-resource"
                value={resourceId}
                onChange={(e) => setResourceId(e.target.value)}
                style={controlStyle}
              >
                <option value="">No resource</option>
                {settings?.reservableResources.map((r) => (
                  <option key={r._id} value={r._id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {errorMessage && (
          <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 'var(--space-3)' }}>
            {errorMessage}
          </p>
        )}
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create event'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
