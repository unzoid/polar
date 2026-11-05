import { Popover as Base } from "@base-ui/react/popover";
import type { ComponentProps, ReactNode } from "react";

/**
 * A panel that opens from a button and holds more than a list of commands: the playlist checklist, the
 * source filters (docs/ui-components.md U9). For a list of commands use `Menu`. Base UI's Popover in a
 * portal above everything (`.select-positioner`); the panel's look comes from `className`, since the two
 * in use draw different surfaces (`.playlist-menu` glass, `.srcf-popover` frosted).
 */
export const PopoverRoot = Base.Root;
export const PopoverTrigger = Base.Trigger;

type Positioning = Pick<ComponentProps<typeof Base.Positioner>, "side" | "align" | "sideOffset" | "alignOffset" | "collisionPadding">;

export type PopoverPopupProps = Positioning & {
  className: string;
  "aria-label"?: string;
  children: ReactNode;
};

export function PopoverPopup({ className, "aria-label": label, children, ...positioning }: PopoverPopupProps) {
  return (
    <Base.Portal>
      <Base.Positioner className="select-positioner" {...positioning}>
        <Base.Popup className={className} aria-label={label}>
          {children}
        </Base.Popup>
      </Base.Positioner>
    </Base.Portal>
  );
}
