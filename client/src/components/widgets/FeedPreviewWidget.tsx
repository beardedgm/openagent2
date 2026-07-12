import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useFeedPreview } from '../../api/hooks';
import type { FeedItem } from '../../api/types';
import { Card } from '../ui/Card';

// Mirrors FeedPage's link rendering: external items link out (with the external-link
// affordance), internal items route within the app, and linkless items render as plain text.
function feedItemLink(item: FeedItem) {
  if (item.kind === 'external' && item.link) {
    return (
      <a href={item.link} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
        {item.title} <ExternalLink size={12} aria-hidden style={{ verticalAlign: 'baseline' }} />
      </a>
    );
  }
  if (item.kind === 'internal' && item.link) {
    return (
      <Link to={item.link} style={{ fontWeight: 600, color: 'var(--color-text)' }}>
        {item.title}
      </Link>
    );
  }
  return <span style={{ fontWeight: 600 }}>{item.title}</span>;
}

export function FeedPreviewWidget() {
  const { data: items } = useFeedPreview();

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'baseline' }}>
        <h2 style={{ fontSize: 18, flex: 1 }}>Latest activity</h2>
        <Link to="/feed" style={{ fontSize: 14 }}>View all</Link>
      </div>
      {items?.length === 0 && <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>Nothing here yet.</p>}
      {items?.map((item) => (
        <div
          key={item.id}
          style={{ display: 'flex', alignItems: 'center', minHeight: 44, borderBottom: '1px solid var(--color-border)', fontSize: 14 }}
        >
          {feedItemLink(item)}
        </div>
      ))}
    </Card>
  );
}
