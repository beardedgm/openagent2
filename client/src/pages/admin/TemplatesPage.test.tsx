import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TemplatesPage } from './TemplatesPage';

const { getMock, postMock, patchMock, deleteMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(),
  patchMock: vi.fn(),
  deleteMock: vi.fn(),
}));
vi.mock('../../api/client', () => ({
  api: { get: getMock, post: postMock, patch: patchMock, delete: deleteMock },
}));

const existingTemplate = {
  id: 't1',
  name: 'New Agent Onboarding',
  items: [
    { title: 'Sign paperwork', descriptionHtml: '', priority: 'High', dueInDays: 1 },
    { title: 'Shadow a showing', descriptionHtml: '', priority: 'Medium', dueInDays: 7 },
  ],
  createdAt: new Date().toISOString(),
};

function mockApi() {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/task-templates') return { data: { templates: [existingTemplate] } };
    throw new Error(`Unhandled GET ${url}`);
  });
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/admin/templates']}>
        <TemplatesPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('TemplatesPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists an existing template with its item count and deletes it after confirmation', async () => {
    mockApi();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    deleteMock.mockResolvedValue({ data: { ok: true } });
    render(wrap());

    expect(await screen.findByText('New Agent Onboarding')).toBeInTheDocument();
    expect(screen.getByText(/2 items/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /delete/i }));

    expect(deleteMock).toHaveBeenCalledWith('/task-templates/t1');
  });

  it('creates a new template from the form', async () => {
    mockApi();
    postMock.mockResolvedValue({ data: { template: { id: 't2', name: 'X', items: [] } } });

    render(wrap());
    await screen.findByText('New Agent Onboarding');

    await userEvent.type(screen.getByLabelText(/^name$/i), 'Listing Checklist');
    await userEvent.click(screen.getByRole('button', { name: /add item/i }));
    await userEvent.type(screen.getByLabelText(/item 1 title/i), 'Order sign');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(postMock).toHaveBeenCalledWith(
      '/task-templates',
      expect.objectContaining({
        name: 'Listing Checklist',
        items: [expect.objectContaining({ title: 'Order sign' })],
      }),
    );
  });
});
