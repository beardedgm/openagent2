import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { useSettings } from '../../api/hooks';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';

interface OfficeRow {
  _id?: string;
  name: string;
  address: string;
  timezone: string;
}

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
];

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;
const MAX_RSS_FEEDS = 10;

function errorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err)) return (err.response?.data as { error?: string })?.error ?? fallback;
  return fallback;
}

const rowInputStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: '0 var(--space-3)',
  background: 'var(--color-surface)',
};

export function SettingsPage() {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const [seeded, setSeeded] = useState(false);

  const [brandName, setBrandName] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#1d4ed8');
  const [offices, setOffices] = useState<OfficeRow[]>([]);
  const [rssFeeds, setRssFeeds] = useState<string[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  function seedFrom(s: NonNullable<typeof settings>) {
    setBrandName(s.brandName);
    setPrimaryColor(s.primaryColor);
    setOffices(s.officeLocations.map((o) => ({ _id: o._id, name: o.name, address: o.address, timezone: o.timezone })));
    setRssFeeds([...s.rssFeeds]);
  }

  useEffect(() => {
    if (settings && !seeded) {
      seedFrom(settings);
      setSeeded(true);
    }
  }, [settings, seeded]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch('/admin/settings', body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['settings'] });
      await qc.invalidateQueries({ queryKey: ['settings', 'public'] });
    },
  });

  const uploadLogo = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.post('/uploads/logo', formData);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['settings'] });
      await qc.invalidateQueries({ queryKey: ['settings', 'public'] });
    },
  });

  if (!settings) return null;

  const hexIsValid = HEX_PATTERN.test(primaryColor);
  const hasEmptyOfficeName = offices.some((o) => !o.name.trim());
  const hasInvalidFeedUrl = rssFeeds.some((f) => !/^https?:\/\//i.test(f.trim()));
  const canSave = !hasEmptyOfficeName && !hasInvalidFeedUrl && !save.isPending;

  function updateOffice(index: number, patch: Partial<OfficeRow>) {
    setOffices((prev) => prev.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  }

  function removeOffice(index: number) {
    const row = offices[index];
    if (row._id && !window.confirm('Users assigned to this office will keep a dangling reference. Remove this office?')) {
      return;
    }
    setOffices((prev) => prev.filter((_, i) => i !== index));
  }

  function updateFeed(index: number, value: string) {
    setRssFeeds((prev) => prev.map((f, i) => (i === index ? value : f)));
  }

  function removeFeed(index: number) {
    setRssFeeds((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSave() {
    const body: Record<string, unknown> = {
      brandName,
      officeLocations: offices,
      rssFeeds: rssFeeds.map((f) => f.trim()),
    };
    if (hexIsValid) body.primaryColor = primaryColor;
    save.mutate(body);
  }

  const saveErrorMessage = save.isError ? errorMessage(save.error, 'Could not save settings') : undefined;
  const uploadErrorMessage = uploadLogo.isError ? errorMessage(uploadLogo.error, 'Upload failed') : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <h1 style={{ fontSize: 24 }}>Settings</h1>
        <div style={{ flex: 1 }} />
        <Button
          variant="secondary"
          onClick={() => {
            seedFrom(settings);
            save.reset();
          }}
        >
          Reset
        </Button>
        <Button onClick={handleSave} disabled={!canSave}>
          {save.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>

      {saveErrorMessage && (
        <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 13 }}>
          {saveErrorMessage}
        </p>
      )}
      {save.isSuccess && (
        <p role="status" style={{ color: 'var(--color-success)', fontSize: 13 }}>
          Saved
        </p>
      )}
      {(hasEmptyOfficeName || hasInvalidFeedUrl) && (
        <p style={{ color: 'var(--color-warning)', fontSize: 13 }}>
          {hasEmptyOfficeName
            ? 'Every office needs a name before you can save.'
            : 'Every feed URL must start with http:// or https:// before you can save.'}
        </p>
      )}

      <Card>
        <h2 style={{ fontSize: 18, marginBottom: 'var(--space-3)' }}>Brand</h2>
        <Field label="Brand name" value={brandName} onChange={(e) => setBrandName(e.target.value)} required />
        <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
            <label htmlFor="settings-color-swatch" style={{ fontWeight: 600, fontSize: 14 }}>
              Primary color
            </label>
            <input
              id="settings-color-swatch"
              type="color"
              value={hexIsValid ? primaryColor : settings.primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              style={{ width: 60, height: 44, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}
            />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <Field
              label="Primary color (hex)"
              value={primaryColor}
              onChange={(e) => setPrimaryColor(e.target.value)}
              error={!hexIsValid ? 'Must be a hex color like #1a2b3c' : undefined}
            />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
          {settings.logoUrl ? (
            <img src={settings.logoUrl} alt="" style={{ height: 48 }} />
          ) : (
            <span style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>No logo uploaded</span>
          )}
          <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={uploadLogo.isPending}>
            {uploadLogo.isPending ? 'Uploading…' : 'Upload logo'}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file) uploadLogo.mutate(file);
              e.currentTarget.value = '';
            }}
          />
        </div>
        {uploadErrorMessage && (
          <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 'var(--space-2)' }}>
            {uploadErrorMessage}
          </p>
        )}
      </Card>

      <Card>
        <h2 style={{ fontSize: 18, marginBottom: 'var(--space-3)' }}>Offices</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {offices.map((office, index) => (
            <div key={office._id ?? `new-${index}`} style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <input
                aria-label={`Office ${index + 1} name`}
                value={office.name}
                onChange={(e) => updateOffice(index, { name: e.target.value })}
                placeholder="Name"
                style={{ ...rowInputStyle, flex: '1 1 160px' }}
              />
              <input
                aria-label={`Office ${index + 1} address`}
                value={office.address}
                onChange={(e) => updateOffice(index, { address: e.target.value })}
                placeholder="Address"
                style={{ ...rowInputStyle, flex: '2 1 220px' }}
              />
              <select
                aria-label={`Office ${index + 1} timezone`}
                value={office.timezone}
                onChange={(e) => updateOffice(index, { timezone: e.target.value })}
                style={{ ...rowInputStyle, flex: '1 1 180px' }}
              >
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz}
                  </option>
                ))}
              </select>
              <Button variant="secondary" onClick={() => removeOffice(index)}>
                Remove
              </Button>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 'var(--space-3)' }}>
          <Button
            variant="secondary"
            onClick={() => setOffices((prev) => [...prev, { name: '', address: '', timezone: 'America/Chicago' }])}
          >
            Add office
          </Button>
        </div>
      </Card>

      <Card>
        <h2 style={{ fontSize: 18, marginBottom: 'var(--space-3)' }}>RSS feeds</h2>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 'var(--space-3)' }}>
          Feeds appear in the Activity Feed (coming in the next release).
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {rssFeeds.map((feed, index) => (
            <div key={index} style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <input
                aria-label={`Feed ${index + 1} URL`}
                value={feed}
                onChange={(e) => updateFeed(index, e.target.value)}
                placeholder="https://example.com/feed.xml"
                style={{ ...rowInputStyle, flex: 1 }}
              />
              <Button variant="secondary" onClick={() => removeFeed(index)}>
                Remove
              </Button>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 'var(--space-3)' }}>
          <Button
            variant="secondary"
            disabled={rssFeeds.length >= MAX_RSS_FEEDS}
            onClick={() => setRssFeeds((prev) => [...prev, ''])}
          >
            Add feed
          </Button>
          {rssFeeds.length >= MAX_RSS_FEEDS && (
            <span style={{ color: 'var(--color-text-muted)', fontSize: 13, marginLeft: 'var(--space-3)' }}>
              Maximum of {MAX_RSS_FEEDS} feeds.
            </span>
          )}
        </div>
      </Card>
    </div>
  );
}
