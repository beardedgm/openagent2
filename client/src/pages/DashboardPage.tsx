import { useMe, useSettings } from '../api/hooks';
import { Card } from '../components/ui/Card';

export function DashboardPage() {
  const { data: me } = useMe();
  const { data: settings } = useSettings();

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

      <Card>
        <p style={{ color: 'var(--color-text-muted)', margin: 0 }}>
          Announcements, tasks, and events will appear here as they&apos;re added.
        </p>
      </Card>
    </div>
  );
}
