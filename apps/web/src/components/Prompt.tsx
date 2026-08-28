import { IconSend2 } from '@tabler/icons-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  onSubmit: (text: string) => void;
  /** A request is in flight: the field locks and the button shows a spinner. */
  busy?: boolean;
  /** Chat sends a message, a view adds a widget: the caller names its action. */
  icon?: ReactNode;
  label?: string;
}

/** The single question box, shared by the chat and the view screens. */
export function Prompt({ onSubmit, busy = false, icon, label }: Props) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const trimmed = text.trim();

  const submit = () => {
    if (!trimmed || busy) return;

    setText('');
    onSubmit(trimmed);
  };

  return (
    <div className="flex items-end gap-2">
      <textarea
        className="textarea textarea-bordered max-h-40 min-h-11 w-full resize-none rounded-2xl"
        placeholder={t('prompt.placeholder')}
        value={text}
        disabled={busy}
        rows={1}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <button
        type="button"
        className="btn btn-primary btn-circle"
        title={label}
        aria-label={label}
        disabled={busy || !trimmed}
        onClick={submit}
      >
        {busy ? (
          <span className="loading loading-spinner loading-xs" />
        ) : (
          (icon ?? <IconSend2 size={18} stroke={1.75} />)
        )}
      </button>
    </div>
  );
}
