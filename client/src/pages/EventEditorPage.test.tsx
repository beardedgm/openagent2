import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { EventEditorPage } from './EventEditorPage';

const { getMock, postMock, patchMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  patchMock: vi.fn(),
}));
vi.mock('../api/client', () => ({ api: { get: getMock, post: postMock, patch: patchMock } }));

vi.mock('../components/RichTextEditor', () => ({
  RichTextEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="Description" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const me = {
  id: 'u1', email: 'broker@example.com', role: 'broker', officeId: null, status: 'active',
  displayName: 'Broker', phone: '', photoUrl: '', bio: '', emailPrefs: {}, lastLoginAt: null, createdAt: '',
};

const settings = {
  brandName: 'Acme Realty',
  logoUrl: '',
  primaryColor: '#1d4ed8',
  officeLocations: [{ _id: 'o1', name: 'HQ', address: '', timezone: 'America/Chicago' }],
  rssFeeds: [],
  welcomeMessage: '',
  quickLinks: [],
  homepageLayout: [],
  reservableResources: [{ _id: 'r1', name: 'Conference Room' }],
};

function wrap(path = '/calendar/new', routePath = '/calendar/new') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={routePath} element={<EventEditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('EventEditorPage', () => {
  it('anchors all-day submissions to local midnight bounds', async () => {
    getMock.mockImplementation(async (url: string) => {
      if (url === '/auth/me') return { data: { user: me } };
      if (url === '/settings') return { data: { settings } };
      throw new Error(`Unhandled GET ${url}`);
    });
    postMock.mockResolvedValue({
      data: {
        event: {
          id: 'enew', title: 'New event', descriptionHtml: '', kind: 'personal', createdBy: 'u1', officeId: null,
          startAt: new Date().toISOString(), endAt: new Date().toISOString(), allDay: true, location: '',
          recurrence: 'none', recurrenceUntil: null, rsvpEnabled: false, mandatory: false, resourceId: null,
          myRsvp: null, createdAt: new Date().toISOString(),
        },
      },
    });

    render(wrap());

    await userEvent.type(await screen.findByLabelText('Title'), 'Company picnic');
    fireEvent.change(screen.getByLabelText('Starts'), { target: { value: '2026-08-10T09:00' } });
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-08-10T17:00' } });
    await userEvent.click(screen.getByRole('checkbox', { name: /all day/i }));
    await userEvent.click(screen.getByRole('button', { name: /create event/i }));

    expect(postMock).toHaveBeenCalledTimes(1);
    const [url, body] = postMock.mock.calls[0] as [string, { startAt: string; endAt: string }];
    expect(url).toBe('/events');
    expect(new Date(body.startAt).getHours()).toBe(0);
    expect(new Date(body.endAt).getTime()).toBeGreaterThan(new Date(body.startAt).getTime());
  });

  it('round-trips an all-day event without drifting its bounds', async () => {
    // Stored bounds: local midnight Jul 1 → local midnight Jul 2 (exclusive), i.e. one day.
    const startIso = new Date(2026, 6, 1).toISOString();
    const endIso = new Date(2026, 6, 2).toISOString();
    getMock.mockImplementation(async (url: string) => {
      if (url === '/auth/me') return { data: { user: me } };
      if (url === '/settings') return { data: { settings } };
      if (url === '/events/e1')
        return {
          data: {
            event: {
              id: 'e1', title: 'Office holiday', descriptionHtml: '', kind: 'personal', createdBy: 'u1',
              officeId: null, startAt: startIso, endAt: endIso, allDay: true, location: '',
              recurrence: 'none', recurrenceUntil: null, rsvpEnabled: false, mandatory: false,
              resourceId: null, myRsvp: null, createdAt: startIso,
            },
          },
        };
      throw new Error(`Unhandled GET ${url}`);
    });
    patchMock.mockResolvedValue({
      data: {
        event: {
          id: 'e1', title: 'Office holiday', descriptionHtml: '', kind: 'personal', createdBy: 'u1',
          officeId: null, startAt: startIso, endAt: endIso, allDay: true, location: '',
          recurrence: 'none', recurrenceUntil: null, rsvpEnabled: false, mandatory: false,
          resourceId: null, myRsvp: null, createdAt: startIso,
        },
      },
    });

    render(wrap('/calendar/e1/edit', '/calendar/:id/edit'));

    // The exclusive stored endAt (Jul 2) seeds back as the INCLUSIVE end date (Jul 1).
    expect(await screen.findByDisplayValue('Office holiday')).toBeInTheDocument();
    expect(screen.getByLabelText('Ends')).toHaveValue('2026-07-01');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));

    expect(patchMock).toHaveBeenCalledTimes(1);
    const [url, body] = patchMock.mock.calls[0] as [string, { startAt: string; endAt: string }];
    expect(url).toBe('/events/e1');
    // Saving unchanged reproduces the original bounds exactly — no one-day drift per edit.
    expect(body.startAt).toBe(startIso);
    expect(body.endAt).toBe(endIso);
  });
});
