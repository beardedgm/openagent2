import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ResourceInfo } from '../api/types';
import { ResourceDetailPage } from './ResourceDetailPage';

const { getMock, postMock, deleteMock } = vi.hoisted(() => ({
  getMock: vi.fn(),
  postMock: vi.fn(async () => ({ data: {} })),
  deleteMock: vi.fn(async () => ({ data: {} })),
}));
vi.mock('../api/client', () => ({ api: { get: getMock, post: postMock, delete: deleteMock } }));

const base: ResourceInfo = {
  id: 'r1', title: 'W-9', description: 'Tax form', kind: 'file', externalUrl: '', fileType: 'pdf',
  categoryId: 'c1', subcategoryId: null, uploadedBy: 'u1', officeId: null, featured: false,
  currentFile: { name: 'w9-2026.pdf', size: 120, contentType: 'application/pdf' }, bookmarked: false,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};

function mockApi(role: string, resource: ResourceInfo) {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { data: { user: { id: 'me', role, displayName: 'Me', officeId: null, emailPrefs: {} } } };
    if (url === '/categories') return { data: { categories: [{ id: 'c1', name: 'Forms', parentId: null }] } };
    if (url === '/resources/r1') return { data: { resource } };
    throw new Error(`unmocked ${url}`);
  });
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/resources/r1']}>
        <Routes>
          <Route path="/resources/:id" element={<ResourceDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('ResourceDetailPage', () => {
  it('agents: download + bookmark, no version history or admin controls', async () => {
    mockApi('agent', base);
    render(wrap());
    expect(await screen.findByRole('heading', { name: 'W-9' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /download w-9/i })).toHaveAttribute('href', '/api/v1/resources/r1/download');
    expect(screen.queryByText(/version history/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /bookmark w-9/i }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/resources/r1/bookmark'));
  });

  it('admins: version history with per-version download links + replace-file control', async () => {
    mockApi('officeAdmin', {
      ...base,
      versions: [
        { name: 'w9-2025.pdf', size: 100, contentType: 'application/pdf', uploadedBy: 'u1', uploadedAt: new Date().toISOString() },
        { name: 'w9-2026.pdf', size: 120, contentType: 'application/pdf', uploadedBy: 'u1', uploadedAt: new Date().toISOString() },
      ],
    });
    render(wrap());
    expect(await screen.findByText(/version history/i)).toBeInTheDocument();
    const v1 = screen.getByRole('link', { name: /download version 1/i });
    expect(v1).toHaveAttribute('href', '/api/v1/resources/r1/download?version=1');
    expect(screen.getByLabelText(/replace file/i)).toBeInTheDocument();
  });

  it('broker sees the feature toggle; officeAdmin does not', async () => {
    mockApi('broker', base);
    render(wrap());
    await userEvent.click(await screen.findByRole('button', { name: /feature this resource/i }));
    await waitFor(() => expect(postMock).toHaveBeenCalledWith('/resources/r1/featured'));
  });
});
