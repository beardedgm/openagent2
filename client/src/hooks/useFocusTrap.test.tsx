import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useFocusTrap } from './useFocusTrap';

function Harness({ active, onEscape }: { active: boolean; onEscape: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, active, onEscape);
  return (
    <div>
      <button>Outside</button>
      <div ref={ref}>
        <button>First</button>
        <button>Last</button>
      </div>
    </div>
  );
}

describe('useFocusTrap', () => {
  it('moves focus to the first focusable element inside the trap on activate', () => {
    const { rerender } = render(<Harness active={false} onEscape={() => {}} />);
    rerender(<Harness active onEscape={() => {}} />);
    expect(document.activeElement).toBe(screen.getByText('First'));
  });

  it('wraps Tab from the last focusable back to the first', () => {
    render(<Harness active onEscape={() => {}} />);
    screen.getByText('Last').focus();
    fireEvent.keyDown(screen.getByText('Last'), { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByText('First'));
  });

  it('wraps Shift+Tab from the first focusable back to the last', () => {
    render(<Harness active onEscape={() => {}} />);
    expect(document.activeElement).toBe(screen.getByText('First'));
    fireEvent.keyDown(screen.getByText('First'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText('Last'));
  });

  it('calls onEscape when Escape is pressed', () => {
    const onEscape = vi.fn();
    render(<Harness active onEscape={onEscape} />);
    fireEvent.keyDown(screen.getByText('First'), { key: 'Escape' });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('restores focus to the previously focused element on deactivate', () => {
    const { rerender } = render(<Harness active={false} onEscape={() => {}} />);
    const outside = screen.getByText('Outside');
    outside.focus();
    expect(document.activeElement).toBe(outside);

    rerender(<Harness active onEscape={() => {}} />);
    expect(document.activeElement).toBe(screen.getByText('First'));

    rerender(<Harness active={false} onEscape={() => {}} />);
    expect(document.activeElement).toBe(outside);
  });
});
