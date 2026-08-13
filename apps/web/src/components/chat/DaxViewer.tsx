import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export function DaxViewer({ dax }: { dax: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2">
      <button
        type="button"
        className="btn btn-ghost btn-xs font-mono"
        onClick={() => setOpen(!open)}
      >
        {open ? t('chat.hideDax') : t('chat.showDax')}
      </button>
      {open && (
        <pre className="bg-base-200 mt-1 overflow-x-auto rounded-box p-3 text-[11px] leading-relaxed">
          <code>{dax}</code>
        </pre>
      )}
    </div>
  );
}
