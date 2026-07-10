import { useMutation, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client';
import { useInvitations, useMe, useSettings, useUsers } from '../../api/hooks';
import type { Role } from '../../api/types';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Field } from '../../components/ui/Field';
import { Modal } from '../../components/ui/Modal';
import { Spinner } from '../../components/ui/Spinner';

const ROLE_LABELS: Record<Role, string> = {
  broker: 'Broker',
  officeAdmin: 'Office Admin',
  agent: 'Agent',
  tc: 'TC',
  external: 'External',
};

function errorMessage(err: unknown, fallback: string): string {
  if (isAxiosError(err)) return (err.response?.data as { error?: string })?.error ?? fallback;
  return fallback;
}

const selectStyle = {
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  padding: '0 var(--space-3)',
  background: 'var(--color-surface)',
};

export function UsersPage() {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const { data: settings } = useSettings();
  const { data: users, isLoading } = useUsers(true);
  const { data: invitations } = useInvitations();

  const isBroker = me?.role === 'broker';

  // Invite modal state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'agent' | 'officeAdmin' | 'broker'>('agent');
  const [inviteOfficeId, setInviteOfficeId] = useState('');
  const [inviteEmailWarning, setInviteEmailWarning] = useState<string | null>(null);

  const invite = useMutation({
    mutationFn: (body: { email: string; role: string; officeId: string | null }) =>
      api.post<{ invitation: { id: string; email: string; role: string; expiresAt: string }; emailSent: boolean }>(
        '/users/invite',
        body,
      ),
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ['invitations'] });
      setInviteOpen(false);
      setInviteEmail('');
      setInviteRole('agent');
      setInviteOfficeId('');
      setInviteEmailWarning(
        res.data.emailSent === false ? 'Invitation created but the email could not be sent — use Resend.' : null,
      );
    },
  });

  const inviteErrorMessage = invite.isError ? errorMessage(invite.error, 'Could not send invitation') : undefined;

  function closeInvite() {
    setInviteOpen(false);
    setInviteEmail('');
    setInviteRole('agent');
    setInviteOfficeId('');
    // The dialog's close event also fires when the invite success handler closes the
    // modal — that close must keep the emailSent warning the handler just set, so
    // only user-initiated cancels (no fresh success) clear it.
    if (!invite.isSuccess) setInviteEmailWarning(null);
  }

  // Resend state (tracked via the mutation's own variables/status — only one resend in flight/shown at a time)
  const resend = useMutation({
    mutationFn: (id: string) => api.post<{ emailSent: boolean }>(`/users/invitations/${id}/resend`),
    onSuccess: async () => {
      setInviteEmailWarning(null);
      await qc.invalidateQueries({ queryKey: ['invitations'] });
    },
  });

  // Table-level error banner (PATCH role/office, DELETE deactivate)
  const [tableError, setTableError] = useState<string | null>(null);

  const patchUser = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.patch(`/users/${id}`, body),
    onSuccess: async () => {
      setTableError(null);
      await qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err) => setTableError(errorMessage(err, 'Could not update user')),
  });

  const deactivateUser = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: async () => {
      setTableError(null);
      await qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err) => setTableError(errorMessage(err, 'Could not deactivate user')),
  });

  if (isLoading) return <Spinner label="Loading users" />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <h1 style={{ fontSize: 24 }}>Users</h1>
        <div style={{ flex: 1 }} />
        <Button
          onClick={() => {
            invite.reset();
            setInviteOpen(true);
          }}
        >
          Invite user
        </Button>
      </div>

      <Modal title="Invite user" open={inviteOpen} onClose={closeInvite}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate({ email: inviteEmail, role: inviteRole, officeId: inviteOfficeId || null });
          }}
        >
          <Field
            label="Email"
            type="email"
            required
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
          <div style={{ display: 'grid', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
            <label htmlFor="invite-role" style={{ fontWeight: 600, fontSize: 14 }}>
              Role
            </label>
            <select
              id="invite-role"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as typeof inviteRole)}
              style={selectStyle}
            >
              <option value="agent">Agent</option>
              <option value="officeAdmin">Office Admin</option>
              {isBroker && <option value="broker">Broker</option>}
            </select>
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-1)', marginBottom: 'var(--space-4)' }}>
            <label htmlFor="invite-office" style={{ fontWeight: 600, fontSize: 14 }}>
              Office
            </label>
            <select
              id="invite-office"
              value={inviteOfficeId}
              onChange={(e) => setInviteOfficeId(e.target.value)}
              style={selectStyle}
            >
              <option value="">None</option>
              {settings?.officeLocations.map((o) => (
                <option key={o._id} value={o._id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          {inviteErrorMessage && (
            <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 'var(--space-3)' }}>
              {inviteErrorMessage}
            </p>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button type="submit" disabled={invite.isPending}>
              {invite.isPending ? 'Sending…' : 'Send invite'}
            </Button>
            <Button type="button" variant="secondary" onClick={closeInvite}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>

      {invitations && invitations.length > 0 && (
        <Card>
          <h2 style={{ fontSize: 18, marginBottom: 'var(--space-3)' }}>Pending invitations</h2>
          {inviteEmailWarning && (
            <p role="status" style={{ color: 'var(--color-warning)', fontSize: 13, marginBottom: 'var(--space-3)' }}>
              {inviteEmailWarning}
            </p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {invitations.map((inv) => {
              const expired = new Date(inv.expiresAt) < new Date();
              const isThisRow = resend.variables === inv.id;
              return (
                <div
                  key={inv.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}
                >
                  <span style={{ flex: '1 1 220px' }}>{inv.email}</span>
                  <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{ROLE_LABELS[inv.role]}</span>
                  <span style={{ fontSize: 13 }}>Expires {new Date(inv.expiresAt).toLocaleDateString()}</span>
                  {expired && <Badge tone="danger">Expired</Badge>}
                  <Button
                    variant="secondary"
                    disabled={resend.isPending && isThisRow}
                    onClick={() => resend.mutate(inv.id)}
                  >
                    {resend.isPending && isThisRow ? 'Resending…' : 'Resend'}
                  </Button>
                  {isThisRow && resend.isSuccess && (
                    <span role="status" style={{ fontSize: 12, color: 'var(--color-success)' }}>
                      {resend.data?.data.emailSent === false ? 'Resent, but the email could not be sent.' : 'Invitation resent.'}
                    </span>
                  )}
                  {isThisRow && resend.isError && (
                    <span role="alert" style={{ fontSize: 12, color: 'var(--color-danger)' }}>
                      {errorMessage(resend.error, 'Could not resend invitation')}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {tableError && (
        <p role="alert" style={{ color: 'var(--color-danger)', fontSize: 13 }}>
          {tableError}
        </p>
      )}

      <Card>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--color-border)' }}>
                <th style={{ padding: 'var(--space-2)' }}>User</th>
                <th style={{ padding: 'var(--space-2)' }}>Email</th>
                <th style={{ padding: 'var(--space-2)' }}>Role</th>
                <th style={{ padding: 'var(--space-2)' }}>Office</th>
                <th style={{ padding: 'var(--space-2)' }}>Status</th>
                <th style={{ padding: 'var(--space-2)' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users?.map((u) => {
                const isOwnRow = me?.id === u.id;
                // Broker rows are read-only for non-brokers: the server rejects role AND office
                // changes on broker targets from officeAdmins, so both selects are disabled.
                const brokerRowLocked = u.role === 'broker' && !isBroker;
                return (
                  <tr key={u.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td style={{ padding: 'var(--space-2)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        {u.photoUrl ? (
                          <img
                            src={u.photoUrl}
                            alt=""
                            style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }}
                          />
                        ) : (
                          <span
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: '50%',
                              display: 'grid',
                              placeItems: 'center',
                              background: 'var(--color-accent)',
                              color: '#fff',
                              fontSize: 13,
                              fontWeight: 700,
                              flexShrink: 0,
                            }}
                          >
                            {u.displayName?.[0]?.toUpperCase() ?? '?'}
                          </span>
                        )}
                        <Link to={`/profile/${u.id}`}>{u.displayName}</Link>
                      </div>
                    </td>
                    <td style={{ padding: 'var(--space-2)' }}>{u.email}</td>
                    <td style={{ padding: 'var(--space-2)' }}>
                      <select
                        aria-label={`Role for ${u.displayName}`}
                        value={u.role}
                        disabled={brokerRowLocked || patchUser.isPending}
                        onChange={(e) => patchUser.mutate({ id: u.id, body: { role: e.target.value } })}
                        style={selectStyle}
                      >
                        <option value="agent">Agent</option>
                        <option value="officeAdmin">Office Admin</option>
                        {/* For non-broker viewers this option only ever appears on broker rows,
                            where the select is disabled — it exists so the locked row displays
                            "Broker" instead of a blank value. */}
                        {(isBroker || u.role === 'broker') && <option value="broker">Broker</option>}
                      </select>
                    </td>
                    <td style={{ padding: 'var(--space-2)' }}>
                      <select
                        aria-label={`Office for ${u.displayName}`}
                        value={u.officeId ?? ''}
                        disabled={brokerRowLocked || patchUser.isPending}
                        onChange={(e) =>
                          patchUser.mutate({ id: u.id, body: { officeId: e.target.value || null } })
                        }
                        style={selectStyle}
                      >
                        <option value="">None</option>
                        {settings?.officeLocations.map((o) => (
                          <option key={o._id} value={o._id}>
                            {o.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: 'var(--space-2)' }}>
                      <Badge tone={u.status === 'active' ? 'success' : 'neutral'}>
                        {u.status === 'active' ? 'Active' : 'Deactivated'}
                      </Badge>
                    </td>
                    <td style={{ padding: 'var(--space-2)' }}>
                      {!isOwnRow && u.status === 'active' && (
                        <Button
                          variant="danger"
                          onClick={() => {
                            if (window.confirm(`Deactivate ${u.displayName}? They will no longer be able to sign in.`)) {
                              deactivateUser.mutate(u.id);
                            }
                          }}
                        >
                          Deactivate
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
