import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChunkErrorBoundary } from './ChunkErrorBoundary';

// jsdom's window.location.reload is non-configurable, so the component reloads via this
// wrapper module and the test stubs the module instead.
const { reloadMock } = vi.hoisted(() => ({ reloadMock: vi.fn() }));
vi.mock('../utils/reloadPage', () => ({ reloadPage: reloadMock }));

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

describe('ChunkErrorBoundary', () => {
  beforeEach(() => {
    sessionStorage.clear();
    reloadMock.mockClear();
    // React logs boundary-caught errors to console.error; keep test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the fallback for a generic error without reloading', () => {
    render(
      <ChunkErrorBoundary>
        <Boom message="plain render crash" />
      </ChunkErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/something went wrong/i);
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
    expect(reloadMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('chunk-reload-once')).toBeNull();
  });

  it('reloads once for a chunk-load failure, then falls back instead of looping', () => {
    render(
      <ChunkErrorBoundary>
        <Boom message="Failed to fetch dynamically imported module: /assets/Page-abc123.js" />
      </ChunkErrorBoundary>,
    );

    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem('chunk-reload-once')).toBe('1');

    // Same failure again in the same session (flag already set): no reload loop, fallback shows.
    render(
      <ChunkErrorBoundary>
        <Boom message="Failed to fetch dynamically imported module: /assets/Page-abc123.js" />
      </ChunkErrorBoundary>,
    );

    expect(reloadMock).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
  });
});
