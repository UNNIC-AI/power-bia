import type { Card } from '@powerbia/contracts';
import { DEFAULT_WIDGET_SIZE } from '@powerbia/contracts';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '../../components/ConfirmDialog.tsx';
import { ChatPanel } from '../../components/chat/ChatPanel.tsx';
import { Sidebar } from '../../components/Sidebar.tsx';
import { useDataset } from '../../lib/dataset-context.tsx';
import { formatDay } from '../../lib/format.ts';
import {
  useAddWidget,
  useConversation,
  useConversations,
  useDashboards,
  useDeleteConversation,
  useRegenerateConversationTitle,
  useRenameConversation,
} from '../../lib/queries.ts';
import { useActiveLocale } from '../_authed.tsx';

interface PanelState {
  /** Bumped to remount the panel. See the comment in `ChatRoute`. */
  generation: number;
  /** Conversation the mounted panel created, if it has one yet. */
  adopted: string | null;
  /** Last `?c=` this state was reconciled against. */
  seen: string | undefined;
}

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

  const { active } = useDataset();
  const conversations = useConversations();
  const conversation = useConversation(conversationId ?? null);
  const renameConversation = useRenameConversation();
  const regenerateTitle = useRegenerateConversationTitle();
  const deleteConversation = useDeleteConversation();
  const dashboards = useDashboards();

  const firstDashboard = dashboards.data?.[0];
  const addWidget = useAddWidget(firstDashboard?.id ?? '');

  /*
   * The panel is remounted to replay a different conversation's history, which
   * is right for every way of changing conversation but one: a brand-new
   * conversation learns its id from the first frame of its own answer stream.
   * Remounting there tore down the in-flight `useChat`, and the history that
   * replaced it could not contain the answer yet — the API persists the
   * assistant message only once the stream has finished. That was the "answer
   * only shows up after a refresh" bug.
   *
   * So the panel is keyed on a generation that advances on every move of `?c=`
   * except that one. Reconciling here rather than in the navigation helpers is
   * what keeps the browser's own Back and Forward honest — they move the search
   * param without going through `select`.
   */
  const [panel, setPanel] = useState<PanelState>({
    generation: 0,
    adopted: null,
    seen: conversationId,
  });

  let current = panel;
  if (panel.seen !== conversationId) {
    current =
      panel.adopted === conversationId
        ? { ...panel, seen: conversationId }
        : {
            generation: panel.generation + 1,
            adopted: null,
            seen: conversationId,
          };

    setPanel(current);
  }

  /** The mounted panel created this conversation and is still showing it live. */
  const owned = current.adopted !== null && current.adopted === conversationId;

  /** Deleting is irreversible, so the row is held here until it is confirmed. */
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string } | null>(null);

  const datasetId = active?.id;
  if (!datasetId) return null;

  const select = (id: string | undefined) => {
    void navigate({ to: '/chat', search: { c: id } });
  };

  /** Deep-link the conversation the panel just created, without disturbing it. */
  const adopt = (id: string) => {
    if (id === conversationId) return;

    setPanel((previous) => ({ ...previous, adopted: id }));
    void navigate({ to: '/chat', search: { c: id } });
  };

  const confirmDelete = () => {
    if (!pendingDelete) return;

    deleteConversation.mutate(pendingDelete.id);
    if (pendingDelete.id === conversationId) select(undefined);
    setPendingDelete(null);
  };

  const pin = (card: Card, query: string, dax: string | null) => {
    if (!firstDashboard) return;
    const size = DEFAULT_WIDGET_SIZE[card.kind];

    void addWidget.mutateAsync({
      card,
      query: query || null,
      dax,
      layout: { x: 0, y: 0, width: size.width, height: size.height },
    });
  };

  return (
    <div className="flex h-full min-h-0">
      <Sidebar
        items={(conversations.data ?? []).map((entry) => ({
          id: entry.id,
          title: entry.title,
          meta: t('common.updatedOn', { day: formatDay(entry.updatedAt, locale) }),
        }))}
        activeId={conversationId}
        newLabel={t('chat.newQuery')}
        emptyLabel={t('chat.noConversations')}
        onNew={() => select(undefined)}
        onSelect={select}
        onRename={(id, title) => renameConversation.mutate({ id, title })}
        onRegenerate={(id) => regenerateTitle.mutate({ id, locale })}
        pendingId={regenerateTitle.isPending ? regenerateTitle.variables?.id : undefined}
        onDelete={(item) => setPendingDelete({ id: item.id, title: item.title })}
      />

      <section className="min-w-0 flex-1">
        {conversationId && !owned && !conversation.isSuccess ? (
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
             * `owned` is excluded from the spinner above for the same reason the
             * key is pinned: that panel is already showing the live answer.
             */
            key={current.generation}
            datasetId={datasetId}
            locale={locale}
            conversationId={conversationId ?? null}
            history={conversation.data?.messages ?? []}
            onConversationCreated={adopt}
            {...(firstDashboard ? { onPin: pin } : {})}
          />
        )}
      </section>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t('chat.confirmDeleteTitle')}
        body={t('chat.confirmDeleteBody', { title: pendingDelete?.title ?? '' })}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
