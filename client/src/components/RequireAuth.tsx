import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useMe } from '../api/hooks';
import type { Role } from '../api/types';
import { Spinner } from './ui/Spinner';

const RANK: Record<Role, number> = { external: 0, tc: 0, agent: 1, officeAdmin: 2, broker: 3 };

export function RequireAuth({ children, min }: { children: ReactNode; min?: Role }) {
  const { data: user, isLoading } = useMe();
  if (isLoading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (min && RANK[user.role] < RANK[min]) return <Navigate to="/" replace />;
  return <>{children}</>;
}
