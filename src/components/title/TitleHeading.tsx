import { TitleLogo } from "../TitleLogo";

/** Where the heading sits; names its classes (`hero-logo` / `hero-title` and so on), so each layout keeps its CSS. */
export type HeadingLook = "hero" | "detail" | "tv-stage" | "tv-detail" | "tv-panel";

/**
 * A title's name at the top of a hero or title page (docs/ui-components.md U4): its logo when it has one,
 * else the name as the heading. The facts line and synopsis under it stay with each layout, built with
 * `joinFacts`/`kindFacts` from lib/format.
 */
export function TitleHeading({ name, logo, look }: { name: string; logo?: string; look: HeadingLook }) {
  // The panel's heading is a side heading (h2) and its logo isn't in the first screenful.
  const panel = look === "tv-panel";
  if (logo) return <TitleLogo src={logo} alt={name} className={`${look}-logo`} loading={panel ? undefined : "eager"} />;
  if (panel) return <h2 className={`${look}-title`}>{name}</h2>;
  // The desktop layouts set the display type style; TV's own classes size theirs.
  return <h1 className={look.startsWith("tv-") ? `${look}-title` : `t-display ${look}-title`}>{name}</h1>;
}
