import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ResourceInfo } from '../api/types';
import { ResourceHubPage } from './ResourceHubPage';

const { getMock, postMock, deleteMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(async () => ({ data: {} })),
  deleteMock: vi.fn(async () => ({ data: {} })),
}));
vi.mock('../api/client', () => ({ api: { get: getMock, post: postMock, delete: deleteMock } }));

function resource(overrides: Partial<ResourceInfo>): ResourceInfo {
  return {
    id: 'r1',
    title: 'Guide',
    description: '',
    kind: 'file',
    externalUrl: '',
    fileType: 'pdf',
    categoryId: 'c1',
    subcategoryId: null,
    uploadedBy: 'u1',
    officeId: null,
    featured: false,
    currentFile: { name: 'guide.pdf', size: 100, contentType: 'application/pdf' },
    bookmarked: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function mockApi({ featured = [] as ResourceInfo[], resources = [] as ResourceInfo[] } = {}) {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { data: { user: { id: 'me', role: 'agent', displayName: 'Me', officeId: null, emailPrefs: {} } } };
    if (url === '/categories') return { data: { categories: [{ id: 'c1', name: 'Marketing', parentId: null }] } };
    if (url === '/resources/featured') return { data: { resources: featured } };
    if (url.startsWith('/resources?')) return { data: { resources, total: resources.length, page: 1 } };
    throw new Error(`unmocked ${url}`);
  });
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/resources']}>
        <ResourceHubPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ResourceHubPage', () => {
  it('renders featured tiles, list rows with download links, and link resources that open externally', async () => {
    mockApi({
      featured: [resource({ id: 'f1', title: 'Star pick', featured: true })],
      resources: [
        resource({ id: 'r1', title: 'Brand PDF' }),
        resource({ id: 'r2', title: 'Portal', kind: 'link', fileType: 'link', externalUrl: 'https://p.example.com', currentFile: null }),
      ],
    });
    render(wrap());
    expect(await screen.findByText('Star pick')).toBeInTheDocument();
    const download = await screen.findByRole('link', { name: /download brand pdf/i });
    expect(download).toHaveAttribute('href', '/api/v1/resources/r1/download');
    const open = screen.getByRole('link', { name: /open portal/i });
    expect(open).toHaveAttribute('href', 'https://p.example.com');
    expect(open).toHaveAttribute('target', '_blank');
  });

  it('toggles a bookmark and switches to My Resources', async () => {
    mockApi({ resources: [resource({ id: 'r1', title: 'Guide' })] });
    render(wrap());
    await userEvent.click(await screen.findByRole('button', { name: /bookmark guide/i }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/resources/r1/bookmark'));
    await userEvent.click(screen.getByRole('button', { name: /my resources/i }));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith(expect.stringContaining('scope=mine')));
  });

  it('search and filters hit the API with the right params; hides the New button from agents', async () => {
    mockApi({ resources: [] });
    render(wrap());
    await screen.findByText(/no resources/i);
    expect(screen.queryByRole('link', { name: /new resource/i })).not.toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: /search resources/i }), 'contract');
    await waitFor(() => expect(getMock).toHaveBeenCalledWith(expect.stringContaining('q=contract')));
    await userEvent.selectOptions(screen.getByLabelText(/category/i), 'c1');
    await waitFor(() => expect(getMock).toHaveBeenCalledWith(expect.stringContaining('categoryId=c1')));
  });
});
