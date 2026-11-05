import { createAvatar, type Style } from "@dicebear/core";
import * as glass from "@dicebear/glass";
import * as notionists from "@dicebear/notionists";
import * as thumbs from "@dicebear/thumbs";
import { avatarDef, type AvatarStyle } from "../lib/account";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const STYLES: Record<AvatarStyle, Style<any>> = { glass, notionists, thumbs };

/** An avatar's DiceBear art as a data URI. Its own chunk: DiceBear is a large part of the app's code. */
export function avatarArt(id: string) {
  const a = avatarDef(id);
  return createAvatar(STYLES[a.style], {
    seed: a.seed,
    // The tile paints the background; the art sits on top of it.
    backgroundColor: ["transparent"],
    ...(a.style === "thumbs" ? { scale: 90, ...(a.ink ? { shapeColor: [a.ink] } : {}) } : {}),
  }).toDataUri();
}
