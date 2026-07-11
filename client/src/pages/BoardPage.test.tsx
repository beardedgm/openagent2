import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Post } from '../api/types';
import { BoardPage } from './BoardPage';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('../api/client', () => ({ api: { get: getMock } }));

function post(overrides: Partial<Post>): Post {
  return {
    id: 'p1',
    title: 'T',
    bodyHtml: '',
    excerpt: '',
    author: { id: 'u1', displayName: 'Bob Broker', photoUrl: '' },
    officeId: null,
    important: false,
    commentsEnabled: true,
    pinnedAt: null,
    publishAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function mockApi(me: { id: string; role: string }, posts: Post[]) {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { data: { user: { ...me, displayName: 'x', officeId: null } } };
    if (url.startsWith('/posts')) return { data: { posts, total: posts.length, page: 1 } };
    throw new Error(`Unhandled GET ${url}`);
  });
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/board']}>
        <BoardPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('BoardPage', () => {
  it('lists posts with pinned and important badges', async () => {
    mockApi({ id: 'u9', role: 'agent' }, [
      post({ id: 'p1', title: 'Pinned post', pinnedAt: new Date().toISOString() }),
      post({ id: 'p2', title: 'Urgent post', important: true }),
    ]);
    render(wrap());
    expect(await screen.findByText('Pinned post')).toBeInTheDocument();
    expect(screen.getByText('Pinned')).toBeInTheDocument();
    expect(screen.getByText('Important')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /new post/i })).not.toBeInTheDocument(); // agents cannot create
  });

  it('shows the New post action for admins', async () => {
    mockApi({ id: 'u1', role: 'officeAdmin' }, []);
    render(wrap());
    expect(await screen.findByRole('link', { name: /new post/i })).toBeInTheDocument();
  });
});
