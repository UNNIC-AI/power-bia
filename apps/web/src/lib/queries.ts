import type {
  Card,
  ChartType,
  Conversation,
  ConversationWithMessages,
  Dashboard,
  DashboardSummary,
  DatasetConnectionInput,
  DatasetSettingsInput,
  DatasetSummary,
  FilterSelection,
  IntrospectionReport,
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

/**
 * Registers a Power BI connection. The API introspects it before responding, so
 * this is slow — and it resolves even when introspection failed, leaving a
 * dataset whose credentials the admin can correct and re-sync.
 */
export function useCreateDataset() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (input: DatasetConnectionInput) => api.post<DatasetSummary>('/datasets', input),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.datasets }),
  });
}

export function useUpdateDatasetSettings() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...settings }: DatasetSettingsInput & { id: string }) =>
      api.patch<DatasetSummary>(`/datasets/${id}`, settings),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.datasets }),
  });
}

/**
 * Rediscovers the Power BI model. Slow by nature — it issues several DAX queries
 * against the customer's capacity — so the caller shows a pending state rather
 * than assuming it returns quickly.
 */
export function useIntrospectDataset() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.post<IntrospectionReport>(`/datasets/${id}/introspect`),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.datasets }),
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

export function useRenameConversation() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api.patch<Conversation>(`/conversations/${id}`, { title }),
    onSuccess: (conversation) => {
      void client.invalidateQueries({ queryKey: keys.conversations });
      void client.invalidateQueries({ queryKey: keys.conversation(conversation.id) });
    },
  });
}

/** Asks the model for a title from the thread itself, replacing the current one. */
export function useRegenerateConversationTitle() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ id, locale }: { id: string; locale: Locale }) =>
      api.post<Conversation>(`/conversations/${id}/title`, { locale }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.conversations }),
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

export function useRenameDashboard() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      api.patch<DashboardSummary>(`/dashboards/${id}`, { name }),
    onSuccess: (dashboard) => {
      void client.invalidateQueries({ queryKey: keys.dashboards });
      void client.invalidateQueries({ queryKey: keys.dashboard(dashboard.id) });
    },
  });
}

/** The view's counterpart: a name generated from the widgets it holds. */
export function useRegenerateDashboardName() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ id, locale }: { id: string; locale: Locale }) =>
      api.post<DashboardSummary>(`/dashboards/${id}/name`, { locale }),
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
