import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Pin, PinOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useMe } from '../api/hooks';
import type { FeedItem, FeedResponse } from '../api/types';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';

type Filter = 'all' | 'internal' | 'external';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'internal', label: 'Internal' },
  { key: 'external', label: 'External news' },
];

export function FeedPage() {
  const { data: me } = useMe();
  const [filter, setFilter] = useState<Filter>('all');
  const qc = useQueryClient();
  const sentinelRef = useRef<HTMLDivElement>(null);

  const feed = useInfiniteQuery({
    queryKey: ['feed', filter],
    queryFn: async ({ pageParam }) =>
      (
        await api.get<FeedResponse>(
          `/feed?filter=${filter}${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ''}`,
        )
      ).data,
    initialPageParam: '',
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const pin = useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      pinned ? api.delete(`/feed/${id}/pin`) : api.post(`/feed/${id}/pin`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['feed'] }),
  });

  const { fetchNextPage, hasNextPage, isFetchingNextPage } = feed;
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) void fetchNextPage();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  const isBroker = me?.role === 'broker';
  const pinned = feed.data?.pages[0]?.pinned ?? [];
  const items = feed.data?.pages.flatMap((p) => p.items) ?? [];

  const renderItem = (item: FeedItem, isPinned: boolean) => (
    <div
      key={item.id}
      style={{
        display: 'flex',
        gap: 'var(--space-2)',
        alignItems: 'baseline',
        padding: 'var(--space-3) 0',
        borderBottom: '1px solid var(--color-border)',
      }}
    >
      <div style={{ flex: 1 }}>
        {item.kind === 'external' ? (
          <a href={item.link} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600 }}>
            {item.title} <ExternalLink size={12} aria-hidden style={{ verticalAlign: 'baseline' }} />
          </a>
        ) : item.link ? (
          <Link to={item.link} style={{ fontWeight: 600, color: 'var(--color-text)' }}>
            {item.title}
          </Link>
        ) : (
          <span style={{ fontWeight: 600 }}>{item.title}</span>
        )}
        <span style={{ display: 'block', fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
          {item.kind === 'external' ? `${item.source ?? 'External'} · ` : ''}
          {new Date(item.date).toLocaleString()}
        </span>
      </div>
      {isPinned && <Badge tone="accent">Pinned</Badge>}
      {isBroker && item.kind === 'internal' && (
        <button
          aria-label={isPinned ? 'Unpin item' : 'Pin item'}
          onClick={() => pin.mutate({ id: item.id, pinned: isPinned })}
          style={{
            width: 44,
            height: 44,
            display: 'grid',
            placeItems: 'center',
            background: 'transparent',
            border: 'none',
            borderRadius: 'var(--radius-sm)',
            color: 'var(--color-text-muted)',
          }}
        >
          {isPinned ? <PinOff size={16} /> : <Pin size={16} />}
        </button>
      )}
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 720 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 22, flex: 1 }}>Activity Feed</h1>
        {FILTERS.map((f) => (
          <Button
            key={f.key}
            variant={filter === f.key ? 'primary' : 'secondary'}
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {feed.isLoading && <Spinner label="Loading feed" />}

      {pinned.length > 0 && <Card>{pinned.map((i) => renderItem(i, true))}</Card>}

      <Card>
        {items.length === 0 && !feed.isLoading && (
          <p style={{ color: 'var(--color-text-muted)' }}>Nothing here yet.</p>
        )}
        {items.map((i) => renderItem(i, false))}
        <div ref={sentinelRef} />
        {isFetchingNextPage && <Spinner label="Loading more" />}
      </Card>
    </div>
  );
}
