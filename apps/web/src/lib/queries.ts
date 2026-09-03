import type {
  Card,
  ChangePassword,
  ChartType,
  Conversation,
  ConversationWithMessages,
  CreateUser,
  Dashboard,
  DashboardSummary,
  DatasetSettingsInput,
  DatasetSummary,
  FilterSelection,
  IntrospectionReport,
  Locale,
  QueryResponse,
  SetupState,
  User,
  Widget,
  WidgetLayout,
} from '@powerbia/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api.ts';

export const keys = {
  me: ['me'] as const,
  dataset: ['dataset'] as const,
  conversations: ['conversations'] as const,
  conversation: (id: string) => ['conversations', id] as const,
  dashboards: ['dashboards'] as const,
  dashboard: (id: string) => ['dashboards', id] as const,
  users: ['users'] as const,
  setup: ['setup'] as const,
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

export function useSetupState() {
  return useQuery({
    queryKey: keys.setup,
    queryFn: () => api.get<SetupState>('/auth/setup'),
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Members may change their own password; nothing else about their account. */
export function useChangePassword() {
  return useMutation({
    mutationFn: (body: ChangePassword) => api.post<{ ok: true }>('/auth/password', body),
  });
}

export function useUsers(enabled: boolean) {
  return useQuery({
    queryKey: keys.users,
    queryFn: () => api.get<User[]>('/users'),
    enabled,
  });
}

export function useCreateUser() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateUser) => api.post<User>('/users', body),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.users }),
  });
}

/**
 * Deleting an account takes its conversations and dashboards with it - the FK
 * cascade in the schema - so the caller confirms first.
 */
export function useDeleteUser() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/users/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.users }),
  });
}

export function useResetUserPassword() {
  return useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api.post<{ ok: true }>(`/users/${id}/password`, { password }),
  });
}

export function useLogout() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: () => api.post<{ ok: true }>('/auth/logout'),
    onSuccess: () => client.clear(),
  });
}

/**
 * The model, singular.
 *
 * There is one source and the environment names it, so there is no list and
 * nothing to pick: the server resolves which row that is. A 404 means the
 * instance has no model configured, which the shell renders as its empty state.
 */
export function useDataset() {
  return useQuery({
    queryKey: keys.dataset,
    queryFn: () => api.get<DatasetSummary>('/dataset'),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useUpdateDatasetSettings() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (settings: DatasetSettingsInput) => api.patch<DatasetSummary>('/dataset', settings),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.dataset }),
  });
}

/**
 * Rediscovers the Power BI model. Slow by nature - it issues several DAX queries
 * against the customer's capacity - so the caller shows a pending state rather
 * than assuming it returns quickly. The locale is only used if the model has no
 * context yet, in which case this also writes it.
 */
export function useIntrospectDataset() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ locale }: { locale: Locale }) =>
      api.post<IntrospectionReport>('/dataset/introspect', { locale }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.dataset }),
  });
}

/**
 * Has the assistant read the model and rewrite its context, replacing whatever
 * is stored. Destructive of the admin's own edits, so the caller confirms first.
 */
export function useRegenerateDatasetContext() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: ({ locale }: { locale: Locale }) =>
      api.post<DatasetSummary>('/dataset/context', { locale }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.dataset }),
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
    mutationFn: (body: { name: string }) => api.post<Dashboard>('/dashboards', body),
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
      text: string;
      locale: Locale;
      filters: FilterSelection[];
      // ChartType, not Card['kind']: the API rejects the control kinds
      // (filter, choice, note), which are not chart types.
      forcedChartType: ChartType | null;
    }) => api.post<QueryResponse>('/query', body),
  });
}
