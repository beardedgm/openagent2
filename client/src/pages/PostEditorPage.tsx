import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client';
import { usePost, useSettings } from '../api/hooks';
import type { Post } from '../api/types';
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

export function PostEditorPage() {
  const { id } = useParams(); // undefined on /board/new
  const editing = !!id;
  const { data: existing, isLoading } = usePost(id);
  const { data: settings } = useSettings();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [title, setTitle] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [officeId, setOfficeId] = useState('');
  const [important, setImportant] = useState(false);
  const [commentsEnabled, setCommentsEnabled] = useState(true);
  const [publishAt, setPublishAt] = useState(''); // datetime-local value; '' = publish now
  const [wasScheduled, setWasScheduled] = useState(false); // post had a future publishAt when seeded
  const [seeded, setSeeded] = useState(false);

  // React Router does not remount this page across /board/:id/edit → /board/new (same element),
  // so reset the form (and the seeding latch) whenever the edited post changes. Declared before
  // the seeding effect so on an id change the reset applies first and the seed re-runs cleanly.
  useEffect(() => {
    setSeeded(false);
    setTitle('');
    setBodyHtml('');
    setOfficeId('');
    setImportant(false);
    setCommentsEnabled(true);
    setPublishAt('');
    setWasScheduled(false);
  }, [id]);

  useEffect(() => {
    if (editing && existing && !seeded) {
      setTitle(existing.title);
      setBodyHtml(existing.bodyHtml);
      setOfficeId(existing.officeId ?? '');
      setImportant(existing.important);
      setCommentsEnabled(existing.commentsEnabled);
      if (new Date(existing.publishAt) > new Date()) {
        setPublishAt(toLocalInputValue(existing.publishAt));
        setWasScheduled(true);
      }
      setSeeded(true);
    }
  }, [editing, existing, seeded]);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        title,
        bodyHtml,
        officeId: officeId || null,
        important,
        commentsEnabled,
        ...(publishAt
          ? { publishAt: new Date(publishAt).toISOString() }
          : editing && wasScheduled
            ? { publishAt: new Date().toISOString() } // cleared schedule on a scheduled post = publish now
            : {}),
      };
      const res = editing
        ? await api.patch<{ post: Post }>(`/posts/${id}`, body)
        : await api.post<{ post: Post }>('/posts', body);
      return res.data.post;
    },
    onSuccess: async (post) => {
      await qc.invalidateQueries({ queryKey: ['posts'] });
      navigate(`/board/${post.id}`);
    },
  });

  const errorMessage =
    save.isError && isAxiosError(save.error)
      ? ((save.error.response?.data as { error?: string })?.error ?? 'Could not save the post')
      : undefined;

  if (editing && isLoading) return <Spinner label="Loading post" />;

  return (
    <Card style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, marginBottom: 'var(--space-4)' }}>{editing ? 'Edit post' : 'New post'}</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />

        <div style={{ display: 'grid', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Body</span>
          <RichTextEditor value={bodyHtml} onChange={setBodyHtml} />
        </div>

        <div style={{ display: 'grid', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
          <label htmlFor="post-office" style={{ fontWeight: 600, fontSize: 14 }}>
            Audience
          </label>
          <select
            id="post-office"
            value={officeId}
            onChange={(e) => setOfficeId(e.target.value)}
            style={{
              minHeight: 44,
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '0 var(--space-3)',
              background: 'var(--color-surface)',
            }}
          >
            <option value="">All users</option>
            {settings?.officeLocations.map((o) => (
              <option key={o._id} value={o._id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 44, fontSize: 14 }}>
          <input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} style={{ width: 18, height: 18 }} />
          Important (also emails everyone it targets)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 44, fontSize: 14 }}>
          <input type="checkbox" checked={commentsEnabled} onChange={(e) => setCommentsEnabled(e.target.checked)} style={{ width: 18, height: 18 }} />
          Allow comments
        </label>

        <div style={{ display: 'grid', gap: 'var(--space-1)', margin: 'var(--space-3) 0 var(--space-4)' }}>
          <label htmlFor="post-publish-at" style={{ fontWeight: 600, fontSize: 14 }}>
            Schedule (leave empty to publish now)
          </label>
          <input
            id="post-publish-at"
            type="datetime-local"
            value={publishAt}
            onChange={(e) => setPublishAt(e.target.value)}
            style={{
              minHeight: 44,
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '0 var(--space-3)',
              background: 'var(--color-surface)',
            }}
          />
        </div>

        {errorMessage && (
          <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 'var(--space-3)' }}>
            {errorMessage}
          </p>
        )}
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : editing ? 'Save changes' : publishAt ? 'Schedule post' : 'Publish post'}
          </Button>
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
