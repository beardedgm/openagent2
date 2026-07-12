import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMe, useMyOnboarding, useSettings, useTasks } from '../api/hooks';
import { BannerSlot } from '../components/BannerSlot';
import { Badge } from '../components/ui/Badge';
import { Card } from '../components/ui/Card';
import { AnnouncementsWidget } from '../components/widgets/AnnouncementsWidget';
import { EventsWidget } from '../components/widgets/EventsWidget';
import { FeedPreviewWidget } from '../components/widgets/FeedPreviewWidget';
import { QuickLinksWidget } from '../components/widgets/QuickLinksWidget';
import { WelcomeWidget } from '../components/widgets/WelcomeWidget';
import { isOverdue } from './TasksPage';

// Extracted verbatim from the old always-on "My tasks" card so it can be gated by
// Settings.homepageLayout like the other homepage widgets.
function MyTasksCard() {
  const { data: tasks } = useTasks('mine');
  // The server sorts dueAt ascending with nulls first (Mongo default), which would crowd
  // no-due-date tasks ahead of due-soon ones here. Re-sort client-side with nulls last.
  const openTasks = (tasks ?? [])
    .filter((t) => !t.myCompletion?.completedAt)
    .sort((a, b) => (a.dueAt ? new Date(a.dueAt).getTime() : Infinity) - (b.dueAt ? new Date(b.dueAt).getTime() : Infinity))
    .slice(0, 5);

  return (
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
  );
}

// Keys mirror Settings.homepageLayout (server default in server/src/models/Settings.ts).
// Unknown keys are skipped defensively via the `?.()` + filter(Boolean) below.
const WIDGETS: Record<string, () => ReactNode> = {
  welcome: () => <WelcomeWidget key="welcome" />,
  banners: () => <BannerSlot key="banners" />,
  announcements: () => <AnnouncementsWidget key="announcements" />,
  myTasks: () => <MyTasksCard key="myTasks" />,
  events: () => <EventsWidget key="events" />,
  feed: () => <FeedPreviewWidget key="feed" />,
  quickLinks: () => <QuickLinksWidget key="quickLinks" />,
};

export function DashboardPage() {
  const { data: me } = useMe();
  const { data: settings } = useSettings();
  const { data: onboarding } = useMyOnboarding();
  const showOnboarding = onboarding && onboarding.total > 0 && onboarding.completed < onboarding.total;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <h1 style={{ fontSize: 24 }}>Welcome back, {me?.displayName}</h1>

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

      {/* Rendering nothing until settings resolve (rather than falling back to the server's
          default layout) avoids a flash of the default widget set before the admin's actual
          configuration loads. The greeting and onboarding card above stay immediate regardless. */}
      {(settings?.homepageLayout ?? []).map((k) => WIDGETS[k]?.()).filter(Boolean)}
    </div>
  );
}
