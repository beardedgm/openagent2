import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useEvent, useMe } from '../api/hooks';
import type { RsvpResponse } from '../api/types';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';

const RESPONSES: RsvpResponse[] = ['yes', 'no', 'maybe'];

export function EventDetailPage() {
  const { id } = useParams();
  const { data, isLoading, error } = useEvent(id);
  const { data: me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const sendRsvp = useMutation({
    mutationFn: (response: RsvpResponse) => api.post(`/events/${id}/rsvp`, { response }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['events'] }),
  });
  const deleteEvent = useMutation({
    mutationFn: () => api.delete(`/events/${id}`),
    onSuccess: () => {
      navigate('/calendar');
      void qc.invalidateQueries({ queryKey: ['events'] });
    },
  });

  const errText = (m: { isError: boolean; error: unknown }, fallback: string) =>
    m.isError
      ? isAxiosError(m.error)
        ? ((m.error.response?.data as { error?: string })?.error ?? fallback)
        : fallback
      : undefined;

  if (isLoading) return <Spinner label="Loading event" />;
  if (!data) {
    if (isAxiosError(error) && error.response?.status === 404)
      return (
        <Card>
          <h2 style={{ fontSize: 18 }}>Event not found</h2>
        </Card>
      );
    return null;
  }

  const { event, rsvpSummary } = data;
  const isAdmin = me?.role === 'broker' || me?.role === 'officeAdmin';
  const canManage = event.createdBy === me?.id || (event.kind === 'office' && isAdmin);
  const when = event.allDay
    ? new Date(event.startAt).toLocaleDateString()
    : `${new Date(event.startAt).toLocaleString()} – ${new Date(event.endAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 720 }}>
      <Card>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 22, flex: 1 }}>{event.title}</h1>
          {event.mandatory && <Badge tone="danger">Mandatory</Badge>}
          {event.kind === 'personal' && <Badge tone="neutral">Personal</Badge>}
          {event.recurrence !== 'none' && <Badge tone="accent">{event.recurrence}</Badge>}
        </div>
        <p style={{ marginTop: 'var(--space-2)', fontSize: 14 }}>{when}</p>
        {event.location && <p style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>{event.location}</p>}
        {event.descriptionHtml && (
          // Server-sanitized at write time (sanitize-html allowlist) — the only reason this is safe.
          <div style={{ marginTop: 'var(--space-3)' }} dangerouslySetInnerHTML={{ __html: event.descriptionHtml }} />
        )}
        {canManage && (
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
            <Link
              to={`/calendar/${event.id}/edit`}
              style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 var(--space-4)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)', fontWeight: 600, textDecoration: 'none' }}
            >
              Edit
            </Link>
            <Button
              variant="danger"
              onClick={() => { if (window.confirm('Delete this event?')) deleteEvent.mutate(); }}
              disabled={deleteEvent.isPending}
            >
              Delete
            </Button>
          </div>
        )}
        {errText(deleteEvent, 'Could not delete the event') && (
          <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 'var(--space-2)' }}>
            {errText(deleteEvent, 'Could not delete the event')}
          </p>
        )}
      </Card>

      {event.rsvpEnabled && event.kind === 'office' && (
        <Card>
          <h2 style={{ fontSize: 18, marginBottom: 'var(--space-3)' }}>Will you attend?</h2>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            {RESPONSES.map((r) => (
              <Button
                key={r}
                variant={event.myRsvp === r ? 'primary' : 'secondary'}
                aria-pressed={event.myRsvp === r}
                onClick={() => sendRsvp.mutate(r)}
                disabled={sendRsvp.isPending}
              >
                {r[0].toUpperCase() + r.slice(1)}
              </Button>
            ))}
          </div>
          {errText(sendRsvp, 'Could not save your RSVP') && (
            <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 'var(--space-2)' }}>
              {errText(sendRsvp, 'Could not save your RSVP')}
            </p>
          )}
          {rsvpSummary && (
            <div style={{ marginTop: 'var(--space-4)' }}>
              <h3 style={{ fontSize: 15 }}>Responses</h3>
              {(['yes', 'no', 'maybe'] as const).map((k) => (
                <p key={k} style={{ fontSize: 14 }}>
                  <strong>{k[0].toUpperCase() + k.slice(1)} ({rsvpSummary[k].length}):</strong>{' '}
                  {rsvpSummary[k].join(', ') || '—'}
                </p>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
