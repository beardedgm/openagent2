import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CategoriesPage } from './CategoriesPage';

const { getMock, postMock, deleteMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(async () => ({ data: { category: { id: 'new', name: 'X', parentId: null } } })),
  deleteMock: vi.fn(),
}));
vi.mock('../../api/client', () => ({ api: { get: getMock, post: postMock, delete: deleteMock, patch: vi.fn(async () => ({ data: {} })) } }));

function mockApi() {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { data: { user: { id: 'me', role: 'broker', displayName: 'Me', officeId: null, emailPrefs: {} } } };
    if (url === '/categories')
      return {
        data: {
          categories: [
            { id: 'c1', name: 'Marketing', parentId: null },
            { id: 'c2', name: 'Social', parentId: 'c1' },
          ],
        },
      };
    throw new Error(`unmocked ${url}`);
  });
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CategoriesPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('CategoriesPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the tree and adds a top-level category', async () => {
    mockApi();
    render(wrap());
    expect(await screen.findByText('Marketing')).toBeInTheDocument();
    expect(screen.getByText('Social')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/new category/i), 'Compliance');
    await userEvent.click(screen.getByRole('button', { name: /add category/i }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/categories', { name: 'Compliance', parentId: null }));
  });

  it('adds a subcategory under its parent', async () => {
    mockApi();
    render(wrap());
    await userEvent.type(await screen.findByLabelText(/add subcategory to marketing/i), 'Email');
    // The button's name deliberately differs from the input's ("under" vs "to") so the
    // two accessible names never collide in getByLabelText.
    await userEvent.click(screen.getByRole('button', { name: /add subcategory under marketing/i }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/categories', { name: 'Email', parentId: 'c1' }));
  });

  it('surfaces the server guard message when deletion is refused', async () => {
    mockApi();
    deleteMock.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { error: 'Move or delete the resources in this category first' } },
    });
    // Approved post-plan amendment: delete now asks for confirmation first (matching the
    // UsersPage deactivate and ResourceDetailPage delete flows), so accept the dialog here.
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(wrap());
    await userEvent.click(await screen.findByRole('button', { name: /delete social/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/resources in this category/i);
  });
});
