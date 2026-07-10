import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { Invitation, NotificationsResponse, PublicSettings, Settings, User } from './types';

export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get<{ user: User }>('/auth/me')).data.user,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

export function usePublicSettings() {
  return useQuery({
    queryKey: ['settings', 'public'],
    queryFn: async () => (await api.get<{ settings: PublicSettings }>('/settings/public')).data.settings,
    staleTime: 5 * 60 * 1000,
  });
}

export function useSettings() {
  return useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await api.get<{ settings: Settings }>('/settings')).data.settings,
  });
}

export function useUsers(includeDeactivated = false) {
  return useQuery({
    queryKey: ['users', { includeDeactivated }],
    queryFn: async () =>
      (await api.get<{ users: User[] }>(`/users?includeDeactivated=${includeDeactivated}`)).data.users,
  });
}

export function useUser(id: string | undefined) {
  return useQuery({
    queryKey: ['users', id],
    queryFn: async () => (await api.get<{ user: User }>(`/users/${id}`)).data.user,
    enabled: !!id,
  });
}

export function useInvitations() {
  return useQuery({
    queryKey: ['invitations'],
    queryFn: async () => (await api.get<{ invitations: Invitation[] }>('/users/invitations')).data.invitations,
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await api.get<NotificationsResponse>('/notifications')).data,
    refetchInterval: 60_000, // keep the bell count fresh
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => api.post('/auth/logout'),
    onSuccess: () => qc.clear(),
  });
}
