import { DropdownMenu } from 'radix-ui';
import type { ReactNode } from 'react';

/*
 * DaisyUI's own dropdown is CSS-only: it opens on `:focus-within`, which means
 * no roving focus, no Esc, no typeahead and no way to close it from an item's
 * handler. Radix brings all of that; the look stays DaisyUI's, applied to the
 * primitive's parts. Items are divs, so they are styled directly rather than
 * through `menu li`, whose selectors expect anchors.
 */

const ITEM_CLASS =
  'flex cursor-pointer items-center gap-2 rounded-field px-2 py-1.5 text-sm outline-none select-none data-[highlighted]:bg-base-200 data-[disabled]:pointer-events-none data-[disabled]:opacity-50';

interface MenuProps {
  /** Accessible name, for the triggers that are icon-only. */
  label?: string;
  trigger: ReactNode;
  /** Non-interactive line above the items: what this menu is about. */
  header?: ReactNode;
  children: ReactNode;
  align?: 'start' | 'end';
}

export function Menu({ label, trigger, header, children, align = 'end' }: MenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild {...(label ? { 'aria-label': label } : {})}>
        {trigger}
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align={align}
          sideOffset={4}
          className="bg-base-100 border-base-300 rounded-box z-50 min-w-44 border p-1 shadow-lg"
        >
          {header && (
            <>
              <DropdownMenu.Label className="text-base-content/50 px-2 py-1 text-[11px]">
                {header}
              </DropdownMenu.Label>
              <DropdownMenu.Separator className="bg-base-300 my-1 h-px" />
            </>
          )}

          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="bg-base-300 my-1 h-px" />;
}

interface MenuItemProps {
  onSelect: () => void;
  children: ReactNode;
  /** Destructive items are tinted; the confirmation still happens upstream. */
  destructive?: boolean;
}

export function MenuItem({ onSelect, children, destructive }: MenuItemProps) {
  return (
    <DropdownMenu.Item
      className={
        destructive ? `${ITEM_CLASS} text-error data-[highlighted]:bg-error/10` : ITEM_CLASS
      }
      onSelect={onSelect}
    >
      {children}
    </DropdownMenu.Item>
  );
}
