import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPage } from './SettingsPage';

const { getMock, postMock, patchMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  patchMock: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  api: { get: getMock, post: postMock, patch: patchMock },
}));
// The rich text editor drags in TipTap; the form only needs its value contract.
vi.mock('../../components/RichTextEditor', () => ({
  RichTextEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="Welcome message" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const brokerUser = {
  id: 'b1',
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

const serverSettings = {
  brandName: 'Acme Realty',
  logoUrl: '',
  primaryColor: '#1d4ed8',
  officeLocations: [{ _id: 'off1', name: 'Main Office', address: '1 Main St', timezone: 'America/Chicago' }],
  rssFeeds: [],
  welcomeMessage: '',
  quickLinks: [],
  homepageLayout: ['welcome', 'banners', 'announcements', 'myTasks', 'events', 'feed', 'quickLinks'],
  reservableResources: [{ _id: 'r1', name: 'Conference Room A' }],
  onboardingTaskTemplateId: null,
};

interface OfficeBody {
  _id?: string;
  name: string;
  address: string;
  timezone: string;
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <SettingsPage />
    </QueryClientProvider>
  );
}

describe('SettingsPage', () => {
  beforeEach(() => {
    getMock.mockImplementation(async (url: string) => {
      if (url === '/auth/me') return { data: { user: brokerUser } };
      if (url === '/settings') return { data: { settings: serverSettings } };
      if (url === '/task-templates') return { data: { templates: [] } };
      throw new Error(`Unhandled GET ${url}`);
    });
    postMock.mockReset();
    patchMock.mockReset();
    // Echo the saved settings back like the server does, minting an _id for any
    // office row that arrives without one.
    patchMock.mockImplementation(async (_url: string, body: { officeLocations: OfficeBody[] }) => ({
      data: {
        settings: {
          ...serverSettings,
          ...body,
          officeLocations: body.officeLocations.map((o) => ({ ...o, _id: o._id ?? 'off2-minted' })),
        },
      },
    }));
  });

  it('round-trips server-minted office ids on the save after an office is added', async () => {
    render(wrap());

    expect(await screen.findByLabelText('Office 1 name')).toHaveValue('Main Office');

    fireEvent.click(screen.getByRole('button', { name: 'Add office' }));
    fireEvent.change(screen.getByLabelText('Office 2 name'), { target: { value: 'Branch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    // "Saved" renders only after the mutation's onSuccess (including the re-seed) completes.
    await screen.findByText('Saved');
    const firstBody = patchMock.mock.calls[0][1];
    expect(firstBody.officeLocations[0]._id).toBe('off1');
    expect(firstBody.officeLocations[1]).not.toHaveProperty('_id');

    fireEvent.change(screen.getByLabelText('Office 2 name'), { target: { value: 'Branch Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(patchMock).toHaveBeenCalledTimes(2));
    const secondBody = patchMock.mock.calls[1][1];
    expect(secondBody.officeLocations[1]).toMatchObject({ _id: 'off2-minted', name: 'Branch Renamed' });
  });

  it('echoes reservable resource _ids back on save so event references never dangle', async () => {
    render(wrap());

    expect(await screen.findByLabelText('Resource 1 name')).toHaveValue('Conference Room A');

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByText('Saved');
    const body = patchMock.mock.calls[0][1];
    expect(body.reservableResources[0]).toMatchObject({ _id: 'r1', name: 'Conference Room A' });
  });

  it('blocks Save with a hint while the hex color is invalid', async () => {
    render(wrap());

    const hexField = await screen.findByLabelText('Primary color (hex)');
    fireEvent.change(hexField, { target: { value: '#12' } });

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.getByText('Enter a 6-digit hex color like #1a2b3c')).toBeInTheDocument();
  });

  it('lists all seven homepage widgets checked and reorders via Up/Down into the save body', async () => {
    render(wrap());
    await screen.findByLabelText('Office 1 name');

    for (const label of [
      'Welcome message',
      'Banner ads',
      'Pinned announcements',
      'My tasks',
      'Upcoming events',
      'Activity feed preview',
      'Quick links',
    ]) {
      expect(screen.getByLabelText(`Show ${label} widget`)).toBeChecked();
    }

    // "Welcome message" is first (index 0) so its Up button is disabled; move "Banner ads" up instead.
    expect(screen.getByLabelText('Move Welcome message up')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('Move Banner ads up'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByText('Saved');
    const body = patchMock.mock.calls[0][1];
    expect(body.homepageLayout).toEqual([
      'banners',
      'welcome',
      'announcements',
      'myTasks',
      'events',
      'feed',
      'quickLinks',
    ]);
  });

  it('removes a disabled widget from the saved homepageLayout', async () => {
    render(wrap());
    await screen.findByLabelText('Office 1 name');

    fireEvent.click(screen.getByLabelText('Show Banner ads widget'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByText('Saved');
    const body = patchMock.mock.calls[0][1];
    expect(body.homepageLayout).toEqual(['welcome', 'announcements', 'myTasks', 'events', 'feed', 'quickLinks']);
  });

  it('round-trips the welcome message and quick links into the save body', async () => {
    render(wrap());
    await screen.findByLabelText('Office 1 name');

    fireEvent.change(screen.getByLabelText('Welcome message'), { target: { value: '<p>Hi team</p>' } });

    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    fireEvent.change(screen.getByLabelText('Quick link 1 label'), { target: { value: 'Directory' } });
    fireEvent.change(screen.getByLabelText('Quick link 1 URL'), { target: { value: '/directory' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await screen.findByText('Saved');
    const body = patchMock.mock.calls[0][1];
    expect(body.welcomeMessage).toBe('<p>Hi team</p>');
    expect(body.quickLinks).toEqual([{ label: 'Directory', url: '/directory' }]);
  });

  it('blocks Save with a hint while a quick link URL is invalid', async () => {
    render(wrap());
    await screen.findByLabelText('Office 1 name');

    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    fireEvent.change(screen.getByLabelText('Quick link 1 label'), { target: { value: 'Bad' } });
    fireEvent.change(screen.getByLabelText('Quick link 1 URL'), { target: { value: 'ftp://x' } });

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.getByText('Every quick link URL must start with http://, https://, or / before you can save.')).toBeInTheDocument();
  });

  it('blocks Save with a hint while a quick link label is empty', async () => {
    render(wrap());
    await screen.findByLabelText('Office 1 name');

    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    fireEvent.change(screen.getByLabelText('Quick link 1 URL'), { target: { value: '/directory' } });

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(screen.getByText('Every quick link needs a label before you can save.')).toBeInTheDocument();
  });
});
