import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PostPage } from './PostPage';

const { getMock, postMock, deleteMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(async () => ({ data: {} })),
  deleteMock: vi.fn(async () => ({ data: {} })),
}));
vi.mock('../api/client', () => ({ api: { get: getMock, post: postMock, delete: deleteMock, patch: vi.fn() } }));

function mockApi({ role = 'agent', commentsEnabled = true } = {}) {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/auth/me')
      return { data: { user: { id: 'me', role, displayName: 'Me', officeId: null } } };
    if (url === '/posts/p1')
      return {
        data: {
          post: {
            id: 'p1',
            title: 'Big news',
            bodyHtml: '<p>Rich <strong>body</strong></p>',
            excerpt: '',
            author: { id: 'a1', displayName: 'Bob', photoUrl: '' },
            officeId: null,
            important: false,
            commentsEnabled,
            pinnedAt: null,
            publishAt: new Date().toISOString(),
            createdAt: new Date().toISOString(),
          },
        },
      };
    if (url === '/posts/p1/comments')
      return {
        data: {
          comments: [
            { id: 'c1', body: 'Mine', author: { id: 'me', displayName: 'Me', photoUrl: '' }, createdAt: new Date().toISOString() },
            { id: 'c2', body: 'Theirs', author: { id: 'x', displayName: 'X', photoUrl: '' }, createdAt: new Date().toISOString() },
          ],
        },
      };
    throw new Error(`Unhandled GET ${url}`);
  });
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/board/p1']}>
        <Routes>
          <Route path="/board/:id" element={<PostPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PostPage', () => {
  it('renders rich body, comments, and delete only on own comment for agents', async () => {
    mockApi();
    render(wrap());
    expect(await screen.findByText('Big news')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument(); // <strong> rendered
    expect(screen.getByText('Mine')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /delete comment/i })).toHaveLength(1);
    expect(screen.queryByRole('link', { name: /edit/i })).not.toBeInTheDocument();
  });

  it('submits a comment', async () => {
    mockApi();
    render(wrap());
    await screen.findByText('Big news');
    await userEvent.type(screen.getByLabelText(/add a comment/i), 'Great!');
    await userEvent.click(screen.getByRole('button', { name: /^comment$/i }));
    expect(postMock).toHaveBeenCalledWith('/posts/p1/comments', { body: 'Great!' });
  });

  it('surfaces an error when adding a comment fails', async () => {
    mockApi();
    postMock.mockRejectedValueOnce(
      Object.assign(new Error('request failed'), {
        isAxiosError: true,
        response: { data: { error: 'Comments are disabled on this post' } },
      }),
    );
    render(wrap());
    await screen.findByText('Big news');
    await userEvent.type(screen.getByLabelText(/add a comment/i), 'Great!');
    await userEvent.click(screen.getByRole('button', { name: /^comment$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Comments are disabled on this post');
  });

  it('hides the comment form when comments are disabled and shows admin actions', async () => {
    mockApi({ role: 'broker', commentsEnabled: false });
    render(wrap());
    await screen.findByText('Big news');
    expect(screen.queryByLabelText(/add a comment/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pin/i })).toBeInTheDocument();
    // admins can delete any comment
    expect(screen.getAllByRole('button', { name: /delete comment/i })).toHaveLength(2);
  });
});
