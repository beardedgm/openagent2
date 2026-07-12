import { Bookmark as BookmarkIcon, Pencil, Star, Trash2, Upload } from 'lucide-react';
import { isAxiosError } from 'axios';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useCategories, useMe, useResource, useResourceMutations } from '../api/hooks';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { ResourceAction } from './ResourceHubPage';

export function ResourceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { data: resource, isLoading } = useResource(id);
  const { data: categories } = useCategories();
  const { remove, uploadFile, setFeatured, setBookmark } = useResourceMutations();
  const [error, setError] = useState('');
  if (isLoading || !resource || !me) return <Spinner />;
  const isAdmin = me.role === 'broker' || me.role === 'officeAdmin';
  const nameOf = (cid: string | null) => (cid && (categories ?? []).find((c) => c.id === cid)?.name) || '';

  const fail = (err: unknown) =>
    setError(isAxiosError(err) ? (err.response?.data?.error ?? 'Something went wrong') : 'Something went wrong');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 720 }}>
      {error && <p role="alert" style={{ color: 'var(--color-danger)' }}>{error}</p>}
      <Card>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <h1 style={{ fontSize: 22 }}>{resource.title}</h1>
              {resource.featured && <Badge tone="accent"><Star size={12} /> Featured</Badge>}
              <Badge tone="neutral">{resource.fileType}</Badge>
            </div>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
              {nameOf(resource.categoryId)}{resource.subcategoryId ? ` / ${nameOf(resource.subcategoryId)}` : ''}
            </p>
          </div>
          <button
            type="button"
            aria-label={resource.bookmarked ? `Remove bookmark from ${resource.title}` : `Bookmark ${resource.title}`}
            aria-pressed={resource.bookmarked}
            onClick={() => setBookmark.mutate({ id: resource.id, bookmarked: !resource.bookmarked }, { onError: fail })}
            style={{ background: 'none', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, color: resource.bookmarked ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
          >
            <BookmarkIcon size={20} fill={resource.bookmarked ? 'currentColor' : 'none'} />
          </button>
        </div>
        {resource.description && <p style={{ marginTop: 'var(--space-2)', fontSize: 14 }}>{resource.description}</p>}
        <div style={{ marginTop: 'var(--space-3)' }}>
          <ResourceAction resource={resource} />
          {resource.kind === 'file' && resource.currentFile && (
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', marginLeft: 'var(--space-2)' }}>
              {resource.currentFile.name} · {(resource.currentFile.size / 1024).toFixed(0)} KB
            </span>
          )}
        </div>
      </Card>

      {isAdmin && (
        <Card>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
            <Link to={`/resources/${resource.id}/edit`}><Button variant="secondary"><Pencil size={14} /> Edit</Button></Link>
            {me.role === 'broker' && (
              <Button
                variant="secondary"
                onClick={() => setFeatured.mutate({ id: resource.id, featured: !resource.featured }, { onError: fail })}
              >
                <Star size={14} /> {resource.featured ? 'Unfeature' : 'Feature this resource'}
              </Button>
            )}
            <Button
              variant="danger"
              onClick={() => {
                if (window.confirm('Delete this resource? Bookmarks to it are removed too.')) {
                  remove.mutate(resource.id, { onSuccess: () => navigate('/resources'), onError: fail });
                }
              }}
            >
              <Trash2 size={14} /> Delete
            </Button>
          </div>

          {resource.kind === 'file' && (
            <div style={{ marginTop: 'var(--space-3)' }}>
              <h2 style={{ fontSize: 16 }}>Version history</h2>
              <ol style={{ paddingLeft: 'var(--space-4)', fontSize: 14 }}>
                {(resource.versions ?? []).map((v, i) => (
                  <li key={i} style={{ minHeight: 36 }}>
                    <a href={`/api/v1/resources/${resource.id}/download?version=${i + 1}`} aria-label={`Download version ${i + 1}`}>
                      {v.name}
                    </a>{' '}
                    <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
                      {new Date(v.uploadedAt).toLocaleDateString()}{i === (resource.versions?.length ?? 0) - 1 ? ' · current' : ''}
                    </span>
                  </li>
                ))}
              </ol>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44, fontSize: 14, cursor: 'pointer' }}>
                <Upload size={16} /> Replace file (new version)
                <input
                  type="file"
                  aria-label="Replace file"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadFile.mutate({ id: resource.id, file }, { onError: fail });
                    e.target.value = '';
                  }}
                />
              </label>
              {uploadFile.isPending && <Spinner />}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
