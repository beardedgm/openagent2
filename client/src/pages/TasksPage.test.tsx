import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { TaskInfo } from '../api/types';
import { TasksPage } from './TasksPage';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));
vi.mock('../api/client', () => ({ api: { get: getMock } }));

function task(overrides: Partial<TaskInfo>): TaskInfo {
  return {
    id: 't1', title: 'T', descriptionHtml: '', createdBy: 'b', priority: 'Medium', dueAt: null,
    attachments: [], recurrence: 'none', isOnboarding: false,
    myCompletion: { completedAt: null, note: '' }, counts: { total: 1, completed: 0 },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function mockApi(role: string, tasks: TaskInfo[]) {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/auth/me') return { data: { user: { id: 'me', role, displayName: 'Me', officeId: null } } };
    if (url.startsWith('/tasks?')) return { data: { tasks } };
    throw new Error(`Unhandled GET ${url}`);
  });
}

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/tasks']}>
        <TasksPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('TasksPage', () => {
  it('shows my open tasks with priority and overdue badges; no admin controls for agents', async () => {
    mockApi('agent', [
      task({ id: 't1', title: 'Overdue thing', priority: 'High', dueAt: new Date(Date.now() - 86_400_000).toISOString() }),
      task({ id: 't2', title: 'Done thing', myCompletion: { completedAt: new Date().toISOString(), note: '' } }),
    ]);
    render(wrap());
    expect(await screen.findByText('Overdue thing')).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText('Done thing')).toBeInTheDocument();
    expect(screen.getByText(/completed/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /new task/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /all tasks/i })).not.toBeInTheDocument();
  });

  it('admins get the All tasks scope and New task action', async () => {
    mockApi('broker', [task({ id: 't3', title: 'Anything' })]);
    render(wrap());
    expect(await screen.findByText('Anything')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /new task/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /all tasks/i })).toBeInTheDocument();
  });

  it('all scope keys Overdue off aggregate completion, not the viewer', async () => {
    getMock.mockImplementation(async (url: string) => {
      if (url === '/auth/me') return { data: { user: { id: 'me', role: 'broker', displayName: 'Me', officeId: null } } };
      if (url === '/tasks?scope=mine') return { data: { tasks: [] } };
      if (url === '/tasks?scope=all')
        return {
          data: {
            tasks: [
              task({
                id: 't4',
                title: 'Everyone finished',
                dueAt: new Date(Date.now() - 86_400_000).toISOString(),
                myCompletion: null,
                counts: { total: 3, completed: 3 },
              }),
            ],
          },
        };
      throw new Error(`Unhandled GET ${url}`);
    });
    render(wrap());
    await userEvent.click(await screen.findByRole('button', { name: /all tasks/i }));
    expect(await screen.findByText('Everyone finished')).toBeInTheDocument();
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument();
    expect(screen.getByText(/3\/3 done/)).toBeInTheDocument();
  });
});
