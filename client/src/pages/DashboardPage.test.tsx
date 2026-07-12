import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { TaskInfo } from '../api/types';
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

const settings = {
  brandName: 'Acme Realty',
  logoUrl: '',
  primaryColor: '#1d4ed8',
  officeLocations: [],
  rssFeeds: [],
  welcomeMessage: '',
  quickLinks: [],
  homepageLayout: [],
  reservableResources: [],
};

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
    getMock.mockImplementation(async (url: string) => {
      if (url === '/auth/me') return { data: { user: { id: 'me', role: 'agent', displayName: 'Me', officeId: null } } };
      if (url === '/settings') return { data: { settings } };
      if (url === '/banners/active') return { data: { banners: [] } };
      if (url.startsWith('/tasks?')) {
        return {
          data: {
            tasks: [
              task({ id: 't1', title: 'Overdue thing', dueAt: new Date(Date.now() - 86_400_000).toISOString() }),
              task({ id: 't2', title: 'Done thing', myCompletion: { completedAt: new Date().toISOString(), note: '' } }),
            ],
          },
        };
      }
      if (url === '/tasks/onboarding/mine') return { data: { total: 3, completed: 1 } };
      throw new Error(`Unhandled GET ${url}`);
    });

    render(wrap());

    const progressbar = await screen.findByRole('progressbar');
    expect(progressbar).toHaveAttribute('aria-valuenow', '33');

    expect(await screen.findByText('Overdue thing')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.queryByText('Done thing')).not.toBeInTheDocument();
  });

  it('hides the progress bar once onboarding is complete', async () => {
    getMock.mockImplementation(async (url: string) => {
      if (url === '/auth/me') return { data: { user: { id: 'me', role: 'agent', displayName: 'Me', officeId: null } } };
      if (url === '/settings') return { data: { settings } };
      if (url === '/banners/active') return { data: { banners: [] } };
      if (url.startsWith('/tasks?')) return { data: { tasks: [] } };
      if (url === '/tasks/onboarding/mine') return { data: { total: 3, completed: 3 } };
      throw new Error(`Unhandled GET ${url}`);
    });

    render(wrap());

    expect(await screen.findByText('Nothing open — nice.')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('lists a due-soon task before a no-due-date task, even though the server returns no-due first', async () => {
    getMock.mockImplementation(async (url: string) => {
      if (url === '/auth/me') return { data: { user: { id: 'me', role: 'agent', displayName: 'Me', officeId: null } } };
      if (url === '/settings') return { data: { settings } };
      if (url === '/banners/active') return { data: { banners: [] } };
      if (url.startsWith('/tasks?')) {
        return {
          data: {
            // Mirrors the server's Mongo sort (dueAt ascending, nulls first).
            tasks: [
              task({ id: 't1', title: 'No due task', dueAt: null }),
              task({ id: 't2', title: 'Due soon task', dueAt: new Date(Date.now() + 86_400_000).toISOString() }),
            ],
          },
        };
      }
      if (url === '/tasks/onboarding/mine') return { data: { total: 0, completed: 0 } };
      throw new Error(`Unhandled GET ${url}`);
    });

    render(wrap());

    const links = await screen.findAllByRole('link', { name: /task$/i });
    expect(links[0]).toHaveTextContent('Due soon task');
    expect(links[1]).toHaveTextContent('No due task');
  });
});
