import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useNotifications } from '../api/hooks';
import type { NotificationItem } from '../api/types';
import { Button } from './ui/Button';

export function NotificationsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data } = useNotifications();
  const qc = useQueryClient();
  const navigate = useNavigate();

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read-all'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  if (!open) return null;

  const onItemClick = (n: NotificationItem) => {
    if (!n.readAt) markRead.mutate(n.id);
    onClose();
    if (n.link) navigate(n.link);
  };

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: '64px 0 0 0', zIndex: 29 }} />
      <div
        role="dialog"
        aria-label="Notifications"
        style={{
          position: 'fixed',
          top: 64,
          right: 0,
          bottom: 0,
          width: 'min(360px, 100vw)',
          zIndex: 30,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--color-surface)',
          borderLeft: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            padding: 'var(--space-3) var(--space-4)',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <strong style={{ flex: 1 }}>Notifications</strong>
          <Button variant="secondary" style={{ minHeight: 44 }} onClick={() => markAll.mutate()}>
            Mark all read
          </Button>
          <button
            aria-label="Close notifications"
            onClick={onClose}
            style={{
              width: 44,
              height: 44,
              display: 'grid',
              placeItems: 'center',
              background: 'transparent',
              border: 'none',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--color-text)',
            }}
          >
            <X size={18} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {data?.notifications.length === 0 && (
            <p style={{ padding: 'var(--space-4)', color: 'var(--color-text-muted)' }}>You're all caught up.</p>
          )}
          {data?.notifications.map((n) => (
            <button
              key={n.id}
              onClick={() => onItemClick(n)}
              style={{
                display: 'flex',
                gap: 'var(--space-2)',
                alignItems: 'baseline',
                width: '100%',
                minHeight: 44,
                padding: 'var(--space-3) var(--space-4)',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid var(--color-border)',
                textAlign: 'left',
                color: 'var(--color-text)',
                fontWeight: n.readAt ? 400 : 600,
              }}
            >
              {!n.readAt && (
                <span
                  aria-hidden
                  style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-accent)', flexShrink: 0 }}
                />
              )}
              <span style={{ flex: 1 }}>
                {n.title}
                <span style={{ display: 'block', fontSize: 12, fontWeight: 400, color: 'var(--color-text-muted)' }}>
                  {new Date(n.createdAt).toLocaleString()}
                </span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
