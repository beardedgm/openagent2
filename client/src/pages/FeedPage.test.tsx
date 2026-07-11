import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { FeedPage } from './FeedPage';

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn(async () => ({})) }));
vi.mock('../api/client', () => ({ api: { get: getMock, post: postMock, delete: vi.fn() } }));

// jsdom has no IntersectionObserver — the page uses it for infinite scroll.
beforeAll(() => {
  class IO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('IntersectionObserver', IO);
});

function mockApi(role: string) {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { data: { user: { id: 'me', role, displayName: 'Me', officeId: null } } };
    if (url.startsWith('/feed'))
      return {
        data: {
          pinned: [
            { id: 'p', kind: 'internal', title: 'Pinned news', link: '', pinnedUntil: new Date(Date.now() + 86_400_000).toISOString(), date: new Date().toISOString() },
          ],
          items: [
            { id: 'i1', kind: 'internal', title: 'Ana joined', link: '/profile/a', date: new Date().toISOString() },
            { id: 'e1', kind: 'external', title: 'Rates dip', link: 'https://news.com/x', source: 'HW News', date: new Date().toISOString() },
          ],
          nextCursor: null,
        },
      };
    throw new Error(`Unhandled GET ${url}`);
  });
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/feed']}>
        <FeedPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('FeedPage', () => {
  it('renders pinned block, internal and external items with source, filters visible', async () => {
    mockApi('agent');
    render(wrap());
    expect(await screen.findByText('Pinned news')).toBeInTheDocument();
    expect(screen.getByText('Ana joined')).toBeInTheDocument();
    expect(screen.getByText(/HW News/)).toBeInTheDocument();
    for (const name of [/^all$/i, /internal/i, /external/i]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: /pin item/i })).not.toBeInTheDocument(); // agents can't pin
  });

  it('lets a broker pin an internal item', async () => {
    mockApi('broker');
    render(wrap());
    await screen.findByText('Ana joined');
    // Exact match: /pin item/i also matches "Unpin item" (the pinned block's button), which
    // renders before this one in DOM order and would otherwise be clicked instead.
    await userEvent.click(screen.getAllByRole('button', { name: 'Pin item' })[0]);
    expect(postMock).toHaveBeenCalledWith('/feed/i1/pin');
  });
});
