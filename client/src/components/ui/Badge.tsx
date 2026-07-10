import type { ReactNode } from 'react';

const colors = {
  neutral: 'var(--color-text-muted)',
  success: 'var(--color-success)',
  danger: 'var(--color-danger)',
  accent: 'var(--color-accent)',
};

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: keyof typeof colors }) {
  return (
    <span
      style={{
        color: colors[tone],
        border: `1px solid ${colors[tone]}`,
        borderRadius: 999,
        padding: '2px 10px',
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}
