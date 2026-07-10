import type { HTMLAttributes } from 'react';

export function Card({ style, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-sm)',
        padding: 'var(--space-5)',
        ...style,
      }}
    />
  );
}
