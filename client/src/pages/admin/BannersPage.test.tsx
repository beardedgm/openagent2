import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { BannerInfo } from '../../api/types';
import { BannersPage } from './BannersPage';

const { getMock, postMock, deleteMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(async (url: string) => ({ data: url.includes('duplicate') ? { banner: { id: 'copy' } } : { banner: { id: 'new1' } } })),
  deleteMock: vi.fn(async () => ({ data: {} })),
}));
vi.mock('../../api/client', () => ({ api: { get: getMock, post: postMock, delete: deleteMock, patch: vi.fn(async () => ({ data: {} })) } }));
// The rich text editor drags in TipTap; the form only needs its value contract.
vi.mock('../../components/RichTextEditor', () => ({
  RichTextEditor: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea aria-label="Banner body" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const DAY = 24 * 60 * 60 * 1000;
function banner(overrides: Partial<BannerInfo>): BannerInfo {
  return {
    id: 'b1', kind: 'text', title: 'Promo', imageUrl: '', bodyHtml: '<p>x</p>', ctaLabel: '', ctaUrl: '',
    officeId: null, startAt: new Date(Date.now() - DAY).toISOString(), endAt: new Date(Date.now() + DAY).toISOString(),
    clickCount: 7, createdAt: new Date().toISOString(), ...overrides,
  };
}

function mockApi(banners: BannerInfo[]) {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { data: { user: { id: 'me', role: 'broker', displayName: 'Me', officeId: null, emailPrefs: {} } } };
    if (url === '/banners') return { data: { banners } };
    if (url === '/settings') return { data: { settings: { brandName: 'B', officeLocations: [], rssFeeds: [], welcomeMessage: '', quickLinks: [], homepageLayout: [], reservableResources: [] } } };
    throw new Error(`unmocked ${url}`);
  });
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BannersPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('BannersPage', () => {
  it('lists banners with status and click counts; duplicate calls the endpoint', async () => {
    // b2 gets clickCount 0 so the '7' assertion below matches exactly one element.
    mockApi([banner({}), banner({ id: 'b2', title: 'Old', clickCount: 0, startAt: new Date(Date.now() - 3 * DAY).toISOString(), endAt: new Date(Date.now() - DAY).toISOString() })]);
    render(wrap());
    expect(await screen.findByText('Promo')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument(); // click count
    await userEvent.click(screen.getByRole('button', { name: /duplicate promo/i }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/banners/b1/duplicate'));
  });

  it('creates a text banner from the form', async () => {
    mockApi([]);
    render(wrap());
    await userEvent.click(await screen.findByRole('button', { name: /new banner/i }));
    await userEvent.type(screen.getByLabelText(/title/i), 'Summer push');
    await userEvent.type(screen.getByLabelText(/banner body/i), '<p>Go</p>');
    // fireEvent.change, not userEvent.type — typing into datetime-local inputs is unreliable in jsdom.
    fireEvent.change(screen.getByLabelText(/start/i), { target: { value: '2026-08-01T09:00' } });
    fireEvent.change(screen.getByLabelText(/end/i), { target: { value: '2026-08-15T17:00' } });
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/banners', expect.objectContaining({ kind: 'text', title: 'Summer push', bodyHtml: '<p>Go</p>' })),
    );
  });

  it('deletes after confirmation', async () => {
    mockApi([banner({})]);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(wrap());
    await userEvent.click(await screen.findByRole('button', { name: /delete promo/i }));
    await waitFor(() => expect(deleteMock).toHaveBeenCalledWith('/banners/b1'));
  });
});
