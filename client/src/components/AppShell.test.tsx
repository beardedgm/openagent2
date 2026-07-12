import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '../api/types';
import { useUiStore } from '../store/uiStore';
import { AppShell } from './AppShell';

function stubNarrowViewport(matches: boolean) {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

const { getMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn().mockResolvedValue({ data: undefined }),
}));

vi.mock('../api/client', () => ({
  api: { get: getMock, post: postMock },
}));

const brandSettings = { brandName: 'Acme Realty', logoUrl: '', primaryColor: '#1d4ed8' };

function baseUser(overrides: Partial<User>): User {
  return {
    id: 'u1',
    email: 'user@example.com',
    role: 'agent',
    officeId: null,
    status: 'active',
    displayName: 'Ana Agent',
    phone: '',
    photoUrl: '',
    bio: '',
    emailPrefs: {},
    lastLoginAt: null,
    createdAt: '',
    ...overrides,
  };
}

function mockAuthAs(user: User) {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { data: { user } };
    if (url === '/settings/public') return { data: { settings: brandSettings } };
    if (url === '/notifications') return { data: { notifications: [], unreadCount: 0, nextCursor: null } };
    throw new Error(`Unhandled GET ${url}`);
  });
}

function wrap(initialEntries: string[] = ['/']) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<div>Page content</div>} />
            <Route path="/tasks" element={<div>Tasks content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('AppShell', () => {
  it('shows Home and Directory links but no admin section for an agent', async () => {
    mockAuthAs(baseUser({ role: 'agent', displayName: 'Ana Agent' }));

    render(wrap());

    expect(await screen.findByText('Acme Realty')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /home/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /directory/i })).toBeInTheDocument();
    expect(screen.queryByText('ADMIN')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /users/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /settings/i })).not.toBeInTheDocument();
  });

  it('shows Users and Settings links for a broker', async () => {
    mockAuthAs(baseUser({ role: 'broker', displayName: 'Bob Broker' }));

    render(wrap());

    expect(await screen.findByText('ADMIN')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /users/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /settings/i })).toBeInTheDocument();
  });

  it('posts a page-view beacon once for the initial route and does not double-post on rerender', async () => {
    mockAuthAs(baseUser({ role: 'agent', displayName: 'Ana Agent' }));
    postMock.mockClear();

    const element = wrap(['/tasks']);
    const { rerender } = render(element);

    await screen.findByText('Tasks content');
    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith('/engagement/page-view', { path: '/tasks' });

    rerender(element);

    expect(postMock).toHaveBeenCalledTimes(1);
  });

  describe('narrow-viewport sidebar overlay', () => {
    afterEach(() => {
      useUiStore.setState({ sidebarOpen: window.innerWidth > 880 });
    });

    it('renders a scrim behind the open sidebar and closes on scrim click', async () => {
      const restoreMatchMedia = stubNarrowViewport(true);
      mockAuthAs(baseUser({ role: 'agent', displayName: 'Ana Agent' }));
      useUiStore.setState({ sidebarOpen: true });

      render(wrap());
      await screen.findByText('Acme Realty');

      const scrim = document.querySelector('[data-testid="sidebar-scrim"]');
      expect(scrim).toBeInTheDocument();
      expect(scrim).toHaveAttribute('aria-hidden', 'true');

      fireEvent.click(scrim!);
      expect(useUiStore.getState().sidebarOpen).toBe(false);

      restoreMatchMedia();
    });

    it('closes the sidebar on Escape', async () => {
      const restoreMatchMedia = stubNarrowViewport(true);
      mockAuthAs(baseUser({ role: 'agent', displayName: 'Ana Agent' }));
      useUiStore.setState({ sidebarOpen: true });

      render(wrap());
      await screen.findByText('Acme Realty');

      fireEvent.keyDown(screen.getByRole('navigation', { name: /main navigation/i }), { key: 'Escape' });
      expect(useUiStore.getState().sidebarOpen).toBe(false);

      restoreMatchMedia();
    });
  });
});
