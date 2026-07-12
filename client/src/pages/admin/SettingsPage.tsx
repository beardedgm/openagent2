import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import { useMe, useSettings, useTaskTemplates } from '../../api/hooks';
import type { Settings } from '../../api/types';
import { RichTextEditor } from '../../components/RichTextEditor';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';

interface OfficeRow {
  _id?: string;
  name: string;
  address: string;
  timezone: string;
}

interface ResourceRow {
  _id?: string;
  name: string;
}

interface QuickLinkRow {
  label: string;
  url: string;
}

// Mirrors the server's HOMEPAGE_WIDGETS order (server/src/validators/settings.ts) — that file
// is the source of truth for which keys are valid; this list only supplies display labels.
const HOMEPAGE_WIDGET_KEYS = ['welcome', 'banners', 'announcements', 'myTasks', 'events', 'feed', 'quickLinks'] as const;

const WIDGET_LABELS: Record<string, string> = {
  welcome: 'Welcome message',
  banners: 'Banner ads',
  announcements: 'Pinned announcements',
  myTasks: 'My tasks',
  events: 'Upcoming events',
  feed: 'Activity feed preview',
  quickLinks: 'Quick links',
};

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
const MAX_QUICK_LINKS = 12;

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
  const { data: me } = useMe();
  const { data: settings } = useSettings();
  const { data: templates } = useTaskTemplates(me?.role === 'broker');
  const [seeded, setSeeded] = useState(false);

  const [brandName, setBrandName] = useState('');
  const [primaryColor, setPrimaryColor] = useState('#1d4ed8');
  const [offices, setOffices] = useState<OfficeRow[]>([]);
  const [rssFeeds, setRssFeeds] = useState<string[]>([]);
  const [resources, setResources] = useState<ResourceRow[]>([]);
  const [onboardingTaskTemplateId, setOnboardingTaskTemplateId] = useState('');
  const [layout, setLayout] = useState<string[]>([]);
  const [welcomeMessage, setWelcomeMessage] = useState('');
  const [quickLinks, setQuickLinks] = useState<QuickLinkRow[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  function seedFrom(s: NonNullable<typeof settings>) {
    setBrandName(s.brandName);
    setPrimaryColor(s.primaryColor);
    setOffices(s.officeLocations.map((o) => ({ _id: o._id, name: o.name, address: o.address, timezone: o.timezone })));
    setRssFeeds([...s.rssFeeds]);
    setResources(s.reservableResources.map((r) => ({ _id: r._id, name: r.name })));
    setOnboardingTaskTemplateId(s.onboardingTaskTemplateId ?? '');
    setLayout([...s.homepageLayout]);
    setWelcomeMessage(s.welcomeMessage);
    setQuickLinks(s.quickLinks.map((l) => ({ label: l.label, url: l.url })));
  }

  useEffect(() => {
    if (settings && !seeded) {
      seedFrom(settings);
      setSeeded(true);
    }
  }, [settings, seeded]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<{ settings: Settings }>('/admin/settings', body),
    onSuccess: async (res) => {
      // Re-seed the whole form from the saved document so office rows added in this
      // session pick up their server-minted _ids. Without this, a second Save on the
      // same mount would re-send those rows without _id, Mongo would mint fresh ids,
      // and any users assigned to the office in the meantime would dangle.
      seedFrom(res.data.settings);
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
  const hasEmptyResourceName = resources.some((r) => !r.name.trim());
  const hasInvalidFeedUrl = rssFeeds.some((f) => !/^https?:\/\//i.test(f.trim()));
  const hasInvalidQuickLinkUrl = quickLinks.some((l) => {
    const trimmed = l.url.trim();
    return !(/^https?:\/\//i.test(trimmed) || trimmed.startsWith('/'));
  });
  const canSave =
    hexIsValid &&
    !hasEmptyOfficeName &&
    !hasEmptyResourceName &&
    !hasInvalidFeedUrl &&
    !hasInvalidQuickLinkUrl &&
    !save.isPending;

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

  function updateResource(index: number, patch: Partial<ResourceRow>) {
    setResources((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function removeResource(index: number) {
    setResources((prev) => prev.filter((_, i) => i !== index));
  }

  function toggleWidget(key: string, enabled: boolean) {
    setLayout((prev) => (enabled ? [...prev, key] : prev.filter((k) => k !== key)));
  }

  function moveWidget(key: string, direction: -1 | 1) {
    setLayout((prev) => {
      const index = prev.indexOf(key);
      const swapIndex = index + direction;
      if (index < 0 || swapIndex < 0 || swapIndex >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
      return next;
    });
  }

  function updateQuickLink(index: number, patch: Partial<QuickLinkRow>) {
    setQuickLinks((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function removeQuickLink(index: number) {
    setQuickLinks((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSave() {
    // canSave guarantees the hex is valid here, so primaryColor is always included.
    save.mutate({
      brandName,
      primaryColor,
      officeLocations: offices,
      rssFeeds: rssFeeds.map((f) => f.trim()),
      reservableResources: resources,
      onboardingTaskTemplateId: onboardingTaskTemplateId || null,
      homepageLayout: layout,
      welcomeMessage,
      quickLinks,
    });
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
      {(hasEmptyOfficeName || hasEmptyResourceName || hasInvalidFeedUrl || hasInvalidQuickLinkUrl || !hexIsValid) && (
        <p style={{ color: 'var(--color-warning)', fontSize: 13 }}>
          {hasEmptyOfficeName
            ? 'Every office needs a name before you can save.'
            : hasEmptyResourceName
              ? 'Every resource needs a name before you can save.'
              : hasInvalidFeedUrl
                ? 'Every feed URL must start with http:// or https:// before you can save.'
                : hasInvalidQuickLinkUrl
                  ? 'Every quick link URL must start with http://, https://, or / before you can save.'
                  : 'The primary color must be a valid hex value before you can save.'}
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
              error={!hexIsValid ? 'Enter a 6-digit hex color like #1a2b3c' : undefined}
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
        <h2 style={{ fontSize: 18, marginBottom: 'var(--space-3)' }}>Reservable resources</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {resources.map((resource, index) => (
            <div key={resource._id ?? `new-${index}`} style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <input
                aria-label={`Resource ${index + 1} name`}
                value={resource.name}
                onChange={(e) => updateResource(index, { name: e.target.value })}
                placeholder="Name"
                style={{ ...rowInputStyle, flex: '1 1 220px' }}
              />
              <Button variant="secondary" onClick={() => removeResource(index)}>
                Remove
              </Button>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 'var(--space-3)' }}>
          <Button variant="secondary" onClick={() => setResources((prev) => [...prev, { name: '' }])}>
            Add resource
          </Button>
        </div>

        <div style={{ display: 'grid', gap: 'var(--space-1)', marginTop: 'var(--space-4)' }}>
          <label htmlFor="onboarding-template" style={{ fontWeight: 600, fontSize: 14 }}>
            Onboarding template
          </label>
          <select
            id="onboarding-template"
            value={onboardingTaskTemplateId}
            onChange={(e) => setOnboardingTaskTemplateId(e.target.value)}
            style={{ ...rowInputStyle, maxWidth: 320 }}
          >
            <option value="">None</option>
            {templates?.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.name}
              </option>
            ))}
          </select>
        </div>
      </Card>

      <Card>
        <h2 style={{ fontSize: 18, marginBottom: 'var(--space-3)' }}>RSS feeds</h2>
        <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 'var(--space-3)' }}>
          Feeds appear in the Activity Feed.
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

      <Card>
        <h2 style={{ fontSize: 18, marginBottom: 'var(--space-3)' }}>Homepage</h2>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
          {layout.map((key, index) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 44 }}>
              {/* A plain div, not a <label>, so this row's visible text doesn't create a second
                  label association for the checkbox alongside its explicit aria-label above. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flex: 1, fontSize: 14 }}>
                <input
                  type="checkbox"
                  aria-label={`Show ${WIDGET_LABELS[key]} widget`}
                  checked
                  onChange={(e) => toggleWidget(key, e.target.checked)}
                  style={{ width: 18, height: 18 }}
                />
                {WIDGET_LABELS[key]}
              </div>
              <button
                type="button"
                aria-label={`Move ${WIDGET_LABELS[key]} up`}
                disabled={index === 0}
                onClick={() => moveWidget(key, -1)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, color: 'var(--color-text-muted)' }}
              >
                <ChevronUp size={16} />
              </button>
              <button
                type="button"
                aria-label={`Move ${WIDGET_LABELS[key]} down`}
                disabled={index === layout.length - 1}
                onClick={() => moveWidget(key, 1)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, color: 'var(--color-text-muted)' }}
              >
                <ChevronDown size={16} />
              </button>
            </div>
          ))}
          {HOMEPAGE_WIDGET_KEYS.filter((key) => !layout.includes(key)).map((key) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 44 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flex: 1, fontSize: 14, color: 'var(--color-text-muted)' }}>
                <input
                  type="checkbox"
                  aria-label={`Show ${WIDGET_LABELS[key]} widget`}
                  checked={false}
                  onChange={(e) => toggleWidget(key, e.target.checked)}
                  style={{ width: 18, height: 18 }}
                />
                {WIDGET_LABELS[key]}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Welcome message</span>
          <RichTextEditor value={welcomeMessage} onChange={setWelcomeMessage} />
          <span style={{ color: 'var(--color-text-muted)', fontSize: 13 }}>
            Shown on everyone's homepage. Existing plain-text messages need a re-save to format.
          </span>
        </div>

        <h3 style={{ fontSize: 15, marginBottom: 'var(--space-2)' }}>Quick links</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {quickLinks.map((link, index) => (
            <div key={index} style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <input
                aria-label={`Quick link ${index + 1} label`}
                value={link.label}
                onChange={(e) => updateQuickLink(index, { label: e.target.value })}
                placeholder="Label"
                style={{ ...rowInputStyle, flex: '1 1 160px' }}
              />
              <input
                aria-label={`Quick link ${index + 1} URL`}
                value={link.url}
                onChange={(e) => updateQuickLink(index, { url: e.target.value })}
                placeholder="https://… or /internal-path"
                style={{ ...rowInputStyle, flex: '2 1 220px' }}
              />
              <Button variant="secondary" onClick={() => removeQuickLink(index)}>
                Remove
              </Button>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 'var(--space-3)' }}>
          <Button
            variant="secondary"
            disabled={quickLinks.length >= MAX_QUICK_LINKS}
            onClick={() => setQuickLinks((prev) => [...prev, { label: '', url: '' }])}
          >
            Add link
          </Button>
          {quickLinks.length >= MAX_QUICK_LINKS && (
            <span style={{ color: 'var(--color-text-muted)', fontSize: 13, marginLeft: 'var(--space-3)' }}>
              Maximum of {MAX_QUICK_LINKS} quick links.
            </span>
          )}
        </div>
      </Card>
    </div>
  );
}
