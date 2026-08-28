import type {
  Card,
  ChartType,
  Conversation,
  ConversationWithMessages,
  Dashboard,
  DashboardSummary,
  DatasetSummary,
  FilterSelection,
  Locale,
  QueryResponse,
  User,
  Widget,
  WidgetLayout,
} from '@powerbia/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api.ts';

export const keys = {
  me: ['me'] as const,
  datasets: ['datasets'] as const,
  conversations: ['conversations'] as const,
  conversation: (id: string) => ['conversations', id] as const,
  dashboards: ['dashboards'] as const,
  dashboard: (id: string) => ['dashboards', id] as const,
};

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: () => api.get<User>('/auth/me'),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useLogin() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (body: { email: string; password: string }) => api.post<User>('/auth/login', body),
    onSuccess: (user) => client.setQueryData(keys.me, user),
  });
}

export function useRegister() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (body: { email: string; password: string; displayName: string }) =>
      api.post<User>('/auth/register', body),
    onSuccess: (user) => client.setQueryData(keys.me, user),
  });
}

export function useLogout() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: () => api.post<{ ok: true }>('/auth/logout'),
    onSuccess: () => client.clear(),
  });
}

export function useDatasets() {
  return useQuery({
    queryKey: keys.datasets,
    queryFn: () => api.get<DatasetSummary[]>('/datasets'),
    staleTime: 5 * 60_000,
  });
}

export function useConversations() {
  return useQuery({
    queryKey: keys.conversations,
    queryFn: () => api.get<Conversation[]>('/conversations'),
  });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: keys.conversation(id ?? 'none'),
    queryFn: () => api.get<ConversationWithMessages>(`/conversations/${id}`),
    enabled: Boolean(id),
  });
}

export function useDeleteConversation() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/conversations/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.conversations }),
  });
}

export function useDashboards() {
  return useQuery({
    queryKey: keys.dashboards,
    queryFn: () => api.get<DashboardSummary[]>('/dashboards'),
  });
}

export function useDashboard(id: string | null) {
  return useQuery({
    queryKey: keys.dashboard(id ?? 'none'),
    queryFn: () => api.get<Dashboard>(`/dashboards/${id}`),
    enabled: Boolean(id),
  });
}

export function useCreateDashboard() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (body: { name: string; datasetId: string }) =>
      api.post<Dashboard>('/dashboards', body),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.dashboards }),
  });
}

export function useDeleteDashboard() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/dashboards/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.dashboards }),
  });
}

export function useAddWidget(dashboardId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (body: {
      card: Card;
      query: string | null;
      dax: string | null;
      layout: WidgetLayout;
    }) => api.post<Widget>(`/dashboards/${dashboardId}/widgets`, body),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.dashboard(dashboardId) });
      void client.invalidateQueries({ queryKey: keys.dashboards });
    },
  });
}

export function useUpdateWidget(dashboardId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({
      widgetId,
      ...body
    }: { widgetId: string } & Partial<Pick<Widget, 'card' | 'query' | 'dax' | 'pinned'>>) =>
      api.patch<Widget>(`/dashboards/${dashboardId}/widgets/${widgetId}`, body),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.dashboard(dashboardId) }),
  });
}

export function useRemoveWidget(dashboardId: string) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (widgetId: string) =>
      api.delete<{ ok: true }>(`/dashboards/${dashboardId}/widgets/${widgetId}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: keys.dashboard(dashboardId) });
      void client.invalidateQueries({ queryKey: keys.dashboards });
    },
  });
}

/** Batched per gesture; the cache is not invalidated because the grid already moved. */
export function useSaveLayouts(dashboardId: string) {
  return useMutation({
    mutationFn: (layouts: (WidgetLayout & { id: string })[]) =>
      api.put<{ ok: true }>(`/dashboards/${dashboardId}/layouts`, { layouts }),
  });
}

/** Non-streaming query used by widget refresh and inline widget editing. */
export function useRunQuery() {
  return useMutation({
    mutationFn: (body: {
      datasetId: string;
      text: string;
      locale: Locale;
      filters: FilterSelection[];
      // ChartType, not Card['kind']: the API rejects the control kinds
      // (filter, choice, note), which are not chart types.
      forcedChartType: ChartType | null;
    }) => api.post<QueryResponse>('/query', body),
  });
}
