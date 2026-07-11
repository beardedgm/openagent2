import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { EventEditorPage } from './EventEditorPage';

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn() }));
vi.mock('../api/client', () => ({ api: { get: getMock, post: postMock, patch: vi.fn() } }));

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

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/calendar/new']}>
        <Routes>
          <Route path="/calendar/new" element={<EventEditorPage />} />
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
});
