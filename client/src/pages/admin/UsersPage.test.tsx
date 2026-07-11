import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
      if (url === '/tasks/onboarding/status') return { data: { statuses: [] } };
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
    // The locked select still displays the broker's actual role, not a blank value.
    expect(screen.getByLabelText('Role for Bob Broker')).toHaveValue('broker');
  });

  it('PATCHes the new role when the agent row role select changes', async () => {
    patchMock.mockResolvedValue({ data: { user: { ...agentUser, role: 'officeAdmin' } } });
    render(wrap());

    const roleSelect = await screen.findByLabelText('Role for Ana Agent');
    fireEvent.change(roleSelect, { target: { value: 'officeAdmin' } });

    await waitFor(() => expect(patchMock).toHaveBeenCalledWith('/users/u2', { role: 'officeAdmin' }));
  });

  it('keeps the email-not-sent warning visible after the invite modal closes', async () => {
    postMock.mockResolvedValue({
      data: {
        invitation: { id: 'inv2', email: 'new@example.com', role: 'agent', expiresAt: '2999-01-01T00:00:00.000Z' },
        emailSent: false,
      },
    });
    render(wrap());

    fireEvent.click(await screen.findByRole('button', { name: 'Invite user' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send invite' }));

    const warning = await screen.findByRole('status');
    expect(warning).toHaveTextContent('Invitation created but the email could not be sent — use Resend.');

    // The dialog's queued close event (which resets the invite draft) must not wipe the
    // warning. The modal's children unmount as soon as open flips, so also flush the
    // timer queue to guarantee the close event has actually fired before re-asserting.
    await waitFor(() => expect(screen.queryByLabelText('Email')).not.toBeInTheDocument());
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(screen.getByRole('status')).toHaveTextContent(
      'Invitation created but the email could not be sent — use Resend.',
    );
  });

  it('renders the onboarding column as Done, in-progress, or — per row', async () => {
    getMock.mockImplementation(async (url: string) => {
      if (url === '/auth/me') return { data: { user: officeAdminUser } };
      if (url === '/users?includeDeactivated=true') {
        return { data: { users: [officeAdminUser, agentUser, deactivatedAgent, brokerUser] } };
      }
      if (url === '/users/invitations') return { data: { invitations: [invitation] } };
      if (url === '/settings') return { data: { settings } };
      if (url === '/tasks/onboarding/status') {
        return { data: { statuses: [
          { userId: 'u2', total: 3, completed: 3 },
          { userId: 'u3', total: 4, completed: 1 },
        ] } };
      }
      throw new Error(`Unhandled GET ${url}`);
    });

    render(wrap());

    const agentRow = (await screen.findByText('Ana Agent')).closest('tr');
    expect(within(agentRow!).getByText('Done')).toBeInTheDocument();

    const deactivatedRow = screen.getByText('Dana Deactivated').closest('tr');
    expect(within(deactivatedRow!).getByText('1/4')).toBeInTheDocument();

    const ownRow = screen.getByText('Ada Admin').closest('tr');
    expect(within(ownRow!).getByText('—')).toBeInTheDocument();
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
