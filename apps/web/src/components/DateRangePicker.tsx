import type { Locale } from '@powerbia/contracts';
import { IconCalendar } from '@tabler/icons-react';
import { Popover } from 'radix-ui';
import { useState } from 'react';
import { type DateRange, DayPicker } from 'react-day-picker';
import { enUS, es } from 'react-day-picker/locale';
import { useTranslation } from 'react-i18next';
import { formatDay } from '../lib/format.ts';

interface Props {
  min: string;
  max: string;
  onChange: (range: { min: string; max: string }) => void;
  locale: Locale;
}

const LOCALES = { es, en: enUS };

/** A model's span can cover decades, so the caption dropdowns need real room. */
const FIRST_YEAR = 2000;
const LAST_YEAR = new Date().getFullYear() + 1;

/** `Date` in the local timezone from a plain `YYYY-MM-DD`, and back. */
function toDate(iso: string): Date | undefined {
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return undefined;

  return new Date(year, month - 1, day);
}

function toIso(date: Date): string {
  /*
   * Built from local parts rather than `toISOString`, which converts to UTC and
   * shifts the date by a day for anyone behind Greenwich.
   */
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The dataset's real date span. Introspection derives it from the model, so this
 * is a correction, not a routine edit — hence a popover rather than a calendar
 * permanently occupying half the dialog.
 *
 * Styling comes from DaisyUI's `.react-day-picker` class, which covers the range
 * and caption-dropdown parts too; the library's own stylesheet is not imported.
 */
export function DateRangePicker({ min, max, onChange, locale }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const from = toDate(min);
  const to = toDate(max);
  /*
   * Spread conditionally rather than passed as `undefined`: the workspace runs
   * with `exactOptionalPropertyTypes`, which rejects an explicit undefined on an
   * optional prop.
   */
  const range: DateRange | undefined = from ? { from, ...(to ? { to } : {}) } : undefined;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="btn btn-sm justify-start font-normal">
          <IconCalendar size={14} stroke={1.75} />
          {min && max ? (
            <>
              {formatDay(min, locale)}
              <span className="text-base-content/40">→</span>
              {formatDay(max, locale)}
            </>
          ) : (
            t('settings.dateRange')
          )}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        {/*
          Only positioning and stacking here: `.react-day-picker` already carries
          the surface — background, border and radius. z-[60] because this opens on
          top of the settings dialog, whose content sits at z-50.
        */}
        <Popover.Content align="start" sideOffset={4} className="z-[60]">
          <DayPicker
            className="react-day-picker shadow-xl"
            mode="range"
            {...(range ? { selected: range } : {})}
            onSelect={(next) => {
              if (!next?.from || !next.to) return;

              onChange({ min: toIso(next.from), max: toIso(next.to) });
            }}
            // A decade-wide span is unreachable by paging month by month.
            captionLayout="dropdown"
            startMonth={new Date(FIRST_YEAR, 0)}
            endMonth={new Date(LAST_YEAR, 11)}
            {...(from ? { defaultMonth: from } : {})}
            locale={LOCALES[locale]}
            weekStartsOn={1}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
