import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { BannerInfo } from '../api/types';
import { BannerSlot } from './BannerSlot';

const { getMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(async () => ({ data: {} })),
}));
vi.mock('../api/client', () => ({ api: { get: getMock, post: postMock } }));

function banner(i: number, overrides: Partial<BannerInfo> = {}): BannerInfo {
  return {
    id: `b${i}`, kind: 'text', title: `Banner ${i}`, imageUrl: '', bodyHtml: `<p>Body ${i}</p>`,
    ctaLabel: 'Open', ctaUrl: 'https://x.example.com', officeId: null,
    startAt: new Date().toISOString(), endAt: new Date().toISOString(), clickCount: 0,
    createdAt: new Date().toISOString(), ...overrides,
  };
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <BannerSlot />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('BannerSlot', () => {
  it('collapses to nothing when no banners are active', async () => {
    getMock.mockResolvedValue({ data: { banners: [] } });
    const { container } = render(wrap());
    await act(async () => {}); // let the query settle
    expect(container).toBeEmptyDOMElement();
  });

  it('shows up to 3 banners statically (no timer churn)', async () => {
    getMock.mockResolvedValue({ data: { banners: [banner(1), banner(2)] } });
    render(wrap());
    expect(await screen.findByText('Banner 1')).toBeInTheDocument();
    expect(screen.getByText('Banner 2')).toBeInTheDocument();
  });

  it('rotates the visible window every 5s when more than 3 are active', async () => {
    vi.useFakeTimers();
    getMock.mockResolvedValue({ data: { banners: [banner(1), banner(2), banner(3), banner(4)] } });
    render(wrap());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText('Banner 1')).toBeInTheDocument();
    expect(screen.queryByText('Banner 4')).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.queryByText('Banner 1')).not.toBeInTheDocument();
    expect(screen.getByText('Banner 4')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('clicking logs the bannerClick and opens the CTA in a new tab', async () => {
    getMock.mockResolvedValue({ data: { banners: [banner(1)] } });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(wrap());
    await userEvent.click(await screen.findByRole('button', { name: /banner 1/i }));
    expect(postMock).toHaveBeenCalledWith('/banners/b1/click');
    expect(open).toHaveBeenCalledWith('https://x.example.com', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });
});
