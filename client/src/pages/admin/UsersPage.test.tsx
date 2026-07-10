import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersPage } from './UsersPage';

const { getMock, postMock, patchMock, deleteMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  patchMock: vi.fn(),
  deleteMock: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  api: { get: getMock, post: postMock, patch: patchMock, delete: deleteMock },
}));

const officeAdminUser = {
  id: 'admin1',
  email: 'admin@example.com',
  role: 'officeAdmin',
  officeId: null,
  status: 'active',
  displayName: 'Ada Admin',
  phone: '',
  photoUrl: '',
  bio: '',
  emailPrefs: {},
  lastLoginAt: null,
  createdAt: '',
};

const agentUser = {
  id: 'u2',
  email: 'ana@example.com',
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
};

const deactivatedAgent = {
  id: 'u3',
  email: 'deact@example.com',
  role: 'agent',
  officeId: null,
  status: 'deactivated',
  displayName: 'Dana Deactivated',
  phone: '',
  photoUrl: '',
  bio: '',
  emailPrefs: {},
  lastLoginAt: null,
  createdAt: '',
};

const brokerUser = {
  id: 'u4',
  email: 'bob@example.com',
  role: 'broker',
  officeId: null,
  status: 'active',
  displayName: 'Bob Broker',
  phone: '',
  photoUrl: '',
  bio: '',
  emailPrefs: {},
  lastLoginAt: null,
  createdAt: '',
};

const invitation = {
  id: 'inv1',
  email: 'invitee@example.com',
  role: 'agent',
  officeId: null,
  expiresAt: '2999-01-01T00:00:00.000Z',
};

const settings = {
  brandName: 'Acme Realty',
  logoUrl: '',
  primaryColor: '#1d4ed8',
  officeLocations: [{ _id: 'o1', name: 'Main Office', address: '', timezone: 'America/Chicago' }],
  rssFeeds: [],
  welcomeMessage: '',
  quickLinks: [],
  homepageLayout: [],
};

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/users']}>
        <UsersPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('UsersPage', () => {
  beforeEach(() => {
    getMock.mockImplementation(async (url: string) => {
      if (url === '/auth/me') return { data: { user: officeAdminUser } };
      if (url === '/users?includeDeactivated=true') {
        return { data: { users: [officeAdminUser, agentUser, deactivatedAgent, brokerUser] } };
      }
      if (url === '/users/invitations') return { data: { invitations: [invitation] } };
      if (url === '/settings') return { data: { settings } };
      throw new Error(`Unhandled GET ${url}`);
    });
    postMock.mockReset();
    patchMock.mockReset();
    deleteMock.mockReset();
  });

  it('renders the users table with all users and the pending invitation email', async () => {
    render(wrap());

    expect(await screen.findByText('Ada Admin')).toBeInTheDocument();
    expect(screen.getByText('Ana Agent')).toBeInTheDocument();
    expect(screen.getByText('Dana Deactivated')).toBeInTheDocument();
    expect(screen.getByText('Bob Broker')).toBeInTheDocument();
    expect(screen.getByText('invitee@example.com')).toBeInTheDocument();
  });

  it('does not offer a Broker role option for the agent row when viewed as officeAdmin', async () => {
    render(wrap());

    const roleSelect = await screen.findByLabelText('Role for Ana Agent');
    expect(within(roleSelect).queryByText('Broker')).not.toBeInTheDocument();
  });

  it('disables both selects on a broker row when viewed as officeAdmin', async () => {
    render(wrap());

    expect(await screen.findByLabelText('Role for Bob Broker')).toBeDisabled();
    expect(screen.getByLabelText('Office for Bob Broker')).toBeDisabled();
  });

  it('hides the Deactivate button on your own row but shows it on the agent row', async () => {
    render(wrap());

    await screen.findByText('Ana Agent');

    const ownRow = screen.getByText('Ada Admin').closest('tr');
    expect(within(ownRow!).queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();

    const agentRow = screen.getByText('Ana Agent').closest('tr');
    expect(within(agentRow!).getByRole('button', { name: 'Deactivate' })).toBeInTheDocument();
  });
});
