import type { RefObject } from 'react';
import { useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Contains Tab focus inside `ref` while `active`; Escape calls onEscape; restores focus on
 * deactivate. Initial focus goes to `initialFocus` when provided (e.g. a safe control such as
 * a Close button), otherwise the first focusable element inside the trap.
 */
export function useFocusTrap(
  ref: RefObject<HTMLElement>,
  active: boolean,
  onEscape: () => void,
  initialFocus?: RefObject<HTMLElement>,
) {
  const restoreRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!active || !ref.current) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const focusables = () => [...el.querySelectorAll<HTMLElement>(FOCUSABLE)];
    (initialFocus?.current ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onEscape();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      restoreRef.current?.focus();
    };
  }, [active, ref, onEscape, initialFocus]);
}
