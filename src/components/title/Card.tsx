import { useState, type HTMLAttributes, type KeyboardEvent, type ReactNode } from "react";
import { Img } from "../Img";
import { TitleLogo } from "../TitleLogo";
import { Skeleton } from "../ui/Skeleton";

export type CardShape = "poster" | "landscape";

type CardProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  shape: CardShape;
  /** The picture. When it's missing or doesn't load, `fallback` takes its place. */
  art?: string;
  fallback?: ReactNode;
  /** Extra class on the frame (`anime-card-frame`, `card-frame-resume`). */
  frameClass?: string;
  /** Drawn over the art, in order: scrim, title on the art, badges, progress. */
  children?: ReactNode;
  /**
   * Buttons on the art (Continue Watching's resume). A button can't sit inside a button, so with actions the card
   * is a focusable `role="link"` that opens on Enter and Space instead.
   */
  actions?: ReactNode;
  title: ReactNode;
  /** The caption's second line (year, facts, download state). */
  detail?: ReactNode;
  /** Digits in the detail at one width (default on). */
  tabular?: boolean;
  /** Keeps the caption when Settings hides card titles and details (it's what you're watching, not a description). */
  keepCaption?: boolean;
  /** After the caption, inside the card (the rating under a poster). */
  trailing?: ReactNode;
  /** The title's tooltip; `title` is the caption. */
  hint?: string;
};

/**
 * A title card (docs/ui-components.md U1): art in a 2:3 or 16:9 frame with what goes on it, and the caption
 * under it. Callers add the opening, intent and menu handlers. The `card-*` classes are in styles/cards.css.
 */
export function Card({
  shape,
  art,
  fallback,
  frameClass,
  children,
  actions,
  title,
  detail,
  tabular = true,
  keepCaption,
  trailing,
  hint,
  className,
  ...root
}: CardProps) {
  const body = (
    <>
      <div className={frameClass ? `card-frame ${frameClass}` : "card-frame"}>
        <CardArt src={art} fallback={fallback} />
        {children}
        {actions}
      </div>
      <div className={keepCaption ? "card-caption card-caption-keep" : "card-caption"}>
        <span className="card-title t-callout">{title}</span>
        {detail != null && <span className={tabular ? "t-caption faint tabular" : "t-caption faint"}>{detail}</span>}
      </div>
      {trailing}
    </>
  );
  const cls = `card card-${shape}${className ? ` ${className}` : ""}`;
  if (!actions)
    return (
      <button className={cls} title={hint} {...root}>
        {body}
      </button>
    );
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    root.onKeyDown?.(e);
    if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      e.currentTarget.click();
    }
  };
  return (
    <div className={cls} role="link" tabIndex={0} title={hint} {...root} onKeyDown={onKeyDown}>
      {body}
    </div>
  );
}

/** The art, or `fallback` while there's none or it failed to load; a new `src` gets a fresh try. */
function CardArt({ src, fallback }: { src?: string; fallback?: ReactNode }) {
  const [failed, setFailed] = useState<string>();
  const shown = src && failed !== src ? src : undefined;
  return (
    <>
      {shown && <Img src={shown} alt="" className="card-img" onError={() => setFailed(shown)} />}
      {!shown && fallback}
    </>
  );
}

/** The scrim and the title on landscape art: the logo when there is one, else the name. */
export function ArtTitle({ name, logo }: { name: string; logo?: string }) {
  return (
    <>
      <div className="card-art-scrim" />
      {logo ? <TitleLogo src={logo} alt={name} className="card-logo" /> : <span className="card-art-title t-title2">{name}</span>}
    </>
  );
}

/** A stripe along the bottom of the art for how far in you are (0–1). */
export function ProgressBar({ fraction }: { fraction: number }) {
  return (
    <div className="progress-track">
      <div className="progress-fill" style={{ transform: `scaleX(${fraction})` }} />
    </div>
  );
}

export function CardSkeleton({ shape = "poster" }: { shape?: CardShape }) {
  return (
    <div className={`card card-${shape}`} aria-hidden>
      <Skeleton className="card-frame" />
      <div className="card-caption">
        <Skeleton shape="line" width="70%" />
      </div>
    </div>
  );
}
