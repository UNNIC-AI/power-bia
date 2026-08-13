import { useChat } from '@ai-sdk/react';
import type { Card, CardPart, Locale, Message } from '@powerbia/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keys } from '../../lib/queries.ts';
import { CardPanel } from '../cards/CardView.tsx';
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
  onPin?: (card: Card, query: string) => void;
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
  const [input, setInput] = useState('');
  const lastQuestion = useRef('');
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

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;

      lastQuestion.current = trimmed;
      setInput('');
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
                        <button
                          type="button"
                          className="btn btn-ghost btn-xs"
                          title={t('chat.pinToDashboard')}
                          onClick={() => {
                            if (payload.card) onPin(payload.card, lastQuestion.current);
                          }}
                        >
                          📌
                        </button>
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

      <div className="border-base-300 shrink-0 border-t p-4">
        <div className="flex items-end gap-2">
          <textarea
            className="textarea textarea-bordered max-h-40 min-h-12 w-full resize-none"
            placeholder={t('chat.placeholder')}
            value={input}
            disabled={busy}
            rows={1}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                send(input);
              }
            }}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !input.trim()}
            onClick={() => send(input)}
          >
            →
          </button>
        </div>
        <p className="text-base-content/50 mt-1 text-[11px]">{t('chat.hint')}</p>
      </div>
    </div>
  );
}
