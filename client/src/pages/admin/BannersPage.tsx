import { isAxiosError } from 'axios';
import { Copy, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../api/client';
import { useBannerMutations, useBanners, useSettings } from '../../api/hooks';
import type { BannerInfo } from '../../api/types';
import { RichTextEditor } from '../../components/RichTextEditor';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Spinner } from '../../components/ui/Spinner';

const controlStyle = {
  minHeight: 44,
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: '0 var(--space-3)',
  background: 'var(--color-surface)',
};

function statusOf(b: BannerInfo): { label: string; tone: 'success' | 'neutral' | 'accent' } {
  const now = Date.now();
  if (new Date(b.endAt).getTime() < now) return { label: 'Expired', tone: 'neutral' };
  if (new Date(b.startAt).getTime() > now) return { label: 'Scheduled', tone: 'accent' };
  return { label: 'Live', tone: 'success' };
}

/** ISO → the local-time string a datetime-local input expects. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const EMPTY = { kind: 'text' as 'text' | 'image', title: '', imageUrl: '', bodyHtml: '', ctaLabel: '', ctaUrl: '', officeId: '', startAt: '', endAt: '' };

export function BannersPage() {
  const { data: banners, isLoading } = useBanners();
  const { data: settings } = useSettings();
  const { create, update, remove, duplicate } = useBannerMutations();
  const [form, setForm] = useState<typeof EMPTY | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  if (isLoading) return <Spinner />;
  const fail = (err: unknown) =>
    setError(isAxiosError(err) ? (err.response?.data?.error ?? 'Something went wrong') : 'Something went wrong');

  const openEditor = (b?: BannerInfo) => {
    setError('');
    setEditingId(b?.id ?? null);
    setForm(
      b
        ? { kind: b.kind, title: b.title, imageUrl: b.imageUrl, bodyHtml: b.bodyHtml, ctaLabel: b.ctaLabel, ctaUrl: b.ctaUrl, officeId: b.officeId ?? '', startAt: toLocalInput(b.startAt), endAt: toLocalInput(b.endAt) }
        : { ...EMPTY },
    );
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setError('');
    const body = {
      ...(editingId ? {} : { kind: form.kind }),
      title: form.title,
      imageUrl: form.imageUrl,
      bodyHtml: form.bodyHtml,
      ctaLabel: form.ctaLabel,
      ctaUrl: form.ctaUrl,
      officeId: form.officeId || null,
      startAt: form.startAt ? new Date(form.startAt).toISOString() : '',
      endAt: form.endAt ? new Date(form.endAt).toISOString() : '',
    };
    const done = { onSuccess: () => { setForm(null); setEditingId(null); }, onError: fail };
    if (editingId) update.mutate({ id: editingId, ...body }, done);
    else create.mutate(body, done);
  };

  const uploadImage = async (file: File) => {
    setUploading(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { data } = await api.post<{ url: string }>('/uploads/banner-image', fd);
      setForm((f) => (f ? { ...f, imageUrl: data.url } : f));
    } catch (err) {
      fail(err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <h1 style={{ fontSize: 24, flex: 1 }}>Banner ads</h1>
        <Button onClick={() => openEditor()}><Plus size={14} /> New banner</Button>
      </div>
      {error && <p role="alert" style={{ color: 'var(--color-danger)' }}>{error}</p>}

      {form && (
        <Card>
          <h2 style={{ fontSize: 18, marginBottom: 'var(--space-3)' }}>{editingId ? 'Edit banner' : 'New banner'}</h2>
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', maxWidth: 560 }}>
            {!editingId && (
              <fieldset style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 'var(--space-3)' }}>
                <legend style={{ fontSize: 14, padding: '0 6px' }}>Banner type</legend>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, fontSize: 14 }}>
                  <input type="radio" name="bkind" checked={form.kind === 'text'} onChange={() => setForm({ ...form, kind: 'text' })} /> Rich text
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, fontSize: 14 }}>
                  <input type="radio" name="bkind" checked={form.kind === 'image'} onChange={() => setForm({ ...form, kind: 'image' })} /> Image (≤5MB)
                </label>
              </fieldset>
            )}
            <Field label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={120} />
            {form.kind === 'image' ? (
              <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
                <label htmlFor="bn-image" style={{ fontWeight: 600, fontSize: 14 }}>Image</label>
                <input id="bn-image" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadImage(f); }} />
                {uploading && <Spinner />}
                {form.imageUrl && <img src={form.imageUrl} alt="Banner preview" style={{ maxWidth: '100%', maxHeight: 120, marginTop: 8, borderRadius: 8 }} />}
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>Banner body</span>
                <RichTextEditor value={form.bodyHtml} onChange={(bodyHtml) => setForm((f) => (f ? { ...f, bodyHtml } : f))} />
              </div>
            )}
            <Field label="CTA label (optional)" value={form.ctaLabel} onChange={(e) => setForm({ ...form, ctaLabel: e.target.value })} maxLength={40} />
            <Field label="CTA link (URL or internal path)" value={form.ctaUrl} onChange={(e) => setForm({ ...form, ctaUrl: e.target.value })} placeholder="https://… or /resources/…" />
            <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
              <label htmlFor="bn-office" style={{ fontWeight: 600, fontSize: 14 }}>Audience</label>
              <select id="bn-office" value={form.officeId} onChange={(e) => setForm({ ...form, officeId: e.target.value })} style={controlStyle}>
                <option value="">All users</option>
                {(settings?.officeLocations ?? []).map((o) => (
                  <option key={o._id} value={o._id}>{o.name}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
                <label htmlFor="bn-start" style={{ fontWeight: 600, fontSize: 14 }}>Start</label>
                <input id="bn-start" type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} required style={controlStyle} />
              </div>
              <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
                <label htmlFor="bn-end" style={{ fontWeight: 600, fontSize: 14 }}>End</label>
                <input id="bn-end" type="datetime-local" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} required style={controlStyle} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <Button type="submit">Save</Button>
              <Button type="button" variant="secondary" onClick={() => { setForm(null); setEditingId(null); }}>Cancel</Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        {(banners ?? []).length === 0 && <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>No banners yet.</p>}
        {(banners ?? []).map((b) => {
          const s = statusOf(b);
          return (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 52, borderBottom: '1px solid var(--color-border)' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 500, fontSize: 14 }}>{b.title}</span>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                  {b.kind} · {new Date(b.startAt).toLocaleDateString()} – {new Date(b.endAt).toLocaleDateString()}
                </div>
              </div>
              <Badge tone={s.tone}>{s.label}</Badge>
              <span title="Clicks" aria-label={`${b.clickCount} clicks`} style={{ fontSize: 14, minWidth: 32, textAlign: 'right' }}>{b.clickCount}</span>
              <button type="button" aria-label={`Duplicate ${b.title}`} onClick={() => duplicate.mutate(b.id, { onError: fail })} style={{ background: 'none', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, color: 'var(--color-text-muted)' }}>
                <Copy size={16} />
              </button>
              <button type="button" aria-label={`Edit ${b.title}`} onClick={() => openEditor(b)} style={{ background: 'none', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, color: 'var(--color-text-muted)' }}>
                <Pencil size={16} />
              </button>
              <button
                type="button"
                aria-label={`Delete ${b.title}`}
                onClick={() => { if (window.confirm('Delete this banner?')) remove.mutate(b.id, { onError: fail }); }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, color: 'var(--color-danger)' }}
              >
                <Trash2 size={16} />
              </button>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
