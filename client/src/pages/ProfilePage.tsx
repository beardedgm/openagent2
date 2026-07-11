import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useMe, useSettings, useUser } from '../api/hooks';
import type { Role, User } from '../api/types';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Field } from '../components/ui/Field';
import { Spinner } from '../components/ui/Spinner';

const ROLE_LABELS: Record<Role, string> = {
  broker: 'Broker',
  officeAdmin: 'Office Admin',
  agent: 'Agent',
  tc: 'TC',
  external: 'External',
};

const ROLE_TONE: Record<Role, 'accent' | 'success' | 'neutral'> = {
  broker: 'accent',
  officeAdmin: 'success',
  agent: 'neutral',
  tc: 'neutral',
  external: 'neutral',
};

const EMAIL_PREFS: { key: string; label: string; adminOnly?: boolean; defaultOn?: boolean }[] = [
  { key: 'postPublished', label: 'Important announcements' },
  { key: 'invitationAccepted', label: 'An invitation I sent is accepted', adminOnly: true },
  { key: 'taskAssigned', label: 'Task assignments (High priority or due soon)' },
  { key: 'taskDueSoon', label: 'Task due-soon reminders' },
  { key: 'mandatoryEvent', label: 'Mandatory event announcements' },
  // Opt-IN (PRD 5.4): event reminders are off unless enabled.
  { key: 'eventReminders', label: 'Event reminders (24h and 1h before)', defaultOn: false },
];

