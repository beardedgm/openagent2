import { Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMe, usePosts } from '../api/hooks';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';

const PAGE_SIZE = 20;

export function BoardPage() {
  const { data: me } = useMe();
  const [query, setQuery] = useState('');
  const [q, setQ] = useState(''); // submitted search
  const [page, setPage] = useState(1);
  const { data, isLoading } = usePosts(q, page);
  const isAdmin = me?.role === 'broker' || me?.role === 'officeAdmin';
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <h1 style={{ fontSize: 22, flex: 1 }}>Message Board</h1>
        {isAdmin && (
          <Link
            to="/board/new"
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
            New post
          </Link>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQ(query.trim());
        }}
        style={{ display: 'flex', gap: 'var(--space-2)' }}
      >
        <input
          aria-label="Search posts"
          placeholder="Search posts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{
            flex: 1,
            minHeight: 44,
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            padding: '0 var(--space-3)',
            background: 'var(--color-surface)',
          }}
        />
        <Button type="submit" variant="secondary" aria-label="Search">
          <Search size={18} />
        </Button>
      </form>

      {isLoading && <Spinner label="Loading posts" />}
      {data?.posts.length === 0 && (
        <Card>
          <p style={{ color: 'var(--color-text-muted)' }}>{q ? 'No posts match your search.' : 'No posts yet.'}</p>
        </Card>
      )}
      {data?.posts.map((p) => (
        <Card key={p.id} style={{ padding: 'var(--space-4)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <Link to={`/board/${p.id}`} style={{ fontSize: 17, fontWeight: 700, color: 'var(--color-text)' }}>
              {p.title}
            </Link>
            {p.pinnedAt && <Badge tone="accent">Pinned</Badge>}
            {p.important && <Badge tone="danger">Important</Badge>}
          </div>
          <div style={{ marginTop: 'var(--space-1)', fontSize: 13, color: 'var(--color-text-muted)' }}>
            {p.author?.displayName ?? 'Unknown'} · {new Date(p.publishAt).toLocaleDateString()}
          </div>
          {p.excerpt && <p style={{ marginTop: 'var(--space-2)', fontSize: 14 }}>{p.excerpt}</p>}
        </Card>
      ))}

      {totalPages > 1 && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'center' }}>
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span style={{ alignSelf: 'center', fontSize: 14 }}>
            Page {page} of {totalPages}
          </span>
          <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
