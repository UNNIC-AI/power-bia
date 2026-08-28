import { Collapsible } from 'radix-ui';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Radix `Collapsible` for the `aria-expanded`/`aria-controls` pair on the toggle. */
export function DaxViewer({ dax }: { dax: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className="mt-2">
      <Collapsible.Trigger className="btn btn-ghost btn-xs font-mono">
        {open ? t('chat.hideDax') : t('chat.showDax')}
      </Collapsible.Trigger>
      <Collapsible.Content>
        <pre className="bg-base-200 mt-1 overflow-x-auto rounded-box p-3 text-[11px] leading-relaxed">
          <code>{dax}</code>
        </pre>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
