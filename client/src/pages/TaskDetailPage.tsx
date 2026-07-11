import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { Paperclip } from 'lucide-react';
import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useTask } from '../api/hooks';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';

export function TaskDetailPage() {
  const { id } = useParams();
  const { data, isLoading, error } = useTask(id);
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const complete = useMutation({
    mutationFn: () => api.post(`/tasks/${id}/complete`, { note }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['tasks'] });
      await qc.invalidateQueries({ queryKey: ['onboarding'] });
    },
  });

  const completeError =
    complete.isError && isAxiosError(complete.error)
      ? ((complete.error.response?.data as { error?: string })?.error ?? 'Could not complete the task')
      : complete.isError
        ? 'Could not complete the task'
        : undefined;

  const uploadAttachment = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.post(`/tasks/${id}/attachments`, formData);
    },
    onSuccess: async () => {
      // List view doesn't show attachments, so only the detail query needs invalidating.
      await qc.invalidateQueries({ queryKey: ['tasks', id] });
    },
  });

  const uploadError =
    uploadAttachment.isError && isAxiosError(uploadAttachment.error)
      ? ((uploadAttachment.error.response?.data as { error?: string })?.error ?? 'Could not upload the attachment')
      : undefined;

  if (isLoading) return <Spinner label="Loading task" />;
  if (!data) {
    if (isAxiosError(error) && error.response?.status === 404)
      return (
        <Card>
          <h2 style={{ fontSize: 18 }}>Task not found</h2>
        </Card>
      );
    return null;
  }

  const { task, matrix } = data;
  const assigned = task.myCompletion !== null;
  const completedAt = task.myCompletion?.completedAt;
  const overdue = !!task.dueAt && new Date(task.dueAt) < new Date() && !completedAt;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 720 }}>
      <Card>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 22, flex: 1 }}>{task.title}</h1>
          <Badge tone={task.priority === 'High' ? 'danger' : task.priority === 'Medium' ? 'accent' : 'neutral'}>
            {task.priority}
          </Badge>
          {overdue && <Badge tone="danger">Overdue</Badge>}
        </div>
        <p style={{ marginTop: 'var(--space-1)', fontSize: 13, color: 'var(--color-text-muted)' }}>
          {task.dueAt ? `Due ${new Date(task.dueAt).toLocaleString()}` : 'No due date'}
        </p>
        {task.descriptionHtml && (
          // Server-sanitized at write time (sanitize-html allowlist) — the only reason this is safe.
          <div style={{ marginTop: 'var(--space-3)' }} dangerouslySetInnerHTML={{ __html: task.descriptionHtml }} />
        )}
        {task.attachments.length > 0 && (
          <div style={{ marginTop: 'var(--space-3)' }}>
            {task.attachments.map((a, i) => (
              <a
                key={i}
                href={`/api/v1/tasks/${task.id}/attachments/${i}/download`}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 44, fontSize: 14 }}
              >
                <Paperclip size={16} aria-hidden />
                {a.name} ({Math.max(1, Math.round(a.size / 1024))} KB)
              </a>
            ))}
          </div>
        )}
        {/* `matrix` is only sent by the server to the task's creator or an admin — the same
            audience allowed to POST /tasks/:id/attachments — so it doubles as the upload gate. */}
        {matrix && task.attachments.length < 5 && (
          <div style={{ marginTop: 'var(--space-3)' }}>
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
              Add attachment
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.docx,.xlsx"
              hidden
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                if (file) uploadAttachment.mutate(file);
                // Clear the input so selecting the same file again (e.g. after a failed
                // upload) still fires this change handler.
                e.currentTarget.value = '';
              }}
            />
            {uploadError && (
              <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 'var(--space-2)' }}>
                {uploadError}
              </p>
            )}
          </div>
        )}
      </Card>

      {assigned && (
        <Card>
          {completedAt ? (
            <p style={{ fontSize: 14 }}>
              ✓ You completed this task on {new Date(completedAt).toLocaleString()}.
              {task.myCompletion?.note && ` Note: ${task.myCompletion.note}`}
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                complete.mutate();
              }}
            >
              <label htmlFor="completion-note" style={{ fontWeight: 600, fontSize: 14, display: 'block', marginBottom: 'var(--space-1)' }}>
                Completion note (optional)
              </label>
              <input
                id="completion-note"
                aria-label="Completion note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={1000}
                style={{ width: '100%', minHeight: 44, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '0 var(--space-3)', background: 'var(--color-surface)', marginBottom: 'var(--space-3)' }}
              />
              {completeError && (
                <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 'var(--space-2)' }}>
                  {completeError}
                </p>
              )}
              <Button type="submit" disabled={complete.isPending}>
                {complete.isPending ? 'Saving…' : 'Mark complete'}
              </Button>
            </form>
          )}
        </Card>
      )}

      {matrix && (
        <Card>
          <h2 style={{ fontSize: 18, marginBottom: 'var(--space-3)' }}>
            Completion — {task.counts.completed}/{task.counts.total}
          </h2>
          {matrix.map((row) => (
            <div key={row.userId} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'baseline', padding: 'var(--space-1) 0', borderBottom: '1px solid var(--color-border)', fontSize: 14 }}>
              <span style={{ flex: 1, fontWeight: 600 }}>{row.displayName}</span>
              {row.completedAt ? (
                <span style={{ color: 'var(--color-success)' }}>
                  Done {new Date(row.completedAt).toLocaleDateString()}
                  {row.note && ` — ${row.note}`}
                </span>
              ) : (
                <span style={{ color: 'var(--color-text-muted)' }}>Open</span>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
