import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';

export function Modal({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={title}
      style={{
        border: 'none',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-md)',
        padding: 'var(--space-5)',
        width: 'min(480px, 90vw)',
      }}
    >
      <h2 style={{ fontSize: 18 }}>{title}</h2>
      {open && children}
    </dialog>
  );
}
