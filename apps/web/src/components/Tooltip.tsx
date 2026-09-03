import { Tooltip as RadixTooltip } from 'radix-ui';
import type { ReactNode } from 'react';

/*
 * `title` is what the icon buttons used to rely on: a ~1s delay the user cannot
 * see coming, no styling, and nothing at all on touch. Radix shows the same text
 * on hover and on keyboard focus. It is not an accessible name, so every icon
 * button keeps its own `aria-label` - the tooltip is decoration on top.
 */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          sideOffset={4}
          className="bg-neutral text-neutral-content rounded-field z-50 px-2 py-1 text-xs shadow-md"
        >
          {label}
          <RadixTooltip.Arrow className="fill-neutral" />
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}
