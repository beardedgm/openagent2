import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfilePage } from './ProfilePage';

const { getMock, patchMock } = vi.hoisted(() => ({ getMock: vi.fn(), patchMock: vi.fn() }));

vi.mock('../api/client', () => ({
  api: { get: getMock, post: vi.fn(), patch: patchMock },
}));

const user = {
  id: 'u1',
  email: 'ana@example.com',
  role: 'agent',
  officeId: null,
  status: 'active',
  displayName: 'Ana Agent',
  phone: '555-0100',
  photoUrl: '',
  bio: 'Hello',
  emailPrefs: {},
  lastLoginAt: null,
  createdAt: '',
};

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

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/profile/u1']}>
        <Routes>
          <Route path="/profile/:id" element={<ProfilePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ProfilePage', () => {
  beforeEach(() => {
    getMock.mockImplementation(async (url: string) => {
      if (url === '/auth/me') return { data: { user } };
      if (url === '/settings') return { data: { settings } };
      if (url === '/users/u1') return { data: { user } };
      throw new Error(`Unhandled GET ${url}`);
    });
    patchMock.mockReset();
  });

  it('seeds the edit form with the current profile values on Edit click', async () => {
    render(wrap());

    fireEvent.click(await screen.findByRole('button', { name: 'Edit profile' }));

    expect(screen.getByLabelText('Display name')).toHaveValue('Ana Agent');
    expect(screen.getByLabelText('Phone')).toHaveValue('555-0100');
    expect(screen.getByLabelText('Bio')).toHaveValue('Hello');
  });

  it('shows a role=alert message when saving fails', async () => {
    patchMock.mockRejectedValue(
      Object.assign(new Error('Bad Request'), {
        isAxiosError: true,
        response: { status: 400, data: { error: 'Phone number is invalid' } },
      }),
    );

    render(wrap());

    fireEvent.click(await screen.findByRole('button', { name: 'Edit profile' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Phone number is invalid');
  });

  it('toggles an email preference off on own profile', async () => {
    render(wrap()); // me.id === viewed id ('u1') → own profile

    const checkbox = await screen.findByRole('checkbox', { name: /important announcements/i });
    expect(checkbox).toBeChecked(); // absent pref defaults to on
    await userEvent.click(checkbox);
    expect(patchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/users\//),
      expect.objectContaining({ emailPrefs: expect.objectContaining({ postPublished: false }) }),
    );
  });
});
