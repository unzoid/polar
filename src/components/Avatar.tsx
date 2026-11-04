import { createAvatar, type Style } from "@dicebear/core";
import * as glass from "@dicebear/glass";
import * as notionists from "@dicebear/notionists";
import * as thumbs from "@dicebear/thumbs";
import type { CSSProperties } from "react";
import { avatarDef, type AvatarStyle } from "../lib/account";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const STYLES: Record<AvatarStyle, Style<any>> = { glass, notionists, thumbs };

/** Rendered SVGs by avatar id: each is built once, then reused everywhere. */
const cache = new Map<string, string>();

function avatarUri(id: string) {
  const a = avatarDef(id);
  let uri = cache.get(a.id);
  if (!uri) {
    uri = createAvatar(STYLES[a.style], {
      seed: a.seed,
      // The tile paints the background; the art sits on top of it.
      backgroundColor: ["transparent"],
      ...(a.style === "thumbs" ? { scale: 90, ...(a.ink ? { shapeColor: [a.ink] } : {}) } : {}),
    }).toDataUri();
    cache.set(a.id, uri);
  }
  return uri;
}

/** A profile avatar: a colour tile with DiceBear art. Scales with its box. */
export function Avatar({ id, className, style }: { id: string; className?: string; style?: CSSProperties }) {
  const a = avatarDef(id);
  return (
    <span
      className={className ? `avatar ${className}` : "avatar"}
      data-style={a.style}
      style={{ ...style, "--avatar-from": a.from, "--avatar-to": a.to } as CSSProperties}
      aria-hidden
    >
      <img src={avatarUri(id)} alt="" draggable={false} />
    </span>
  );
}
