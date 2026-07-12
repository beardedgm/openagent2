import { useSettings } from '../../api/hooks';
import { Card } from '../ui/Card';

export function WelcomeWidget() {
  const { data: settings } = useSettings();
  if (!settings?.welcomeMessage) return null;

  return (
    <Card>
      <h2 style={{ fontSize: 18 }}>{settings.brandName}</h2>
      {/* Server-sanitized at write time (sanitize-html allowlist) — the only reason this is safe. */}
      <div style={{ marginTop: 'var(--space-2)' }} dangerouslySetInnerHTML={{ __html: settings.welcomeMessage }} />
    </Card>
  );
}
