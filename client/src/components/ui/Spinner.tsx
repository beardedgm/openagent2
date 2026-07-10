export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-label={label} style={{ display: 'grid', placeItems: 'center', padding: 'var(--space-6)' }}>
      <div
        style={{
          width: 28,
          height: 28,
          border: '3px solid var(--color-border)',
          borderTopColor: 'var(--color-accent)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <style>{'@keyframes spin { to { transform: rotate(360deg) } }'}</style>
    </div>
  );
}
