import { IconSend2 } from '@tabler/icons-react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Past this the field scrolls instead of pushing the conversation off screen. */
const MAX_ROWS = 6;

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
  const field = useRef<HTMLTextAreaElement>(null);
  const trimmed = text.trim();

  /*
   * Grow with the text, up to MAX_ROWS. Measured rather than guessed: the height
   * is read back from the element's own `scrollHeight` after being released, so
   * wrapped lines count the same as typed ones. In a layout effect so the new
   * height is painted in the same frame as the character that caused it.
   */
  useLayoutEffect(() => {
    const element = field.current;
    if (!element) return;

    const style = getComputedStyle(element);
    const lineHeight = Number.parseFloat(style.lineHeight);
    const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    // `box-sizing: border-box` is global here, so the height set below includes
    // borders while `scrollHeight` does not.
    const borders = element.offsetHeight - element.clientHeight;

    element.style.height = 'auto';
    element.style.height = `${Math.min(
      element.scrollHeight + borders,
      lineHeight * MAX_ROWS + padding + borders,
    )}px`;
  }, [text]);

  const submit = () => {
    if (!trimmed || busy) return;

    setText('');
    onSubmit(trimmed);
  };

  return (
    /*
     * The footer band belongs to the prompt, not to the screens around it. When
     * each screen supplied its own, chat's padding and the view's differed and
     * the box jumped a few pixels as you switched tabs.
     *
     * `items-end` keeps the button on the last line as the field grows.
     */
    <div className="border-base-300 flex shrink-0 items-end gap-2 border-t p-3 print:hidden">
      <textarea
        ref={field}
        /*
         * `content-center` centres the single line inside the box: the field is
         * 44px tall for the button beside it, which leaves 5px of slack around a
         * 21px line, and a textarea puts all of it under the text by default.
         */
        className="textarea textarea-bordered min-h-11 w-full resize-none content-center"
        placeholder={t('prompt.placeholder')}
        value={text}
        disabled={busy}
        rows={1}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          // Shift+Enter is a newline; Enter alone sends.
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
