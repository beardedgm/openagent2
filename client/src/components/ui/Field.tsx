import type { InputHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';

export function Field({
  label,
  error,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: ReactNode }) {
  const id = useId();
  return (
    <div style={{ display: 'grid', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
      <label htmlFor={id} style={{ fontWeight: 600, fontSize: 14 }}>
        {label}
      </label>
      <input
        id={id}
        {...props}
        aria-invalid={!!error}
        style={{
          border: `1px solid ${error ? 'var(--color-danger)' : 'var(--color-border)'}`,
          borderRadius: 'var(--radius-sm)',
          padding: '0 var(--space-3)',
          background: 'var(--color-surface)',
        }}
      />
      {hint && <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>{hint}</span>}
      {error && (
        <span role="alert" style={{ color: 'var(--color-danger)', fontSize: 13 }}>
          {error}
        </span>
      )}
    </div>
  );
}
