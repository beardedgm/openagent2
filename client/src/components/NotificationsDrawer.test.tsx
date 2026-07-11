import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { NotificationsDrawer } from './NotificationsDrawer';

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn(async () => ({})) }));
vi.mock('../api/client', () => ({ api: { get: getMock, post: postMock } }));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('NotificationsDrawer', () => {
  it('lists notifications and marks one read on click', async () => {
    getMock.mockResolvedValue({
      data: {
        notifications: [
          { id: 'n1', type: 'postPublished', title: 'New announcement: Hi', link: '/board/p1', readAt: null, createdAt: new Date().toISOString() },
          { id: 'n2', type: 'invitationAccepted', title: 'Ana accepted', link: '/profile/u1', readAt: new Date().toISOString(), createdAt: new Date().toISOString() },
        ],
        unreadCount: 1,
        nextCursor: null,
      },
    });
    const onClose = vi.fn();
    render(wrap(<NotificationsDrawer open onClose={onClose} />));
    await userEvent.click(await screen.findByText('New announcement: Hi'));
    expect(postMock).toHaveBeenCalledWith('/notifications/n1/read');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    getMock.mockResolvedValue({ data: { notifications: [], unreadCount: 0, nextCursor: null } });
    const onClose = vi.fn();
    render(wrap(<NotificationsDrawer open onClose={onClose} />));
    await screen.findByText(/all caught up/i);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('shows an empty state and a mark-all action', async () => {
    getMock.mockResolvedValue({ data: { notifications: [], unreadCount: 0, nextCursor: null } });
    render(wrap(<NotificationsDrawer open onClose={() => {}} />));
    expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /mark all read/i }));
    expect(postMock).toHaveBeenCalledWith('/notifications/read-all');
  });
});
