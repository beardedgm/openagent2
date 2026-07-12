import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { TaskEditorPage } from './TaskEditorPage';

const { getMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
}));
vi.mock('../api/client', () => ({ api: { get: getMock, post: postMock } }));

vi.mock('../components/RichTextEditor', () => ({
  RichTextEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="Description" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const me = {
  id: 'b1',
  email: 'broker@example.com',
  role: 'broker',
  officeId: null,
  status: 'active',
  displayName: 'Bea Broker',
  phone: '',
  photoUrl: '',
  bio: '',
  emailPrefs: {},
  lastLoginAt: null,
  createdAt: '',
};

const settings = {
  brandName: 'Acme Realty',
  logoUrl: '',
  primaryColor: '#1d4ed8',
  officeLocations: [{ _id: 'o1', name: 'Downtown', address: '', timezone: 'America/Chicago' }],
  rssFeeds: [],
  welcomeMessage: '',
  quickLinks: [],
  homepageLayout: [],
};

const activeUser1 = {
  id: 'u1',
  email: 'alice@example.com',
  role: 'agent',
  officeId: null,
  status: 'active',
  displayName: 'Alice Agent',
  phone: '',
  photoUrl: '',
  bio: '',
  emailPrefs: {},
  lastLoginAt: null,
  createdAt: '',
};

const activeUser2 = {
  id: 'u2',
  email: 'bob@example.com',
  role: 'agent',
  officeId: null,
  status: 'active',
  displayName: 'Bob Agent',
  phone: '',
  photoUrl: '',
  bio: '',
  emailPrefs: {},
  lastLoginAt: null,
  createdAt: '',
};

const deactivatedUser = {
  id: 'u3',
  email: 'carol@example.com',
  role: 'agent',
  officeId: null,
  status: 'deactivated',
  displayName: 'Carol Deactivated',
  phone: '',
  photoUrl: '',
  bio: '',
  emailPrefs: {},
  lastLoginAt: null,
  createdAt: '',
};

function mockApi() {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { data: { user: me } };
    if (url === '/settings') return { data: { settings } };
    if (url.startsWith('/users')) return { data: { users: [activeUser1, activeUser2, deactivatedUser] } };
    if (url.startsWith('/resources?')) return { data: { resources: [], total: 0, page: 1 } };
    throw new Error(`Unhandled GET ${url}`);
  });
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/tasks/new']}>
        <Routes>
          <Route path="/tasks/new" element={<TaskEditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('TaskEditorPage', () => {
  it('excludes deactivated users from the audience picker and submits the users audience', async () => {
    mockApi();
    postMock.mockResolvedValue({ data: { task: { id: 'tnew' } } });

    render(wrap());

    await userEvent.selectOptions(await screen.findByLabelText(/audience/i), 'users');

    expect(await screen.findByText('Alice Agent')).toBeInTheDocument();
    expect(screen.getByText('Bob Agent')).toBeInTheDocument();
    expect(screen.queryByText('Carol Deactivated')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('checkbox', { name: /bob agent/i }));
    await userEvent.type(screen.getByLabelText('Title'), 'Submit onboarding docs');
    await userEvent.click(screen.getByRole('button', { name: /create task/i }));

    expect(postMock).toHaveBeenCalledWith(
      '/tasks',
      expect.objectContaining({
        title: 'Submit onboarding docs',
        audience: { type: 'users', userIds: ['u2'], officeId: null },
      }),
    );
  });

  it('disables submit while a users audience has no selection', async () => {
    mockApi();
    render(wrap());

    await userEvent.selectOptions(await screen.findByLabelText(/audience/i), 'users');
    await userEvent.type(screen.getByLabelText('Title'), 'Something');

    expect(screen.getByRole('button', { name: /create task/i })).toBeDisabled();
  });
});
