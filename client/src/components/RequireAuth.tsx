import { isAxiosError } from 'axios';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useMe } from '../api/hooks';
import type { Role } from '../api/types';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Spinner } from './ui/Spinner';

const RANK: Record<Role, number> = { external: 0, tc: 0, agent: 1, officeAdmin: 2, broker: 3 };

export function RequireAuth({ children, min }: { children: ReactNode; min?: Role }) {
  const { data: user, isLoading, error, refetch } = useMe();
  if (isLoading) return <Spinner />;
  if (error && !(isAxiosError(error) && error.response?.status === 401)) {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 'var(--space-4)' }}>
        <Card style={{ textAlign: 'center' }}>
          <h2>Connection problem</h2>
          <p style={{ color: 'var(--color-text-muted)' }}>
            We couldn't reach the server. Check your connection and try again.
          </p>
          <Button onClick={() => refetch()}>Retry</Button>
        </Card>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (min && RANK[user.role] < RANK[min]) return <Navigate to="/" replace />;
  return <>{children}</>;
}
