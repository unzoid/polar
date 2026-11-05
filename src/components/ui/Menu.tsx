import { Menu as Base } from "@base-ui/react/menu";
import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import { Check, ChevronRight } from "../icons";

/**
 * Popup menus (docs/ui-components.md U9) on Base UI's Menu, with one surface. Two looks:
 * - `compact` (default): the native macOS menu, 24px rows, text in a span that ellipsizes: a title's
 *   right-click menu, the download menu.
 * - `roomy`: taller rows with room for an avatar: the profile menu, the navbar's "More".
 * Styling in styles/ui/menu.css. Use `MenuRoot` and `MenuTrigger` (Base UI's own) around `MenuPopup`.
 */
export type MenuLook = "compact" | "roomy";

const LookContext = createContext<MenuLook>("compact");

export const MenuRoot = Base.Root;
export const MenuTrigger = Base.Trigger;

type Positioning = Pick<ComponentProps<typeof Base.Positioner>, "anchor" | "side" | "align" | "sideOffset" | "alignOffset" | "collisionPadding">;

export type MenuPopupProps = Positioning & {
  look?: MenuLook;
  "aria-label"?: string;
  children: ReactNode;
};

/** The floating panel, in a portal above everything (`.select-positioner`). */
export function MenuPopup({ look = "compact", "aria-label": label, children, ...positioning }: MenuPopupProps) {
  return (
    <Base.Portal>
      <Base.Positioner className="select-positioner" {...positioning}>
        <Base.Popup className={`menu menu-${look}`} aria-label={label}>
          <LookContext.Provider value={look}>{children}</LookContext.Provider>
        </Base.Popup>
      </Base.Positioner>
    </Base.Portal>
  );
}

/** A small secondary header: what the menu is about (a title and its episode). */
export function MenuHeader({ title, detail }: { title: ReactNode; detail?: ReactNode }) {
  return (
    <div className="menu-head">
      <strong>{title}</strong>
      {detail && <span>{detail}</span>}
    </div>
  );
}

export type MenuItemProps = {
  /** A 15px glyph (compact) or an 18px icon / avatar (roomy) before the label. */
  icon?: ReactNode;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
};

export function MenuItem({ icon, children, onClick, disabled }: MenuItemProps) {
  const look = useContext(LookContext);
  if (look === "roomy") {
    return (
      <Base.Item className="menu-roomy-item" disabled={disabled} onClick={onClick}>
        {icon}
        {children}
      </Base.Item>
    );
  }
  return (
    <Base.Item className="menu-item" disabled={disabled} onClick={onClick}>
      {icon}
      <span>{children}</span>
    </Base.Item>
  );
}

/** A row that toggles and stays open (compact look): a check, the label, a count at the end. */
export function MenuCheckItem({
  checked,
  onCheckedChange,
  children,
  meta,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  children: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <Base.CheckboxItem className="menu-item" checked={checked} closeOnClick={false} onCheckedChange={onCheckedChange}>
      <span className="menu-check">{checked && <Check />}</span>
      <span>{children}</span>
      {meta != null && <span className="menu-meta tabular">{meta}</span>}
    </Base.CheckboxItem>
  );
}

/** A thin rule between groups. A leading or doubled one hides itself, so groups can be conditional. */
export function MenuSeparator() {
  return <Base.Separator className="menu-sep" />;
}

/** A row that opens a second menu beside it (compact look). */
export function MenuSub({ icon, label, children }: { icon?: ReactNode; label: ReactNode; children: ReactNode }) {
  return (
    <Base.SubmenuRoot>
      <Base.SubmenuTrigger className="menu-item">
        {icon}
        <span>{label}</span>
        <ChevronRight className="menu-chevron" />
      </Base.SubmenuTrigger>
      <MenuPopup sideOffset={0} alignOffset={-5} collisionPadding={12}>
        {children}
      </MenuPopup>
    </Base.SubmenuRoot>
  );
}
