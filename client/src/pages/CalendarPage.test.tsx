import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CalendarPage } from './CalendarPage';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('../api/client', () => ({ api: { get: getMock } }));

function mockApi(occurrences: unknown[]) {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { data: { user: { id: 'me', role: 'agent', displayName: 'Me', officeId: null } } };
    if (url.startsWith('/events')) return { data: { occurrences } };
    throw new Error(`Unhandled GET ${url}`);
  });
}

function occ(title: string, startAt: Date, mandatory = false, endAt = new Date(startAt.getTime() + 3_600_000)) {
  return {
    event: {
      id: `e-${title}`, title, descriptionHtml: '', kind: 'office', createdBy: 'x', officeId: null,
      startAt: startAt.toISOString(), endAt: endAt.toISOString(),
      allDay: false, location: '', recurrence: 'none', recurrenceUntil: null,
      rsvpEnabled: false, mandatory, resourceId: null, myRsvp: null, createdAt: startAt.toISOString(),
    },
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
  };
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/calendar']}>
        <CalendarPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CalendarPage', () => {
  it('renders the month grid with events on their local days and a mandatory marker', async () => {
    const today = new Date();
    const at10 = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 0);
    mockApi([occ('Team meeting', at10), occ('All hands', at10, true)]);
    render(wrap());
    expect(await screen.findByText('Team meeting')).toBeInTheDocument();
    expect(screen.getByText(/All hands/)).toBeInTheDocument();
    expect(screen.getByLabelText(/mandatory/i)).toBeInTheDocument();
    // Exact names: /day/i would also match the "Today" button.
    for (const name of ['Month', 'Week', 'Day']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: /new event/i })).toBeInTheDocument();
  });

  it('renders a multi-day event in every month cell it spans', async () => {
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 0);
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2, 11, 0);
    mockApi([occ('Conference', start, false, end)]);
    render(wrap());
    expect(await screen.findAllByText('Conference')).toHaveLength(3);
  });

  it('switches to week view as a chronological list', async () => {
    const today = new Date();
    // Named to avoid colliding with the "Week" view-switch button: an occurrence titled
    // "Weekly item" would itself render as a button whose accessible name contains "week",
    // making getByRole('button', { name: /week/i }) match two elements.
    mockApi([occ('Recurring sync', new Date(today.getFullYear(), today.getMonth(), today.getDate(), 14, 0))]);
    render(wrap());
    await screen.findByText('Recurring sync');
    await userEvent.click(screen.getByRole('button', { name: /week/i }));
    expect(await screen.findByText('Recurring sync')).toBeInTheDocument();
  });
});
