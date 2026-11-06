import { useEffect, useState, type CSSProperties } from "react";
import { avatarDef } from "../lib/account";

/** Rendered SVGs by avatar id: each is built once, then reused everywhere. */
const cache = new Map<string, string>();
let art: Promise<typeof import("./avatarArt")> | undefined;

/** The art for `id`: at once when it's been drawn before, else once DiceBear's chunk has loaded. */
function useAvatarUri(id: string) {
  const key = avatarDef(id).id;
  const [uri, setUri] = useState(() => cache.get(key));
  useEffect(() => {
    const known = cache.get(key);
    if (known) return setUri(known);
    let live = true;
    (art ??= import("./avatarArt")).then(
      ({ avatarArt }) => {
        if (!cache.has(key)) cache.set(key, avatarArt(key));
        if (live) setUri(cache.get(key));
      },
      // The chunk didn't load (offline, or the page is going away mid-load, which WebKit
      // reports as a failed import): the tile shows its colours only, and the next avatar tries again.
      () => {
        art = undefined;
      },
    );
    return () => {
      live = false;
    };
  }, [key]);
  return uri;
}

/** A profile avatar: a colour tile with DiceBear art. Scales with its box. */
export function Avatar({ id, className, style }: { id: string; className?: string; style?: CSSProperties }) {
  const a = avatarDef(id);
  const uri = useAvatarUri(id);
  return (
    <span
      className={className ? `avatar ${className}` : "avatar"}
      data-style={a.style}
      style={{ ...style, "--avatar-from": a.from, "--avatar-to": a.to } as CSSProperties}
      aria-hidden
    >
      {uri && <img src={uri} alt="" draggable={false} />}
    </span>
  );
}
