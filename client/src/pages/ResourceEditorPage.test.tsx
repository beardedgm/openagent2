import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ResourceEditorPage } from './ResourceEditorPage';

const { getMock, postMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(async () => ({ data: { resource: { id: 'new1' } } })),
}));
vi.mock('../api/client', () => ({ api: { get: getMock, post: postMock } }));

function mockApi() {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { data: { user: { id: 'me', role: 'broker', displayName: 'Me', officeId: null, emailPrefs: {} } } };
    if (url === '/categories')
      return {
        data: {
          categories: [
            { id: 'c1', name: 'Forms', parentId: null },
            { id: 'c2', name: 'Tax', parentId: 'c1' },
            { id: 'c3', name: 'Marketing', parentId: null },
            { id: 'c4', name: 'Social', parentId: 'c3' },
          ],
        },
      };
    if (url === '/settings') return { data: { settings: { brandName: 'B', officeLocations: [], rssFeeds: [], welcomeMessage: '', quickLinks: [], homepageLayout: [], reservableResources: [] } } };
    throw new Error(`unmocked ${url}`);
  });
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/resources/new']}>
        <Routes>
          <Route path="/resources/new" element={<ResourceEditorPage />} />
          <Route path="/resources/:id" element={<div>detail page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ResourceEditorPage', () => {
  it('subcategory options track the chosen category', async () => {
    mockApi();
    render(wrap());
    await userEvent.selectOptions(await screen.findByLabelText(/^category/i), 'c1');
    const sub = screen.getByLabelText(/subcategory/i);
    expect(sub).toContainHTML('Tax');
    expect(sub).not.toContainHTML('Social');
  });

  it('creates a link resource and navigates to its detail page', async () => {
    mockApi();
    render(wrap());
    await userEvent.type(await screen.findByLabelText(/title/i), 'Brand portal');
    await userEvent.selectOptions(screen.getByLabelText(/^category/i), 'c1');
    await userEvent.click(screen.getByLabelText(/external link/i));
    await userEvent.type(screen.getByLabelText(/url/i), 'https://brand.example.com');
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(postMock).toHaveBeenCalledWith('/resources', expect.objectContaining({ title: 'Brand portal', kind: 'link', externalUrl: 'https://brand.example.com', categoryId: 'c1' })),
    );
    expect(await screen.findByText('detail page')).toBeInTheDocument();
  });

  it('file kind: creates metadata then uploads the chosen file to /resources/:id/file', async () => {
    mockApi();
    render(wrap());
    await userEvent.type(await screen.findByLabelText(/title/i), 'Guide');
    await userEvent.selectOptions(screen.getByLabelText(/^category/i), 'c1');
    const file = new File(['x'], 'guide.pdf', { type: 'application/pdf' });
    await userEvent.upload(screen.getByLabelText(/file/i), file);
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/resources', expect.objectContaining({ kind: 'file' })));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/resources/new1/file', expect.any(FormData)));
  });
});
