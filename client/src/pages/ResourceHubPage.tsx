import { Bookmark as BookmarkIcon, Download, ExternalLink, FileText, Star } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useCategories, useFeaturedResources, useMe, useResourceMutations, useResources } from '../api/hooks';
import type { ResourceInfo } from '../api/types';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';

export const FILE_TYPE_OPTIONS = ['pdf', 'image', 'word', 'excel', 'powerpoint', 'video', 'audio', 'archive', 'text', 'other', 'link'];

/** Primary action for a resource row/tile: browser-native download (follows the API's 302
 * to the signed URL) or external link. Never route these through Axios. */
export function ResourceAction({ resource }: { resource: ResourceInfo }) {
  if (resource.kind === 'link') {
    return (
      <a
        href={resource.externalUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${resource.title}`}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44, fontSize: 14 }}
      >
        <ExternalLink size={16} /> Open
      </a>
    );
  }
  return (
    <a
      href={`/api/v1/resources/${resource.id}/download`}
      aria-label={`Download ${resource.title}`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: 44, fontSize: 14 }}
    >
      <Download size={16} /> Download
    </a>
  );
}

export function ResourceHubPage() {
  const { data: me } = useMe();
  const { data: categories } = useCategories();
  const { data: featured } = useFeaturedResources();
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [fileType, setFileType] = useState('');
  const [scope, setScope] = useState<'all' | 'mine'>('all');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useResources({ q, categoryId, fileType, scope, page });
  const { setBookmark } = useResourceMutations();
  const isAdmin = me?.role === 'broker' || me?.role === 'officeAdmin';
  const nameOf = (id: string) => (categories ?? []).find((c) => c.id === id)?.name ?? '';

  const bookmarkButton = (r: ResourceInfo) => (
    <button
      type="button"
      aria-label={r.bookmarked ? `Remove bookmark from ${r.title}` : `Bookmark ${r.title}`}
      aria-pressed={r.bookmarked}
      onClick={() => setBookmark.mutate({ id: r.id, bookmarked: !r.bookmarked })}
      style={{ background: 'none', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, color: r.bookmarked ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
    >
      <BookmarkIcon size={18} fill={r.bookmarked ? 'currentColor' : 'none'} />
    </button>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <h1 style={{ fontSize: 24, flex: 1 }}>Resource Hub</h1>
        {isAdmin && (
          <Link
            to="/resources/new"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              minHeight: 44,
              padding: '0 var(--space-4)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-accent)',
              color: '#fff',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            New resource
          </Link>
        )}
      </div>

      {featured && featured.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 'var(--space-3)' }}>
          {featured.map((r) => (
            <Card key={r.id}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-accent)', fontSize: 12, marginBottom: 4 }}>
                <Star size={14} fill="currentColor" /> Featured
              </div>
              <Link to={`/resources/${r.id}`} style={{ fontWeight: 600, color: 'var(--color-text)' }}>{r.title}</Link>
              <div style={{ marginTop: 'var(--space-2)' }}>
                <ResourceAction resource={r} />
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', alignItems: 'center' }}>
          <input
            type="search"
            role="searchbox"
            aria-label="Search resources"
            placeholder="Search resources…"
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            style={{ flex: 1, minWidth: 180, minHeight: 44, padding: '0 var(--space-2)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
          />
          <label style={{ fontSize: 14 }}>
            Category{' '}
            <select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }} style={{ minHeight: 44 }}>
              <option value="">All</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.parentId ? `— ${c.name}` : c.name}</option>
              ))}
            </select>
          </label>
          <label style={{ fontSize: 14 }}>
            Type{' '}
            <select value={fileType} onChange={(e) => { setFileType(e.target.value); setPage(1); }} style={{ minHeight: 44 }}>
              <option value="">All</option>
              {FILE_TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <div role="group" aria-label="Scope" style={{ display: 'flex', gap: 4 }}>
            <Button variant={scope === 'all' ? 'primary' : 'secondary'} aria-pressed={scope === 'all'} onClick={() => { setScope('all'); setPage(1); }}>All</Button>
            <Button variant={scope === 'mine' ? 'primary' : 'secondary'} aria-pressed={scope === 'mine'} onClick={() => { setScope('mine'); setPage(1); }}>My Resources</Button>
          </div>
        </div>

        {isLoading && <Spinner label="Loading resources" />}
        {!isLoading && (data?.resources.length ?? 0) === 0 && (
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14, marginTop: 'var(--space-3)' }}>
            No resources {scope === 'mine' ? 'bookmarked yet — tap the bookmark icon on any resource.' : 'match these filters.'}
          </p>
        )}
        {(data?.resources ?? []).map((r) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 52, borderBottom: '1px solid var(--color-border)' }}>
            <FileText size={18} style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Link to={`/resources/${r.id}`} style={{ color: 'var(--color-text)', fontWeight: 500 }}>{r.title}</Link>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                {nameOf(r.categoryId)}{r.subcategoryId ? ` / ${nameOf(r.subcategoryId)}` : ''}
              </div>
            </div>
            <Badge tone="neutral">{r.fileType}</Badge>
            {bookmarkButton(r)}
            <ResourceAction resource={r} />
          </div>
        ))}

        {(data?.total ?? 0) > 20 && (
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)', alignItems: 'center' }}>
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
            <span style={{ fontSize: 14 }}>Page {page}</span>
            <Button variant="secondary" disabled={page * 20 >= (data?.total ?? 0)} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        )}
      </Card>
    </div>
  );
}
