import type { CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { useSettings } from '../../api/hooks';
import { Card } from '../ui/Card';

// Button-style tile per PRD 5.1.2 ("render as button-style tiles") — same accent-filled
// Link-as-button pattern used for primary page actions (e.g. ResourceHubPage's "New resource").
const tileStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 44,
  padding: '0 var(--space-4)',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--color-accent)',
  color: '#fff',
  fontWeight: 600,
  textDecoration: 'none',
};

export function QuickLinksWidget() {
  const { data: settings } = useSettings();
  const links = settings?.quickLinks ?? [];

  return (
    <Card>
      <h2 style={{ fontSize: 18 }}>Quick links</h2>
      {links.length === 0 && <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>No quick links yet.</p>}
      {links.length > 0 && (
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginTop: 'var(--space-3)' }}>
          {links.map((link) =>
            link.url.startsWith('/') ? (
              <Link key={link.url} to={link.url} style={tileStyle}>
                {link.label}
              </Link>
            ) : (
              <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" style={tileStyle}>
                {link.label}
              </a>
            ),
          )}
        </div>
      )}
    </Card>
  );
}
