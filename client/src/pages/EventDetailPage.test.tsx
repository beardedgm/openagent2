import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { EventDetailPage } from './EventDetailPage';

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn(async () => ({ data: {} })) }));
vi.mock('../api/client', () => ({ api: { get: getMock, post: postMock, delete: vi.fn(), patch: vi.fn() } }));

function mockApi({ role = 'agent', createdBy = 'other', rsvpSummary = undefined as unknown }) {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { data: { user: { id: 'me', role, displayName: 'Me', officeId: null } } };
    if (url === '/events/e1')
      return {
        data: {
          event: {
            id: 'e1', title: 'Compliance training', descriptionHtml: '<p>Bring your <strong>license</strong></p>',
            kind: 'office', createdBy, officeId: null,
            startAt: '2026-08-06T15:00:00.000Z', endAt: '2026-08-06T16:00:00.000Z',
            allDay: false, location: 'HQ', recurrence: 'weekly', recurrenceUntil: null,
            rsvpEnabled: true, mandatory: true, resourceId: null, myRsvp: null, createdAt: '2026-08-01T00:00:00.000Z',
          },
          ...(rsvpSummary ? { rsvpSummary } : {}),
        },
      };
    throw new Error(`Unhandled GET ${url}`);
  });
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/calendar/e1']}>
        <Routes>
          <Route path="/calendar/:id" element={<EventDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('EventDetailPage', () => {
  it('renders detail with mandatory badge, rich description, and RSVP buttons; sends RSVP', async () => {
    mockApi({});
    render(wrap());
    expect(await screen.findByText('Compliance training')).toBeInTheDocument();
    expect(screen.getByText('Mandatory')).toBeInTheDocument();
    expect(screen.getByText('license')).toBeInTheDocument(); // rich html rendered
    expect(screen.getByText('HQ')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^yes$/i }));
    expect(postMock).toHaveBeenCalledWith('/events/e1/rsvp', { response: 'yes' });
    expect(screen.queryByText(/responses/i)).not.toBeInTheDocument(); // summary hidden for non-creator
    expect(screen.queryByRole('link', { name: /edit/i })).not.toBeInTheDocument();
  });

  it('creator sees the RSVP summary and manage actions', async () => {
    mockApi({ createdBy: 'me', rsvpSummary: { yes: ['Ana'], no: [], maybe: ['Bob'] } });
    render(wrap());
    await screen.findByText('Compliance training');
    expect(screen.getByText(/responses/i)).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /edit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
  });
});
