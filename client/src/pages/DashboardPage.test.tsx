import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { BannerInfo, TaskInfo } from '../api/types';
import { DashboardPage } from './DashboardPage';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('../api/client', () => ({ api: { get: getMock } }));

function task(overrides: Partial<TaskInfo>): TaskInfo {
  return {
    id: 't1',
    title: 'T',
    descriptionHtml: '',
    createdBy: 'b',
    priority: 'Medium',
    dueAt: null,
    attachments: [],
    recurrence: 'none',
    isOnboarding: false,
    myCompletion: { completedAt: null, note: '' },
    counts: { total: 1, completed: 0 },
    relatedResourceId: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function banner(overrides: Partial<BannerInfo>): BannerInfo {
  return {
    id: 'b1',
    kind: 'text',
    title: 'Banner',
    imageUrl: '',
    bodyHtml: '',
    ctaLabel: '',
    ctaUrl: '',
    officeId: null,
    startAt: new Date().toISOString(),
    endAt: new Date().toISOString(),
    clickCount: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const settings = {
  brandName: 'Acme Realty',
  logoUrl: '',
  primaryColor: '#1d4ed8',
  officeLocations: [],
  rssFeeds: [],
  welcomeMessage: '',
  quickLinks: [],
  homepageLayout: [] as string[],
  reservableResources: [],
};

// Mirrors TasksPage.test.tsx's mockApi convention: one URL router covering every endpoint the
// dashboard's widgets can hit, with empty-shape defaults so unlisted widgets never throw
// "Unhandled GET" even if a test's layout happens to include them.
function mockDashboard(overrides: {
  settings?: Partial<typeof settings>;
  tasks?: TaskInfo[];
  onboarding?: { total: number; completed: number };
  banners?: BannerInfo[];
} = {}) {
  const mergedSettings = { ...settings, ...overrides.settings };
  getMock.mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { data: { user: { id: 'me', role: 'agent', displayName: 'Me', officeId: null } } };
    if (url === '/settings') return { data: { settings: mergedSettings } };
    if (url === '/banners/active') return { data: { banners: overrides.banners ?? [] } };
    if (url.startsWith('/tasks?')) return { data: { tasks: overrides.tasks ?? [] } };
    if (url === '/tasks/onboarding/mine') return { data: overrides.onboarding ?? { total: 0, completed: 0 } };
    if (url === '/feed') return { data: { pinned: [], items: [], nextCursor: null } };
    if (url.startsWith('/events')) return { data: { occurrences: [] } };
    if (url.startsWith('/posts')) return { data: { posts: [], total: 0, page: 1 } };
    throw new Error(`Unhandled GET ${url}`);
  });
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('DashboardPage', () => {
  it('shows the onboarding progress bar and open tasks, excluding completed ones', async () => {
    mockDashboard({
      settings: { homepageLayout: ['myTasks'] },
      tasks: [
        task({ id: 't1', title: 'Overdue thing', dueAt: new Date(Date.now() - 86_400_000).toISOString() }),
        task({ id: 't2', title: 'Done thing', myCompletion: { completedAt: new Date().toISOString(), note: '' } }),
      ],
      onboarding: { total: 3, completed: 1 },
    });

    render(wrap());

    const progressbar = await screen.findByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '33');

    expect(await screen.findByText('Overdue thing')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.queryByText('Done thing')).not.toBeInTheDocument();
  });

  it('hides the progress bar once onboarding is complete', async () => {
    mockDashboard({
      settings: { homepageLayout: ['myTasks'] },
      tasks: [],
      onboarding: { total: 3, completed: 3 },
    });

    render(wrap());

    expect(await screen.findByText('Nothing open — nice.')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('lists a due-soon task before a no-due-date task, even though the server returns no-due first', async () => {
    mockDashboard({
      settings: { homepageLayout: ['myTasks'] },
      // Mirrors the server's Mongo sort (dueAt ascending, nulls first).
      tasks: [
        task({ id: 't1', title: 'No due task', dueAt: null }),
        task({ id: 't2', title: 'Due soon task', dueAt: new Date(Date.now() + 86_400_000).toISOString() }),
      ],
      onboarding: { total: 0, completed: 0 },
    });

    render(wrap());

    const links = await screen.findAllByRole('link', { name: /task$/i });
    expect(links[0]).toHaveTextContent('Due soon task');
    expect(links[1]).toHaveTextContent('No due task');
  });

  it('renders only the widgets listed in homepageLayout, hiding the rest', async () => {
    mockDashboard({
      settings: { homepageLayout: ['welcome', 'banners', 'myTasks'], welcomeMessage: 'Hello team' },
      banners: [banner({ id: 'b1', title: 'Big announcement' })],
      tasks: [task({ id: 't1', title: 'Open task' })],
      onboarding: { total: 0, completed: 0 },
    });

    render(wrap());

    expect(await screen.findByText('Hello team')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /announcements/i })).toBeInTheDocument();
    expect(screen.getByText('Open task')).toBeInTheDocument();

    expect(screen.queryByText('Pinned announcements')).not.toBeInTheDocument();
    expect(screen.queryByText('Upcoming events')).not.toBeInTheDocument();
    expect(screen.queryByText('Latest activity')).not.toBeInTheDocument();
    expect(screen.queryByText('Quick links')).not.toBeInTheDocument();
  });

  it('hides the my-tasks card when homepageLayout omits myTasks, even if tasks exist', async () => {
    mockDashboard({
      settings: { homepageLayout: ['welcome'], welcomeMessage: 'hi' },
      tasks: [task({ id: 't1', title: 'Should not show' })],
      onboarding: { total: 0, completed: 0 },
    });

    render(wrap());

    expect(await screen.findByText('hi')).toBeInTheDocument();
    expect(screen.queryByText('My tasks')).not.toBeInTheDocument();
    expect(screen.queryByText('Should not show')).not.toBeInTheDocument();
  });

  it('renders the onboarding progress card regardless of homepageLayout contents', async () => {
    mockDashboard({
      settings: { homepageLayout: [] },
      onboarding: { total: 3, completed: 1 },
    });

    render(wrap());

    const progressbar = await screen.findByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '33');
  });
});
