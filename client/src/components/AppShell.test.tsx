import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { User } from '../api/types';
import { AppShell } from './AppShell';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock('../api/client', () => ({
  api: { get: getMock, post: vi.fn() },
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
    throw new Error(`Unhandled GET ${url}`);
  });
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<div>Page content</div>} />
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
});
