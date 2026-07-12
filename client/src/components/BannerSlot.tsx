import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { trackBannerClick, useActiveBanners } from '../api/hooks';
import type { BannerInfo } from '../api/types';

const VISIBLE = 3;
const ROTATE_MS = 5000;

/** Homepage banner slot (PRD 5.5). ≤3 active → static; >3 → the 3-wide window advances
 * one banner every 5s, wrapping. Renders nothing when no banner is active. */
export function BannerSlot() {
  const { data: banners } = useActiveBanners();
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);
  const count = banners?.length ?? 0;

  useEffect(() => {
    if (count <= VISIBLE) return;
    const timer = setInterval(() => setOffset((o) => (o + 1) % count), ROTATE_MS);
    return () => clearInterval(timer);
  }, [count]);

  if (!banners || count === 0) return null;
  const visible = count <= VISIBLE ? banners : Array.from({ length: VISIBLE }, (_, i) => banners[(offset + i) % count]);

  const follow = (b: BannerInfo) => {
    trackBannerClick(b.id);
    if (!b.ctaUrl) return;
    if (b.ctaUrl.startsWith('/')) navigate(b.ctaUrl);
    else window.open(b.ctaUrl, '_blank', 'noopener,noreferrer');
  };

  return (
    <div role="region" aria-label="Announcements" style={{ display: 'grid', gridTemplateColumns: `repeat(${visible.length}, 1fr)`, gap: 'var(--space-3)' }}>
      {visible.map((b) => (
        <button
          key={b.id}
          type="button"
          aria-label={b.ctaLabel ? `${b.title} — ${b.ctaLabel}` : b.title}
          onClick={() => follow(b)}
          style={{
            textAlign: 'left', cursor: b.ctaUrl ? 'pointer' : 'default', minHeight: 88, padding: 0,
            border: '1px solid var(--color-border)', borderRadius: 12, overflow: 'hidden',
            background: 'var(--color-surface)', color: 'var(--color-text)',
          }}
        >
          {b.kind === 'image' ? (
            <img src={b.imageUrl} alt={b.title} style={{ width: '100%', height: 120, objectFit: 'cover', display: 'block' }} />
          ) : (
            <div style={{ padding: 'var(--space-3)' }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{b.title}</div>
              {/* Server-sanitized via sanitizePostHtml — same trust boundary as post bodies. */}
              <div style={{ fontSize: 13 }} dangerouslySetInnerHTML={{ __html: b.bodyHtml }} />
              {b.ctaLabel && <span style={{ color: 'var(--color-accent)', fontSize: 13, fontWeight: 600 }}>{b.ctaLabel} →</span>}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}
