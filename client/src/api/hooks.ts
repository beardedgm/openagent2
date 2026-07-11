import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type {
  CalendarEventInfo,
  EventOccurrence,
  Invitation,
  NotificationsResponse,
  OnboardingProgress,
  Post,
  PostComment,
  PublicSettings,
  RsvpSummary,
  Settings,
  TaskInfo,
  TaskMatrixRow,
  TaskTemplateInfo,
  User,
} from './types';

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

// poll=false lets secondary consumers (the drawer) read the shared cache without adding another interval.
export function useNotifications(poll = true) {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: async () => (await api.get<NotificationsResponse>('/notifications')).data,
    refetchInterval: poll ? 60_000 : false, // keep the bell count fresh
  });
}

export function usePosts(q: string, page: number) {
  return useQuery({
    queryKey: ['posts', { q, page }],
    queryFn: async () =>
      (await api.get<{ posts: Post[]; total: number; page: number }>(
        `/posts?page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}`,
      )).data,
  });
}

export function usePost(id: string | undefined) {
  return useQuery({
    queryKey: ['posts', id],
    queryFn: async () => (await api.get<{ post: Post }>(`/posts/${id}`)).data.post,
    enabled: !!id,
  });
}

export function useComments(postId: string | undefined) {
  return useQuery({
    queryKey: ['posts', postId, 'comments'],
    queryFn: async () => (await api.get<{ comments: PostComment[] }>(`/posts/${postId}/comments`)).data.comments,
    enabled: !!postId,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => api.post('/auth/logout'),
    onSuccess: () => qc.clear(),
  });
}

export function useEvents(fromIso: string, toIso: string) {
  return useQuery({
    queryKey: ['events', { fromIso, toIso }],
    queryFn: async () =>
      (
        await api.get<{ occurrences: EventOccurrence[] }>(
          `/events?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}`,
        )
      ).data.occurrences,
  });
}

export function useEvent(id: string | undefined) {
  return useQuery({
    queryKey: ['events', id],
    queryFn: async () =>
      (await api.get<{ event: CalendarEventInfo; rsvpSummary?: RsvpSummary }>(`/events/${id}`)).data,
    enabled: !!id,
  });
}

export function useTasks(scope: 'mine' | 'all') {
  return useQuery({
    queryKey: ['tasks', { scope }],
    queryFn: async () => (await api.get<{ tasks: TaskInfo[] }>(`/tasks?scope=${scope}`)).data.tasks,
  });
}

export function useTask(id: string | undefined) {
  return useQuery({
    queryKey: ['tasks', id],
    queryFn: async () => (await api.get<{ task: TaskInfo; matrix?: TaskMatrixRow[] }>(`/tasks/${id}`)).data,
    enabled: !!id,
  });
}

export function useTaskTemplates(enabled = true) {
  return useQuery({
    queryKey: ['task-templates'],
    queryFn: async () => (await api.get<{ templates: TaskTemplateInfo[] }>('/task-templates')).data.templates,
    enabled,
  });
}

export function useMyOnboarding() {
  return useQuery({
    queryKey: ['onboarding', 'mine'],
    queryFn: async () => (await api.get<OnboardingProgress>('/tasks/onboarding/mine')).data,
  });
}

export function useOnboardingStatus(enabled: boolean) {
  return useQuery({
    queryKey: ['onboarding', 'status'],
    queryFn: async () =>
      (await api.get<{ statuses: ({ userId: string } & OnboardingProgress)[] }>('/tasks/onboarding/status')).data
        .statuses,
    enabled,
  });
}
