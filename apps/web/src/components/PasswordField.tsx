import { IconEye, IconEyeClosed } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  label: string;
  value: string;
  autoComplete: 'current-password' | 'new-password';
  /** Only the forms that set a *new* password enforce the 12-character floor. */
  minLength?: number | undefined;
  onChange: (value: string) => void;
}

/**
 * A password input with a reveal toggle. The button is a sibling of the label,
 * not a child: a `<label>` forwards clicks to its control, and interactive
 * content inside one is invalid anyway. `.floating-label` is already
 * `position: relative`, but it is also a flex container, hence the wrapper.
 */
export function PasswordField({ label, value, autoComplete, minLength, onChange }: Props) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);
  const toggleLabel = revealed ? t('auth.hidePassword') : t('auth.showPassword');

  return (
    <div className="relative">
      <label className="floating-label">
        <span>{label}</span>
        <input
          type={revealed ? 'text' : 'password'}
          autoComplete={autoComplete}
          className="input input-bordered w-full pe-11"
          value={value}
          required
          minLength={minLength}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      <button
        type="button"
        className="btn btn-ghost btn-sm btn-circle absolute inset-y-0 end-1 my-auto"
        title={toggleLabel}
        aria-label={toggleLabel}
        aria-pressed={revealed}
        onClick={() => setRevealed(!revealed)}
      >
        {revealed ? <IconEyeClosed size={18} stroke={1.75} /> : <IconEye size={18} stroke={1.75} />}
      </button>
    </div>
  );
}
