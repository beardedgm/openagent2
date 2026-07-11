import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { PostEditorPage } from './PostEditorPage';

const { getMock, postMock, patchMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  patchMock: vi.fn(),
}));
vi.mock('../api/client', () => ({ api: { get: getMock, post: postMock, patch: patchMock } }));

vi.mock('../components/RichTextEditor', () => ({
  RichTextEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="Body" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const me = { id: 'u1', email: 'admin@example.com', role: 'officeAdmin', officeId: null, status: 'active', displayName: 'Admin', phone: '', photoUrl: '', bio: '', emailPrefs: {}, lastLoginAt: null, createdAt: '' };

const settings = {
  brandName: 'Acme Realty',
  logoUrl: '',
  primaryColor: '#1d4ed8',
  officeLocations: [],
  rssFeeds: [],
  welcomeMessage: '',
  quickLinks: [],
  homepageLayout: [],
};

function wrap(path: string, routePath: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routePath} element={<PostEditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PostEditorPage', () => {
  it('seeds the form with the existing post in edit mode', async () => {
    getMock.mockImplementation(async (url: string) => {
      if (url === '/auth/me') return { data: { user: me } };
      if (url === '/settings') return { data: { settings } };
      if (url === '/posts/p1')
        return {
          data: {
            post: {
              id: 'p1',
              title: 'Seeded title',
              bodyHtml: '<p>seeded body</p>',
              excerpt: '',
              author: { id: 'u1', displayName: 'Admin', photoUrl: '' },
              officeId: null,
              important: true,
              commentsEnabled: false,
              pinnedAt: null,
              publishAt: new Date(Date.now() - 86_400_000).toISOString(),
              createdAt: new Date().toISOString(),
            },
          },
        };
      throw new Error(`Unhandled GET ${url}`);
    });

    render(wrap('/board/p1/edit', '/board/:id/edit'));

    expect(await screen.findByDisplayValue('Seeded title')).toBeInTheDocument();
    expect(screen.getByLabelText('Body')).toHaveValue('<p>seeded body</p>');
    expect(screen.getByRole('checkbox', { name: /important/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /allow comments/i })).not.toBeChecked();
  });

  it('submits a new post and posts to /posts', async () => {
    getMock.mockImplementation(async (url: string) => {
      if (url === '/auth/me') return { data: { user: me } };
      if (url === '/settings') return { data: { settings } };
      throw new Error(`Unhandled GET ${url}`);
    });
    postMock.mockResolvedValue({
      data: {
        post: {
          id: 'pnew',
          title: 'New title',
          bodyHtml: '',
          excerpt: '',
          author: null,
          officeId: null,
          important: false,
          commentsEnabled: true,
          pinnedAt: null,
          publishAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        },
      },
    });

    render(wrap('/board/new', '/board/new'));

    await userEvent.type(await screen.findByLabelText('Title'), 'New title');
    await userEvent.click(screen.getByRole('button', { name: /publish post/i }));

    expect(postMock).toHaveBeenCalledWith(
      '/posts',
      expect.objectContaining({ title: 'New title' }),
    );
  });

  it('publishes now when the schedule is cleared on a scheduled post', async () => {
    const scheduledPost = {
      id: 'p1',
      title: 'Scheduled post',
      bodyHtml: '<p>later</p>',
      excerpt: '',
      author: { id: 'u1', displayName: 'Admin', photoUrl: '' },
      officeId: null,
      important: false,
      commentsEnabled: true,
      pinnedAt: null,
      publishAt: new Date(Date.now() + 86_400_000).toISOString(), // in the future
      createdAt: new Date().toISOString(),
    };
    getMock.mockImplementation(async (url: string) => {
      if (url === '/auth/me') return { data: { user: me } };
      if (url === '/settings') return { data: { settings } };
      if (url === '/posts/p1') return { data: { post: scheduledPost } };
      throw new Error(`Unhandled GET ${url}`);
    });
    patchMock.mockResolvedValue({ data: { post: scheduledPost } });

    render(wrap('/board/p1/edit', '/board/:id/edit'));

    const scheduleInput = await screen.findByLabelText('Schedule (leave empty to publish now)');
    expect(scheduleInput).not.toHaveValue(''); // seeded with the future schedule
    await userEvent.clear(scheduleInput);
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(patchMock).toHaveBeenCalledTimes(1);
    const [url, body] = patchMock.mock.calls[0] as [string, { publishAt?: string }];
    expect(url).toBe('/posts/p1');
    expect(typeof body.publishAt).toBe('string');
    expect(new Date(body.publishAt!).getTime()).toBeLessThanOrEqual(Date.now() + 60_000); // "now", not the old future date
  });
});
