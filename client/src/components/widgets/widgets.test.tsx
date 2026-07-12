import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AnnouncementsWidget } from './AnnouncementsWidget';
import { EventsWidget } from './EventsWidget';
import { FeedPreviewWidget } from './FeedPreviewWidget';
import { QuickLinksWidget } from './QuickLinksWidget';
import { WelcomeWidget } from './WelcomeWidget';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('../../api/client', () => ({ api: { get: getMock } }));

function wrap(children: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('dashboard widgets', () => {
  it('FeedPreviewWidget renders up to 5 feed item titles and a View all link to /feed', async () => {
    getMock.mockImplementation(async (url: string) => {
      if (url === '/feed') {
        return {
          data: {
            pinned: [{ id: 'p1', kind: 'internal', title: 'Pinned item', link: '/board/p1', date: new Date().toISOString() }],
            items: [
              { id: 'i1', kind: 'internal', title: 'Item one', link: '/board/i1', date: new Date().toISOString() },
              { id: 'i2', kind: 'internal', title: 'Item two', link: '/board/i2', date: new Date().toISOString() },
              { id: 'i3', kind: 'internal', title: 'Item three', link: '/board/i3', date: new Date().toISOString() },
              { id: 'i4', kind: 'internal', title: 'Item four', link: '/board/i4', date: new Date().toISOString() },
              { id: 'i5', kind: 'internal', title: 'Item five', link: '/board/i5', date: new Date().toISOString() },
              { id: 'i6', kind: 'internal', title: 'Item six', link: '/board/i6', date: new Date().toISOString() },
            ],
            nextCursor: null,
          },
        };
      }
      throw new Error(`Unhandled GET ${url}`);
    });

    render(wrap(<FeedPreviewWidget />));

    expect(await screen.findByText('Pinned item')).toBeInTheDocument();
    expect(screen.getByText('Item one')).toBeInTheDocument();
    expect(screen.getByText('Item two')).toBeInTheDocument();
    expect(screen.getByText('Item three')).toBeInTheDocument();
    expect(screen.getByText('Item four')).toBeInTheDocument();
    // Only 5 total across pinned+items should render.
    expect(screen.queryByText('Item five')).not.toBeInTheDocument();
    expect(screen.queryByText('Item six')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view all/i })).toHaveAttribute('href', '/feed');
  });

  it('EventsWidget renders occurrence titles and a link to /calendar', async () => {
    getMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/events')) {
        return {
          data: {
            occurrences: [
              {
                event: { id: 'e1', title: 'Office meeting' },
                startAt: new Date(Date.now() + 86_400_000).toISOString(),
                endAt: new Date(Date.now() + 90_000_000).toISOString(),
              },
              {
                event: { id: 'e2', title: 'Client walkthrough' },
                startAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
                endAt: new Date(Date.now() + 2 * 86_400_000 + 3_600_000).toISOString(),
              },
            ],
            nextCursor: null,
          },
        };
      }
      throw new Error(`Unhandled GET ${url}`);
    });

    render(wrap(<EventsWidget />));

    expect(await screen.findByText('Office meeting')).toBeInTheDocument();
    expect(screen.getByText('Client walkthrough')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view calendar/i })).toHaveAttribute('href', '/calendar');
  });

  it('AnnouncementsWidget renders only pinned post titles, max 3, linking to /board/:id', async () => {
    getMock.mockImplementation(async (url: string) => {
      if (url.startsWith('/posts')) {
        return {
          data: {
            posts: [
              { id: 'p1', title: 'Pinned one', pinnedAt: new Date().toISOString() },
              { id: 'p2', title: 'Pinned two', pinnedAt: new Date().toISOString() },
              { id: 'p3', title: 'Not pinned', pinnedAt: null },
              { id: 'p4', title: 'Also not pinned', pinnedAt: null },
            ],
            total: 4,
            page: 1,
          },
        };
      }
      throw new Error(`Unhandled GET ${url}`);
    });

    render(wrap(<AnnouncementsWidget />));

    expect(await screen.findByText('Pinned one')).toBeInTheDocument();
    expect(screen.getByText('Pinned two')).toBeInTheDocument();
    expect(screen.queryByText('Not pinned')).not.toBeInTheDocument();
    expect(screen.queryByText('Also not pinned')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /pinned one/i })).toHaveAttribute('href', '/board/p1');
  });

  it('QuickLinksWidget renders external links as safe anchors and internal links as router links', async () => {
    getMock.mockImplementation(async (url: string) => {
      if (url === '/settings') {
        return {
          data: {
            settings: {
              quickLinks: [
                { label: 'MLS Portal', url: 'https://mls.example.com' },
                { label: 'Directory', url: '/directory' },
              ],
            },
          },
        };
      }
      throw new Error(`Unhandled GET ${url}`);
    });

    render(wrap(<QuickLinksWidget />));

    const external = await screen.findByRole('link', { name: 'MLS Portal' });
    expect(external).toHaveAttribute('href', 'https://mls.example.com');
    expect(external).toHaveAttribute('target', '_blank');
    expect(external).toHaveAttribute('rel', 'noopener noreferrer');

    const internal = screen.getByRole('link', { name: 'Directory' });
    expect(internal).toHaveAttribute('href', '/directory');
    expect(internal).not.toHaveAttribute('target');
  });

  it('WelcomeWidget renders sanitized welcome message HTML', async () => {
    getMock.mockImplementation(async (url: string) => {
      if (url === '/settings') {
        return { data: { settings: { brandName: 'Acme Realty', welcomeMessage: '<p><strong>Hi</strong></p>' } } };
      }
      throw new Error(`Unhandled GET ${url}`);
    });

    render(wrap(<WelcomeWidget />));

    expect(await screen.findByText('Acme Realty')).toBeInTheDocument();
    const strong = await screen.findByText('Hi');
    expect(strong.tagName).toBe('STRONG');
  });
});
