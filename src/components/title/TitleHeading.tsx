import { useState } from "react";
import { TitleLogo } from "../TitleLogo";

/** Where the heading sits; names its classes (`hero-logo` / `hero-title` and so on), so each layout keeps its CSS. */
export type HeadingLook = "hero" | "detail" | "tv-stage" | "tv-detail" | "tv-panel";

/**
 * A title's name at the top of a hero or title page (docs/ui-components.md U4): its logo when it has one,
 * else (or when it doesn't load) the name as the heading. The facts line and synopsis under it stay with each layout, built with
 * `joinFacts`/`kindFacts` from lib/format. Inside a `useArtGate` element the logo or name waits for the art (`art-after`).
 */
export function TitleHeading({ name, logo, look }: { name: string; logo?: string; look: HeadingLook }) {
  // The panel's heading is a side heading (h2) and its logo isn't in the first screenful.
  const panel = look === "tv-panel";
  // A logo that doesn't load (a new title the art host has nothing for yet) leaves the name, never nothing (test report 1, item 10).
  const [failed, setFailed] = useState<string>();
  if (logo && failed !== logo)
    return <TitleLogo src={logo} alt={name} className={`${look}-logo art-after`} loading={panel ? undefined : "eager"} onFail={() => setFailed(logo)} />;
  if (panel) return <h2 className={`${look}-title art-after`}>{name}</h2>;
  // The desktop layouts set the display type style; TV's own classes size theirs.
  return (
    <h1 className={look.startsWith("tv-") ? `${look}-title art-after` : `t-display ${look}-title art-after`} title={name}>
      {name}
    </h1>
  );
}
