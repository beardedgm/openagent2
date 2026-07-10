import type { ButtonHTMLAttributes, CSSProperties } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';

const styles: Record<Variant, CSSProperties> = {
  primary: { background: 'var(--color-accent)', color: '#fff', border: '1px solid transparent' },
  secondary: {
    background: 'var(--color-surface)',
    color: 'var(--color-text)',
    border: '1px solid var(--color-border)',
  },
  danger: { background: 'var(--color-danger)', color: '#fff', border: '1px solid transparent' },
};

export function Button({
  variant = 'primary',
  style,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      style={{
        ...styles[variant],
        borderRadius: 'var(--radius-sm)',
        padding: '0 var(--space-4)',
        fontWeight: 600,
        opacity: props.disabled ? 0.6 : 1,
        ...style,
      }}
    />
  );
}
