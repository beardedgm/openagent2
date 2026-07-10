import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSettings, useUsers } from '../api/hooks';
import type { Role } from '../api/types';
import { Badge } from '../components/ui/Badge';
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

export function DirectoryPage() {
  const { data: users, isLoading } = useUsers();
  const { data: settings } = useSettings();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [officeFilter, setOfficeFilter] = useState('');

  if (isLoading) return <Spinner label="Loading directory" />;

  const officeName = (officeId: string | null) =>
    settings?.officeLocations.find((o) => o._id === officeId)?.name ?? '—';

  const query = search.trim().toLowerCase();
  const filtered = (users ?? []).filter((u) => {
    const matchesQuery =
      !query || u.displayName.toLowerCase().includes(query) || u.email.toLowerCase().includes(query);
    const matchesRole = !roleFilter || u.role === roleFilter;
    const matchesOffice = !officeFilter || u.officeId === officeFilter;
    return matchesQuery && matchesRole && matchesOffice;
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <h1 style={{ fontSize: 24 }}>Directory</h1>

      <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 240px' }}>
          <Field
            label="Search"
            placeholder="Search by name or email"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
          <label htmlFor="directory-role-filter" style={{ fontWeight: 600, fontSize: 14 }}>
            Role
          </label>
          <select
            id="directory-role-filter"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '0 var(--space-3)',
              background: 'var(--color-surface)',
            }}
          >
            <option value="">All roles</option>
            <option value="broker">Broker</option>
            <option value="officeAdmin">Office Admin</option>
            <option value="agent">Agent</option>
          </select>
        </div>
        <div style={{ display: 'grid', gap: 'var(--space-1)' }}>
          <label htmlFor="directory-office-filter" style={{ fontWeight: 600, fontSize: 14 }}>
            Office
          </label>
          <select
            id="directory-office-filter"
            value={officeFilter}
            onChange={(e) => setOfficeFilter(e.target.value)}
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '0 var(--space-3)',
              background: 'var(--color-surface)',
            }}
          >
            <option value="">All offices</option>
            {settings?.officeLocations.map((o) => (
              <option key={o._id} value={o._id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap: 'var(--space-4)',
        }}
      >
        {filtered.map((u) => (
          <Card key={u.id}>
            {u.photoUrl ? (
              <img
                src={u.photoUrl}
                alt=""
                style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover' }}
              />
            ) : (
              <span
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  background: 'var(--color-accent)',
                  color: '#fff',
                  fontSize: 18,
                  fontWeight: 700,
                }}
              >
                {u.displayName?.[0]?.toUpperCase() ?? '?'}
              </span>
            )}
            <div style={{ marginTop: 'var(--space-3)' }}>
              <Link to={`/profile/${u.id}`} style={{ fontWeight: 700, textDecoration: 'none' }}>
                {u.displayName}
              </Link>
            </div>
            <div style={{ marginTop: 'var(--space-1)' }}>
              <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABELS[u.role]}</Badge>
            </div>
            <div style={{ marginTop: 'var(--space-2)', color: 'var(--color-text-muted)', fontSize: 13 }}>
              {officeName(u.officeId)}
            </div>
            <div style={{ marginTop: 'var(--space-1)', fontSize: 13 }}>{u.email}</div>
            {u.phone && <div style={{ fontSize: 13 }}>{u.phone}</div>}
          </Card>
        ))}
      </div>
    </div>
  );
}
