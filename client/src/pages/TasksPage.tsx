import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMe, useTasks } from '../api/hooks';
import type { TaskInfo } from '../api/types';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';

const PRIORITY_TONE = { High: 'danger', Medium: 'accent', Low: 'neutral' } as const;

export function isOverdue(t: TaskInfo): boolean {
  return !!t.dueAt && new Date(t.dueAt) < new Date() && !t.myCompletion?.completedAt;
}

export function TasksPage() {
  const { data: me } = useMe();
  const isAdmin = me?.role === 'broker' || me?.role === 'officeAdmin';
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const { data: tasks, isLoading } = useTasks(scope);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', maxWidth: 720 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <h1 style={{ fontSize: 22, flex: 1 }}>Tasks</h1>
        {isAdmin && (
          <>
            <Button variant={scope === 'mine' ? 'primary' : 'secondary'} aria-pressed={scope === 'mine'} onClick={() => setScope('mine')}>
              My tasks
            </Button>
            <Button variant={scope === 'all' ? 'primary' : 'secondary'} aria-pressed={scope === 'all'} onClick={() => setScope('all')}>
              All tasks
            </Button>
            <Link
              to="/tasks/new"
              style={{ display: 'inline-flex', alignItems: 'center', minHeight: 44, padding: '0 var(--space-4)', borderRadius: 'var(--radius-sm)', background: 'var(--color-accent)', color: '#fff', fontWeight: 600, textDecoration: 'none' }}
            >
              New task
            </Link>
          </>
        )}
      </div>

      {isLoading && <Spinner label="Loading tasks" />}
      {tasks?.length === 0 && (
        <Card>
          <p style={{ color: 'var(--color-text-muted)' }}>No tasks here.</p>
        </Card>
      )}
      {tasks?.map((t) => (
        <Card key={t.id} style={{ padding: 'var(--space-4)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <Link to={`/tasks/${t.id}`} style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>
              {t.title}
            </Link>
            <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge>
            {t.isOnboarding && <Badge tone="accent">Onboarding</Badge>}
            {isOverdue(t) && <Badge tone="danger">Overdue</Badge>}
            {t.myCompletion?.completedAt && <Badge tone="success">Completed</Badge>}
          </div>
          <div style={{ marginTop: 'var(--space-1)', fontSize: 13, color: 'var(--color-text-muted)' }}>
            {t.dueAt ? `Due ${new Date(t.dueAt).toLocaleString()}` : 'No due date'}
            {scope === 'all' && ` · ${t.counts.completed}/${t.counts.total} done`}
          </div>
        </Card>
      ))}
    </div>
  );
}