export function ProfilePage() {
  const { id } = useParams();
  const { data: user, isLoading, error } = useUser(id);
  const { data: me } = useMe();
  const { data: settings } = useSettings();
  const qc = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [bio, setBio] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // React Router does not remount this page on :id changes, so exit edit mode (and its stale
  // form state, seeded from the previous profile) whenever the viewed user changes.
  useEffect(() => {
    setEditing(false);
  }, [id]);

  const updateUser = useMutation({
    mutationFn: (body: { displayName: string; phone: string; bio: string }) => api.patch(`/users/${id}`, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['users'] });
      await qc.invalidateQueries({ queryKey: ['me'] });
      setEditing(false);
    },
  });

  const updatePrefs = useMutation({
    mutationFn: (emailPrefs: Record<string, boolean>) => api.patch(`/users/${id}`, { emailPrefs }),
    onMutate: async (emailPrefs) => {
      await qc.cancelQueries({ queryKey: ['users', id] });
      const previous = qc.getQueryData<User>(['users', id]);
      if (previous) qc.setQueryData<User>(['users', id], { ...previous, emailPrefs });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(['users', id], ctx.previous);
    },
    onSettled: async () => {
      await qc.invalidateQueries({ queryKey: ['users', id] });
      await qc.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const uploadAvatar = useMutation({
    mutationFn: (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return api.post('/uploads/avatar', formData);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['me'] });
      await qc.invalidateQueries({ queryKey: ['users', id] });
    },
  });

  const uploadErrorMessage =
    uploadAvatar.isError && isAxiosError(uploadAvatar.error)
      ? ((uploadAvatar.error.response?.data as { error?: string })?.error ?? 'Upload failed')
      : undefined;

  const saveErrorMessage =
    updateUser.isError && isAxiosError(updateUser.error)
      ? ((updateUser.error.response?.data as { error?: string })?.error ?? 'Could not save changes')
      : undefined;

  const prefsErrorMessage =
    updatePrefs.isError && isAxiosError(updatePrefs.error)
      ? ((updatePrefs.error.response?.data as { error?: string })?.error ?? 'Could not save preferences')
      : undefined;

  if (isLoading) return <Spinner label="Loading profile" />;

  if (!user) {
    if (isAxiosError(error) && error.response?.status === 404) {
      return (
        <Card>
          <h2 style={{ fontSize: 18 }}>User not found</h2>
        </Card>
      );
    }
    return null;
  }

  const isSelf = !!me && me.id === user.id;
  const canEdit = isSelf || me?.role === 'broker' || me?.role === 'officeAdmin';
  const officeName = settings?.officeLocations.find((o) => o._id === user.officeId)?.name;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <Card>
        <div style={{ display: 'flex', gap: 'var(--space-4)', alignItems: 'flex-start' }}>
          {user.photoUrl ? (
            <img
              src={user.photoUrl}
              alt=""
              style={{ width: 80, height: 80, borderRadius: '50%', objectFit: 'cover' }}
            />
          ) : (
            <span
              style={{
                width: 80,
                height: 80,
                borderRadius: '50%',
                display: 'grid',
                placeItems: 'center',
                background: 'var(--color-accent)',
                color: '#fff',
                fontSize: 28,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {user.displayName?.[0]?.toUpperCase() ?? '?'}
            </span>
          )}
          <div>
            <h1 style={{ fontSize: 22 }}>{user.displayName}</h1>
            <div style={{ marginBottom: 'var(--space-2)' }}>
              <Badge tone={ROLE_TONE[user.role]}>{ROLE_LABELS[user.role]}</Badge>
            </div>
            {officeName && <div style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>{officeName}</div>}
            <div style={{ marginTop: 'var(--space-2)' }}>
              <a href={`mailto:${user.email}`}>{user.email}</a>
            </div>
            {user.phone && <div style={{ fontSize: 14 }}>{user.phone}</div>}
            {user.bio && <p style={{ marginTop: 'var(--space-3)' }}>{user.bio}</p>}
          </div>
        </div>

        {canEdit && (
          <div style={{ marginTop: 'var(--space-4)', display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
            {/* POST /uploads/avatar always sets the AUTHENTICATED caller's photoUrl (self-only by
                design in Stage 1), so the upload control is shown only on your own profile.
                Admin-set photos would need a new server route. */}
            {isSelf && (
              <>
                <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
                  Change photo
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(e) => {
                    const file = e.currentTarget.files?.[0];
                    if (file) uploadAvatar.mutate(file);
                    // Clear the input so selecting the same file again (e.g. after a failed
                    // upload) still fires this change handler.
                    e.currentTarget.value = '';
                  }}
                />
              </>
            )}
            {!editing && (
              <Button
                variant="secondary"
                onClick={() => {
                  updateUser.reset();
                  setDisplayName(user.displayName);
                  setPhone(user.phone);
                  setBio(user.bio);
                  setEditing(true);
                }}
              >
                Edit profile
              </Button>
            )}
          </div>
        )}
        {uploadErrorMessage && (
          <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 'var(--space-2)' }}>
            {uploadErrorMessage}
          </p>
        )}
      </Card>

      {editing && (
        <Card>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateUser.mutate({ displayName, phone, bio });
            }}
          >
            <Field label="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
            <Field label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <div style={{ display: 'grid', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
              <label htmlFor="profile-bio" style={{ fontWeight: 600, fontSize: 14 }}>
                Bio
              </label>
              <textarea
                id="profile-bio"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={4}
                style={{
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: 'var(--space-2) var(--space-3)',
                  background: 'var(--color-surface)',
                  font: 'inherit',
                  resize: 'vertical',
                }}
              />
            </div>
            {saveErrorMessage && (
              <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 'var(--space-3)' }}>
                {saveErrorMessage}
              </p>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <Button type="submit" disabled={updateUser.isPending}>
                {updateUser.isPending ? 'Saving…' : 'Save'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {isSelf && me && (
        <Card>
          <h2 style={{ fontSize: 18, marginBottom: 'var(--space-2)' }}>Email notifications</h2>
          <p style={{ color: 'var(--color-text-muted)', fontSize: 14, marginBottom: 'var(--space-3)' }}>
            In-app notifications are always on. Choose which ones also send an email.
          </p>
          {EMAIL_PREFS.filter((p) => !p.adminOnly || me.role === 'broker' || me.role === 'officeAdmin').map((p) => (
            <label
              key={p.key}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minHeight: 44, fontSize: 14 }}
            >
              <input
                type="checkbox"
                checked={user.emailPrefs[p.key] ?? p.defaultOn !== false}
                onChange={(e) => updatePrefs.mutate({ ...user.emailPrefs, [p.key]: e.target.checked })}
                style={{ width: 18, height: 18 }}
              />
              {p.label}
            </label>
          ))}
          <p style={{ color: 'var(--color-text-muted)', fontSize: 13, marginTop: 'var(--space-2)' }}>
            Overdue-task emails are always sent.
          </p>
          {prefsErrorMessage && (
            <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 'var(--space-2)' }}>
              {prefsErrorMessage}
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
