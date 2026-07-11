import { Link } from 'react-router-dom';
import { useMe, useMyOnboarding, useSettings, useTasks } from '../api/hooks';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { isOverdue } from './TasksPage';

export function DashboardPage() {
  const { data: me } = useMe();
  const { data: settings } = useSettings();
  const { data: onboarding } = useMyOnboarding();
  const { data: tasks } = useTasks('mine');
  // The server sorts dueAt ascending with nulls first (Mongo default), which would crowd
  // no-due-date tasks ahead of due-soon ones here. Re-sort client-side with nulls last.
  const openTasks = (tasks ?? [])
    .filter((t) => !t.myCompletion?.completedAt)
    .sort((a, b) => (a.dueAt ? new Date(a.dueAt).getTime() : Infinity) - (b.dueAt ? new Date(b.dueAt).getTime() : Infinity))
    .slice(0, 5);
  const showOnboarding = onboarding && onboarding.total > 0 && onboarding.completed < onboarding.total;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <h1 style={{ fontSize: 24 }}>Welcome back, {me?.displayName}</h1>

      {settings?.welcomeMessage && (
        <Card>
          <h2 style={{ fontSize: 18 }}>{settings.brandName}</h2>
          {settings.welcomeMessage.split('\n').map((line, i) => (
            <p key={i}>{line}</p>
          ))}
        </Card>
      )}

      {showOnboarding && (
        <Card>
          <h2 style={{ fontSize: 18 }}>Onboarding progress</h2>
          <p style={{ fontSize: 14, color: 'var(--color-text-muted)' }}>
            {onboarding.completed} of {onboarding.total} tasks done
          </p>
          <div
            role="progressbar"
            aria-valuenow={Math.round((onboarding.completed / onboarding.total) * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            style={{ height: 10, borderRadius: 999, background: 'color-mix(in srgb, var(--color-border) 60%, transparent)', overflow: 'hidden', marginTop: 'var(--space-2)' }}
          >
            <div style={{ width: `${(onboarding.completed / onboarding.total) * 100}%`, height: '100%', background: 'var(--color-accent)' }} />
          </div>
        </Card>
      )}

      <Card>
        <div style={{ display: 'flex', alignItems: 'baseline' }}>
          <h2 style={{ fontSize: 18, flex: 1 }}>My tasks</h2>
          <Link to="/tasks" style={{ fontSize: 14 }}>All tasks</Link>
        </div>
        {openTasks.length === 0 && <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>Nothing open — nice.</p>}
        {openTasks.map((t) => (
          <div key={t.id} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', minHeight: 44, borderBottom: '1px solid var(--color-border)' }}>
            <Link to={`/tasks/${t.id}`} style={{ flex: 1, color: 'var(--color-text)', fontSize: 14 }}>{t.title}</Link>
            {isOverdue(t) && <Badge tone="danger">Overdue</Badge>}
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              {t.dueAt ? new Date(t.dueAt).toLocaleDateString() : ''}
            </span>
          </div>
        ))}
      </Card>
    </div>
  );
}
