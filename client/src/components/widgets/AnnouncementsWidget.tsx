import { Link } from 'react-router-dom';
import { usePosts } from '../../api/hooks';
import { Card } from '../ui/Card';

export function AnnouncementsWidget() {
  const { data } = usePosts('', 1);
  // GET /posts already sorts pinnedAt desc, so this just filters+caps client-side — no new endpoint.
  const pinned = (data?.posts ?? []).filter((p) => p.pinnedAt !== null).slice(0, 3);

  return (
    <Card>
      <h2 style={{ fontSize: 18 }}>Pinned announcements</h2>
      {pinned.length === 0 && (
        <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>No pinned announcements.</p>
      )}
      {pinned.map((post) => (
        <div
          key={post.id}
          style={{ display: 'flex', alignItems: 'center', minHeight: 44, borderBottom: '1px solid var(--color-border)' }}
        >
          <Link to={`/board/${post.id}`} style={{ fontWeight: 600, color: 'var(--color-text)', fontSize: 14 }}>
            {post.title}
          </Link>
        </div>
      ))}
    </Card>
  );
}
