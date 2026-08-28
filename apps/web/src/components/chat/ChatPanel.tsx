import { useChat } from '@ai-sdk/react';
import type { Card, CardPart, Locale, Message } from '@powerbia/contracts';
import { IconPin } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { keys } from '../../lib/queries.ts';
import { CardPanel } from '../cards/CardView.tsx';
import { Prompt } from '../Prompt.tsx';
import { Tooltip } from '../Tooltip.tsx';
import { DaxViewer } from './DaxViewer.tsx';

export type ChatUIMessage = UIMessage<
  never,
  { card: CardPart; conversation: { conversationId: string } }
>;

function textOf(message: ChatUIMessage): string {
  return message.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

function cardOf(message: ChatUIMessage): CardPart | null {
  for (const part of message.parts) {
    if (part.type === 'data-card') return part.data;
  }

  return null;
}

/** Persisted history is replayed into the same shape the live stream produces. */
function toUIMessages(messages: readonly Message[]): ChatUIMessage[] {
  return messages.map((message) => {
    const parts: ChatUIMessage['parts'] = [{ type: 'text', text: message.text }];

    if (message.card) {
      parts.push({
        type: 'data-card',
        id: 'card',
        data: { card: message.card, dax: message.dax, followUps: [] },
      });
    }

    return { id: message.id, role: message.role, parts };
  });
}

interface Props {
  datasetId: string;
  locale: Locale;
  conversationId: string | null;
  history: readonly Message[];
  onConversationCreated: (id: string) => void;
  onPin?: (card: Card, query: string, dax: string | null) => void;
}

export function ChatPanel({
  datasetId,
  locale,
  conversationId,
  history,
  onConversationCreated,
  onPin,
}: Props) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const bottom = useRef<HTMLDivElement>(null);

  const initialMessages = useMemo(() => toUIMessages(history), [history]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport<ChatUIMessage>({
        api: '/api/chat',
        credentials: 'same-origin',
        body: () => ({ datasetId, locale, conversationId, filters: [], forcedChartType: null }),
        // The API takes a single question, not the AI SDK's message array.
        prepareSendMessagesRequest: ({ messages, body }) => {
          const last = messages.at(-1);
          const text = last ? textOf(last) : '';

          return { body: { ...body, text } };
        },
      }),
    [datasetId, locale, conversationId],
  );

  const { messages, sendMessage, status, error } = useChat<ChatUIMessage>({
    messages: initialMessages,
    transport,
    onData: (part) => {
      if (part.type === 'data-conversation') onConversationCreated(part.data.conversationId);
    },
    onFinish: () => {
      void client.invalidateQueries({ queryKey: keys.conversations });
      bottom.current?.scrollIntoView({ behavior: 'smooth' });
    },
  });

  const busy = status === 'submitted' || status === 'streaming';

  /*
   * Sending pulls the new question — and the thinking indicator under it — into
   * view. Keyed on the number of questions rather than on `messages` so that the
   * streaming answer does not yank the viewport on every token, and seeded with
   * the mount-time count so replaying a conversation's history does not scroll.
   */
  const questionCount = messages.reduce(
    (count, message) => (message.role === 'user' ? count + 1 : count),
    0,
  );
  const scrolledFor = useRef(questionCount);

  useEffect(() => {
    if (scrolledFor.current === questionCount) return;

    scrolledFor.current = questionCount;
    bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [questionCount]);

  /*
   * The question each answer came from — the user turn just before it. Pinning
   * used to attach whatever was typed last, which was wrong for every card but
   * the newest one, and empty for a conversation replayed from history.
   */
  const questionFor = useMemo(() => {
    const questions = new Map<string, string>();
    let question = '';

    for (const message of messages) {
      if (message.role === 'user') question = textOf(message);
      else questions.set(message.id, question);
    }

    return questions;
  }, [messages]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;

      void sendMessage({ text: trimmed });
    },
    [busy, sendMessage],
  );

  const starters = t('chat.starters', { returnObjects: true }) as string[];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="mx-auto max-w-xl py-12 text-center">
            <h2 className="text-lg font-semibold">{t('chat.emptyTitle')}</h2>
            <p className="text-base-content/60 mt-2 text-sm">{t('chat.emptyBody')}</p>
            <div className="mt-6 flex flex-col gap-2">
              {starters.map((starter) => (
                <button
                  key={starter}
                  type="button"
                  className="btn btn-outline btn-sm justify-start font-normal"
                  onClick={() => send(starter)}
                >
                  {starter}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => {
          const body = textOf(message);
          const payload = cardOf(message);

          if (message.role === 'user') {
            return (
              <div key={message.id} className="chat chat-end">
                <div className="chat-bubble chat-bubble-primary whitespace-pre-wrap">{body}</div>
              </div>
            );
          }

          return (
            <div key={message.id} className="space-y-2">
              {body && (
                <div className="chat chat-start">
                  <div className="chat-bubble whitespace-pre-wrap">{body}</div>
                </div>
              )}

              {payload?.card && (
                <div className="max-w-3xl">
                  <CardPanel
                    card={payload.card}
                    locale={locale}
                    onChoice={(_id, label) => send(label)}
                    actions={
                      onPin && payload.card.kind !== 'choice' ? (
                        <Tooltip label={t('chat.pinToDashboard')}>
                          <button
                            type="button"
                            className="btn btn-ghost btn-square btn-xs"
                            aria-label={t('chat.pinToDashboard')}
                            onClick={() => {
                              if (payload.card)
                                onPin(payload.card, questionFor.get(message.id) ?? '', payload.dax);
                            }}
                          >
                            <IconPin size={16} stroke={1.75} />
                          </button>
                        </Tooltip>
                      ) : undefined
                    }
                  />
                  {payload.dax && <DaxViewer dax={payload.dax} />}
                </div>
              )}
            </div>
          );
        })}

        {busy && (
          <div className="chat chat-start">
            <div className="chat-bubble">
              <span className="loading loading-dots loading-sm" />
            </div>
          </div>
        )}

        {error && (
          <div role="alert" className="alert alert-error">
            <span>{error.message}</span>
          </div>
        )}

        <div ref={bottom} />
      </div>

      <Prompt onSubmit={send} busy={busy} label={t('chat.send')} />
    </div>
  );
}
