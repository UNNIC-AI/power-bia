import type { Card } from '@powerbia/contracts';
import { DEFAULT_WIDGET_SIZE } from '@powerbia/contracts';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ChatPanel } from '../../components/chat/ChatPanel.tsx';
import { formatDay } from '../../lib/format.ts';
import {
  useAddWidget,
  useConversation,
  useConversations,
  useDashboards,
  useDatasets,
  useDeleteConversation,
} from '../../lib/queries.ts';
import { useActiveLocale } from '../_authed.tsx';

export const Route = createFileRoute('/_authed/chat')({
  validateSearch: (search: Record<string, unknown>) => ({
    c: typeof search.c === 'string' ? search.c : undefined,
  }),
  component: ChatRoute,
});

function ChatRoute() {
  const { t } = useTranslation();
  const locale = useActiveLocale();
  const navigate = useNavigate();
  const { c: conversationId } = Route.useSearch();

  const datasets = useDatasets();
  const conversations = useConversations();
  const conversation = useConversation(conversationId ?? null);
  const deleteConversation = useDeleteConversation();
  const dashboards = useDashboards();

  const firstDashboard = dashboards.data?.[0];
  const addWidget = useAddWidget(firstDashboard?.id ?? '');

  const datasetId = datasets.data?.[0]?.id;
  if (!datasetId) return null;

  const select = (id: string | undefined) => {
    void navigate({ to: '/chat', search: { c: id } });
  };

  const pin = (card: Card, query: string) => {
    if (!firstDashboard) return;
    const size = DEFAULT_WIDGET_SIZE[card.kind];

    void addWidget.mutateAsync({
      card,
      query: query || null,
      layout: { x: 0, y: 0, width: size.width, height: size.height },
    });
  };

  return (
    <div className="flex h-full min-h-0">
      <aside className="bg-base-100 border-base-300 hidden w-64 shrink-0 flex-col border-r md:flex">
        <div className="p-3">
          <button
            type="button"
            className="btn btn-primary btn-sm w-full"
            onClick={() => select(undefined)}
          >
            {t('chat.newQuery')}
          </button>
        </div>

        <ul className="menu menu-sm min-h-0 flex-1 flex-nowrap overflow-y-auto">
          {conversations.data?.length === 0 && (
            <li className="text-base-content/50 px-3 py-2 text-xs">{t('chat.noConversations')}</li>
          )}
          {conversations.data?.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className={entry.id === conversationId ? 'menu-active' : ''}
                onClick={() => select(entry.id)}
              >
                <span className="flex-1 truncate text-left" title={entry.title}>
                  {entry.title}
                </span>
                <span className="text-base-content/40 text-[10px]">
                  {formatDay(entry.updatedAt, locale)}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-xs"
                  title={t('chat.delete')}
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteConversation.mutate(entry.id);
                    if (entry.id === conversationId) select(undefined);
                  }}
                >
                  ×
                </button>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="min-w-0 flex-1">
        {conversationId && !conversation.isSuccess ? (
          <div className="flex h-full items-center justify-center">
            <span className="loading loading-spinner" />
          </div>
        ) : (
          <ChatPanel
            /*
             * Remounting on conversation change replays that conversation's
             * history. useChat reads `messages` only when it initialises, so the
             * panel must not mount until the history has actually arrived —
             * otherwise it initialises empty and the messages never appear.
             */
            key={conversationId ?? 'new'}
            datasetId={datasetId}
            locale={locale}
            conversationId={conversationId ?? null}
            history={conversation.data?.messages ?? []}
            onConversationCreated={(id) => {
              if (id !== conversationId) select(id);
            }}
            {...(firstDashboard ? { onPin: pin } : {})}
          />
        )}
      </section>
    </div>
  );
}
