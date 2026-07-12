import { isAxiosError } from 'axios';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useCategories, useResource, useResourceMutations, useSettings } from '../api/hooks';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Field } from '../components/ui/Field';
import { Spinner } from '../components/ui/Spinner';

const selectStyle = {
  minHeight: 44,
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: '0 var(--space-3)',
  background: 'var(--color-surface)',
};

export function ResourceEditorPage() {
  const { id } = useParams(); // undefined on /resources/new
  const navigate = useNavigate();
  const { data: existing } = useResource(id);
  const { data: categories, isLoading: categoriesLoading } = useCategories();
  const { data: settings } = useSettings();
  const { create, update, uploadFile } = useResourceMutations();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<'file' | 'link'>('file');
  const [externalUrl, setExternalUrl] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [subcategoryId, setSubcategoryId] = useState('');
  const [officeId, setOfficeId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Write-once seed from the loaded resource (same contract as the other editors).
  const [seeded, setSeeded] = useState(false);

  // React Router does not remount this page across /resources/:id/edit → /resources/new (same element),
  // so reset the form (and the seeding latch) whenever the edited resource changes. Declared before
  // the seeding effect so on an id change the reset applies first and the seed re-runs cleanly.
  useEffect(() => {
    setSeeded(false);
    setTitle('');
    setDescription('');
    setKind('file');
    setExternalUrl('');
    setCategoryId('');
    setSubcategoryId('');
    setOfficeId('');
    setFile(null);
    setError('');
  }, [id]);

  useEffect(() => {
    if (existing && !seeded) {
      setTitle(existing.title);
      setDescription(existing.description);
      setKind(existing.kind);
      setExternalUrl(existing.externalUrl);
      setCategoryId(existing.categoryId);
      setSubcategoryId(existing.subcategoryId ?? '');
      setOfficeId(existing.officeId ?? '');
      setSeeded(true);
    }
  }, [existing, seeded]);

  if (categoriesLoading) return <Spinner />;
  const topLevel = (categories ?? []).filter((c) => !c.parentId);
  const subs = (categories ?? []).filter((c) => c.parentId === categoryId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!title.trim() || !categoryId) {
      setError('Title and category are required');
      return;
    }
    const body = {
      title: title.trim(),
      description,
      externalUrl: kind === 'link' ? externalUrl : undefined,
      categoryId,
      subcategoryId: subcategoryId || null,
      officeId: officeId || null,
    };
    setSaving(true);
    try {
      if (id) {
        await update.mutateAsync({ id, ...body });
        navigate(`/resources/${id}`);
      } else {
        const created = await create.mutateAsync({ ...body, kind });
        if (kind === 'file' && file) await uploadFile.mutateAsync({ id: created.id, file });
        navigate(`/resources/${created.id}`);
      }
    } catch (err) {
      setError(isAxiosError(err) ? (err.response?.data?.error ?? 'Save failed') : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 22, marginBottom: 'var(--space-4)' }}>{id ? 'Edit resource' : 'New resource'}</h1>
      {error && <p role="alert" style={{ color: 'var(--color-danger)' }}>{error}</p>}
      <form onSubmit={submit}>
        <Field label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200} />

        <div style={{ display: 'grid', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
          <label htmlFor="resource-description" style={{ fontWeight: 600, fontSize: 14 }}>
            Description
          </label>
          <textarea
            id="resource-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            maxLength={2000}
            style={{ ...selectStyle, minHeight: 88, padding: 'var(--space-2) var(--space-3)' }}
          />
        </div>

        <div style={{ display: 'grid', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
          <label htmlFor="resource-category" style={{ fontWeight: 600, fontSize: 14 }}>
            Category
          </label>
          <select
            id="resource-category"
            value={categoryId}
            onChange={(e) => { setCategoryId(e.target.value); setSubcategoryId(''); }}
            required
            style={selectStyle}
          >
            <option value="">Choose…</option>
            {topLevel.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div style={{ display: 'grid', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
          <label htmlFor="resource-subcategory" style={{ fontWeight: 600, fontSize: 14 }}>
            Subcategory (optional)
          </label>
          <select
            id="resource-subcategory"
            value={subcategoryId}
            onChange={(e) => setSubcategoryId(e.target.value)}
            disabled={subs.length === 0}
            style={selectStyle}
          >
            <option value="">None</option>
            {subs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        <div style={{ display: 'grid', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
          <label htmlFor="resource-office" style={{ fontWeight: 600, fontSize: 14 }}>
            Audience
          </label>
          <select
            id="resource-office"
            value={officeId}
            onChange={(e) => setOfficeId(e.target.value)}
            style={selectStyle}
          >
            <option value="">All users</option>
            {settings?.officeLocations.map((o) => (
              <option key={o._id} value={o._id}>{o.name}</option>
            ))}
          </select>
        </div>

        {!id && (
          <fieldset style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
            <legend style={{ fontSize: 14, padding: '0 6px' }}>Resource type</legend>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, fontSize: 14 }}>
              <input type="radio" name="kind" checked={kind === 'file'} onChange={() => setKind('file')} /> Upload a document (up to 50MB)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 44, fontSize: 14 }}>
              <input type="radio" name="kind" aria-label="External link" checked={kind === 'link'} onChange={() => setKind('link')} /> External link
            </label>
          </fieldset>
        )}

        {kind === 'link' && (
          <Field label="URL" type="url" value={externalUrl} onChange={(e) => setExternalUrl(e.target.value)} placeholder="https://…" required />
        )}
        {kind === 'file' && !id && (
          <Field label="File" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        )}
        {kind === 'file' && id && (
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Replace the file from the resource page — each replacement becomes a new version.</p>
        )}

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
          <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
