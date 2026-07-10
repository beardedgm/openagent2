import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import type { CSSProperties } from 'react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api/client';
import { useMe, useSettings, useUser } from '../api/hooks';
import type { Role } from '../api/types';
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

const secondaryButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 44,
  padding: '0 var(--space-4)',
  background: 'var(--color-surface)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  fontWeight: 600,
  cursor: 'pointer',
};

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

  const updateUser = useMutation({
    mutationFn: (body: { displayName: string; phone: string; bio: string }) => api.patch(`/users/${id}`, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['users'] });
      await qc.invalidateQueries({ queryKey: ['me'] });
      setEditing(false);
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
              <label style={secondaryButtonStyle}>
                Change photo
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadAvatar.mutate(file);
                  }}
                />
              </label>
            )}
            {!editing && (
              <Button
                variant="secondary"
                onClick={() => {
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
    </div>
  );
}
