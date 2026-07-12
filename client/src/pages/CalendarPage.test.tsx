import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CalendarPage } from './CalendarPage';

const dayLabel = (d: Date) => d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });

const { getMock, navigateMock } = vi.hoisted(() => ({ getMock: vi.fn(), navigateMock: vi.fn() }));
vi.mock('../api/client', () => ({ api: { get: getMock } }));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));

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
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it('exposes the month view as an accessible grid with column headers and 42 day gridcells', async () => {
    mockApi([]);
    render(wrap());
    await screen.findByText('Sun');
    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(7);
    expect(screen.getAllByRole('gridcell')).toHaveLength(42);
  });

  it('moves focus between day cells with ArrowRight and ArrowDown', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 5, 15)); // June 15, 2026 - mid-month, clear of grid edges
    const today = new Date();
    mockApi([occ('Standup', new Date(today.getFullYear(), today.getMonth(), today.getDate(), 9, 0))]);
    render(wrap());
    await screen.findByText('Standup');

    const todayCell = screen.getByRole('gridcell', { name: new RegExp(`^${dayLabel(today)}, `) });
    todayCell.focus();
    expect(document.activeElement).toBe(todayCell);

    fireEvent.keyDown(todayCell, { key: 'ArrowRight' });
    const nextDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
    const nextCell = screen.getByRole('gridcell', { name: new RegExp(`^${dayLabel(nextDay)}, `) });
    expect(document.activeElement).toBe(nextCell);

    fireEvent.keyDown(nextCell, { key: 'ArrowDown' });
    const weekLater = new Date(nextDay.getFullYear(), nextDay.getMonth(), nextDay.getDate() + 7);
    const weekLaterCell = screen.getByRole('gridcell', { name: new RegExp(`^${dayLabel(weekLater)}, `) });
    expect(document.activeElement).toBe(weekLaterCell);
  });

  it('keeps a single tabbable day cell, defaulting to today or the 1st of the displayed month', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 5, 15)); // June 15, 2026
    mockApi([]);
    render(wrap());
    await screen.findByText('Sun');

    const todayCell = screen.getByRole('gridcell', { name: new RegExp(`^${dayLabel(new Date(2026, 5, 15))}, `) });
    expect(todayCell).toHaveAttribute('tabindex', '0');
    for (const cell of screen.getAllByRole('gridcell')) {
      if (cell !== todayCell) expect(cell).toHaveAttribute('tabindex', '-1');
    }

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    const firstOfJuly = await screen.findByRole('gridcell', { name: new RegExp(`^${dayLabel(new Date(2026, 6, 1))}, `) });
    expect(firstOfJuly).toHaveAttribute('tabindex', '0');
  });

  it('lets a focused event chip handle Enter itself instead of hijacking it for the roving cell', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 5, 15)); // June 15, 2026: roving tabindex defaults to today
    navigateMock.mockClear();
    mockApi([occ('Alpha', new Date(2026, 5, 15, 9, 0)), occ('Beta', new Date(2026, 5, 16, 9, 0))]);
    render(wrap());
    await screen.findByText('Beta');

    // Enter on Beta's chip (June 16) must NOT activate the roving cell's (June 15) first chip.
    const betaChip = screen.getByRole('button', { name: 'Beta' });
    betaChip.focus();
    fireEvent.keyDown(betaChip, { key: 'Enter' });
    expect(navigateMock).not.toHaveBeenCalledWith('/calendar/e-Alpha');

    // The chip's own activation still navigates to its event.
    fireEvent.click(betaChip);
    expect(navigateMock).toHaveBeenCalledWith('/calendar/e-Beta');
  });

  it('still handles arrow keys from a day cell and prevents default on clamped edge moves', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 5, 15)); // June 15, 2026 (grid rows: May 31-Jun 6, Jun 7-13, Jun 14-20, ...)
    mockApi([]);
    render(wrap());
    await screen.findByText('Sun');

    const cellFor = (d: Date) => screen.getByRole('gridcell', { name: new RegExp(`^${dayLabel(d)}, `) });
    const start = cellFor(new Date(2026, 5, 15));
    start.focus();
    fireEvent.keyDown(start, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(cellFor(new Date(2026, 5, 16)));

    // Walk to the top row, then ArrowUp off the grid: focus stays put but the key is still
    // consumed (preventDefault) so the page does not scroll.
    fireEvent.keyDown(cellFor(new Date(2026, 5, 16)), { key: 'ArrowUp' });
    fireEvent.keyDown(cellFor(new Date(2026, 5, 9)), { key: 'ArrowUp' });
    const topRowCell = cellFor(new Date(2026, 5, 2));
    expect(document.activeElement).toBe(topRowCell);
    const notPrevented = fireEvent.keyDown(topRowCell, { key: 'ArrowUp' });
    expect(notPrevented).toBe(false); // false = defaultPrevented
    expect(document.activeElement).toBe(topRowCell);
  });
});
