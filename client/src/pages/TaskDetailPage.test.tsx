import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { TaskDetailPage } from './TaskDetailPage';

const { getMock, postMock } = vi.hoisted(() => ({ getMock: vi.fn(), postMock: vi.fn(async () => ({ data: {} })) }));
vi.mock('../api/client', () => ({ api: { get: getMock, post: postMock, delete: vi.fn() } }));

function mockApi({
  role = 'agent',
  completedAt = null as string | null,
  matrix = undefined as unknown,
  relatedResourceId = null as string | null,
}) {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { data: { user: { id: 'me', role, displayName: 'Me', officeId: null } } };
    if (url === '/tasks/t1')
      return {
        data: {
          task: {
            id: 't1', title: 'File the form', descriptionHtml: '<p>Use <strong>blue ink</strong></p>',
            createdBy: 'b', priority: 'High', dueAt: null,
            attachments: [{ name: 'guide.pdf', size: 100, contentType: 'application/pdf' }],
            recurrence: 'none', isOnboarding: false,
            myCompletion: { completedAt, note: '' }, counts: { total: 2, completed: 0 },
            relatedResourceId,
            createdAt: new Date().toISOString(),
          },
          ...(matrix ? { matrix } : {}),
        },
      };
    if (url === '/resources/r9')
      return {
        data: {
          resource: {
            id: 'r9', title: 'Buyer checklist', description: '', kind: 'link', externalUrl: 'https://x.example.com',
            fileType: 'link', categoryId: 'c1', subcategoryId: null, uploadedBy: 'u1', officeId: null,
            featured: false, currentFile: null, bookmarked: false,
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
          },
        },
      };
    throw new Error(`Unhandled GET ${url}`);
  });
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/tasks/t1']}>
        <Routes>
          <Route path="/tasks/:id" element={<TaskDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('TaskDetailPage', () => {
  it('renders description, attachment download link, and completes with a note', async () => {
    mockApi({});
    render(wrap());
    expect(await screen.findByText('File the form')).toBeInTheDocument();
    expect(screen.getByText('blue ink')).toBeInTheDocument();
    const dl = screen.getByRole('link', { name: /guide\.pdf/i });
    expect(dl).toHaveAttribute('href', '/api/v1/tasks/t1/attachments/0/download');
    await userEvent.type(screen.getByLabelText(/completion note/i), 'done and filed');
    await userEvent.click(screen.getByRole('button', { name: /mark complete/i }));
    expect(postMock).toHaveBeenCalledWith('/tasks/t1/complete', { note: 'done and filed' });
  });

  it('completed tasks show state instead of the form; admins see the matrix', async () => {
    mockApi({
      role: 'broker',
      completedAt: new Date().toISOString(),
      matrix: [
        { userId: 'u1', displayName: 'Ana', completedAt: new Date().toISOString(), note: 'ok' },
        { userId: 'u2', displayName: 'Bob', completedAt: null, note: '' },
      ],
    });
    render(wrap());
    await screen.findByText('File the form');
    expect(screen.queryByRole('button', { name: /mark complete/i })).not.toBeInTheDocument();
    expect(screen.getByText(/you completed this task/i)).toBeInTheDocument();
    expect(screen.getByText('Ana')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('lets an admin (matrix present) upload an attachment, and hides the control for an agent', async () => {
    mockApi({
      role: 'broker',
      matrix: [{ userId: 'u1', displayName: 'Ana', completedAt: null, note: '' }],
    });
    const { container, unmount } = render(wrap());
    await screen.findByText('File the form');

    const addButton = screen.getByRole('button', { name: /add attachment/i });
    expect(addButton).toBeInTheDocument();

    const input = container.querySelector('input[type=file]') as HTMLInputElement;
    const file = new File(['contents'], 'notes.pdf', { type: 'application/pdf' });
    fireEvent.change(input, { target: { files: [file] } });

    await Promise.resolve();
    expect(postMock).toHaveBeenCalledWith('/tasks/t1/attachments', expect.any(FormData));
    unmount();

    mockApi({ role: 'agent' });
    render(wrap());
    await screen.findByText('File the form');
    expect(screen.queryByRole('button', { name: /add attachment/i })).not.toBeInTheDocument();
  });

  it('links to the related resource when the task has one', async () => {
    mockApi({ relatedResourceId: 'r9' });
    render(wrap());
    const link = await screen.findByRole('link', { name: /buyer checklist/i });
    expect(link).toHaveAttribute('href', '/resources/r9');
  });
});
