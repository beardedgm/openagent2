import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from './client';
import type {
  BannerInfo,
  CalendarEventInfo,
  Category,
  EventOccurrence,
  FeedResponse,
  Invitation,
  NotificationsResponse,
  OnboardingProgress,
  Post,
  PostComment,
  PublicSettings,
  ResourceInfo,
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

export function useFeedPreview() {
  return useQuery({
    queryKey: ['feed', 'preview'],
    queryFn: async () => {
      const { data } = await api.get<FeedResponse>('/feed');
      return [...data.pinned, ...data.items].slice(0, 5);
    },
    staleTime: 60_000,
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
    // Prev/next changes the query key every step; keep the old grid on screen while the
    // new range loads instead of blanking the calendar on every navigation.
    placeholderData: keepPreviousData,
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

// Fixed 30-day/5-item preview for the dashboard events widget; useMemo keeps the from/to
// (and thus the useEvents query key) stable across re-renders instead of drifting every render.
export function useUpcomingEvents(days = 30, limit = 5) {
  const from = useMemo(() => new Date(), []);
  const to = useMemo(() => new Date(from.getTime() + days * 86_400_000), [from, days]);
  const q = useEvents(from.toISOString(), to.toISOString());
  return { ...q, data: q.data ? q.data.slice(0, limit) : undefined };
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

export function useCategories() {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async () => (await api.get<{ categories: Category[] }>('/categories')).data.categories,
  });
}

export interface ResourceFilters {
  q?: string;
  categoryId?: string;
  fileType?: string;
  scope?: 'all' | 'mine';
  page?: number;
}

export function useResources(filters: ResourceFilters = {}) {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.categoryId) params.set('categoryId', filters.categoryId);
  if (filters.fileType) params.set('fileType', filters.fileType);
  if (filters.scope === 'mine') params.set('scope', 'mine');
  params.set('page', String(filters.page ?? 1));
  return useQuery({
    queryKey: ['resources', filters],
    queryFn: async () =>
      (await api.get<{ resources: ResourceInfo[]; total: number; page: number }>(`/resources?${params}`)).data,
    placeholderData: keepPreviousData,
  });
}

export function useFeaturedResources() {
  return useQuery({
    queryKey: ['resources', 'featured'],
    queryFn: async () => (await api.get<{ resources: ResourceInfo[] }>('/resources/featured')).data.resources,
  });
}

export function useResource(id: string | undefined) {
  return useQuery({
    queryKey: ['resources', id],
    queryFn: async () => (await api.get<{ resource: ResourceInfo }>(`/resources/${id}`)).data.resource,
    enabled: !!id,
  });
}

export function useResourceMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['resources'] });
  return {
    create: useMutation({
      mutationFn: async (input: Record<string, unknown>) =>
        (await api.post<{ resource: ResourceInfo }>('/resources', input)).data.resource,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: async ({ id, ...patch }: { id: string } & Record<string, unknown>) =>
        (await api.patch<{ resource: ResourceInfo }>(`/resources/${id}`, patch)).data.resource,
      onSuccess: invalidate,
    }),
    uploadFile: useMutation({
      mutationFn: async ({ id, file }: { id: string; file: File }) => {
        const form = new FormData();
        form.append('file', file);
        return (await api.post<{ resource: ResourceInfo }>(`/resources/${id}/file`, form)).data.resource;
      },
      onSuccess: invalidate,
    }),
    setFeatured: useMutation({
      mutationFn: async ({ id, featured }: { id: string; featured: boolean }) =>
        featured ? (await api.post(`/resources/${id}/featured`)).data : (await api.delete(`/resources/${id}/featured`)).data,
      onSuccess: invalidate,
    }),
    setBookmark: useMutation({
      mutationFn: async ({ id, bookmarked }: { id: string; bookmarked: boolean }) =>
        bookmarked ? (await api.post(`/resources/${id}/bookmark`)).data : (await api.delete(`/resources/${id}/bookmark`)).data,
      onSuccess: invalidate,
    }),
  };
}

export function useCategoryMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['categories'] });
  return {
    create: useMutation({
      mutationFn: async (input: { name: string; parentId?: string | null }) =>
        (await api.post<{ category: Category }>('/categories', input)).data.category,
      onSuccess: invalidate,
    }),
    rename: useMutation({
      mutationFn: async ({ id, name }: { id: string; name: string }) =>
        (await api.patch<{ category: Category }>(`/categories/${id}`, { name })).data.category,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => (await api.delete(`/categories/${id}`)).data,
      onSuccess: invalidate,
    }),
  };
}

export function useActiveBanners() {
  return useQuery({
    queryKey: ['banners', 'active'],
    queryFn: async () => (await api.get<{ banners: BannerInfo[] }>('/banners/active')).data.banners,
    staleTime: 60_000,
  });
}

export function useBanners() {
  return useQuery({
    queryKey: ['banners'],
    queryFn: async () => (await api.get<{ banners: BannerInfo[] }>('/banners')).data.banners,
  });
}

export function useBannerMutations() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ['banners'] });
  return {
    create: useMutation({
      mutationFn: async (input: Record<string, unknown>) =>
        (await api.post<{ banner: BannerInfo }>('/banners', input)).data.banner,
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: async ({ id, ...patch }: { id: string } & Record<string, unknown>) =>
        (await api.patch<{ banner: BannerInfo }>(`/banners/${id}`, patch)).data.banner,
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => (await api.delete(`/banners/${id}`)).data,
      onSuccess: invalidate,
    }),
    duplicate: useMutation({
      mutationFn: async (id: string) => (await api.post<{ banner: BannerInfo }>(`/banners/${id}/duplicate`)).data.banner,
      onSuccess: invalidate,
    }),
  };
}

/** Fire-and-forget click log; navigation happens regardless of logging success. */
export function trackBannerClick(id: string): void {
  void api.post(`/banners/${id}/click`).catch(() => {});
}
