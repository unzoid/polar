import { useEffect, useState } from "react";
import type { Route } from "../lib/router";
import { PLAYER_EXIT_MS, Player } from "../screens/Player";

type PlayerRoute = Extract<Route, { name: "player" }>;

/**
 * Which player to draw. It stays drawn for its exit fade after its route is
 * gone; the page beneath is already live, so leaving never waits on the
 * animation.
 */
export function usePlayerLayer(current: Route) {
  const playing = current.name === "player" ? current : null;
  const [shown, setShown] = useState<PlayerRoute | null>(playing);
  useEffect(() => {
    if (playing) return setShown(playing);
    const t = window.setTimeout(() => setShown(null), PLAYER_EXIT_MS);
    return () => window.clearTimeout(t);
  }, [playing]);
  const player = playing ?? shown;
  return { playing, player, leaving: !playing && !!player };
}

/**
 * The full-window playback layer. It fades in and out once per visit; the
 * player inside it remounts per video *and* per source, so switching either
 * starts clean without the page flashing through.
 */
export function PlayerLayer({ player, leaving }: { player: PlayerRoute | null; leaving: boolean }) {
  if (!player) return null;
  return (
    <div className="player-layer" data-leaving={leaving} inert={leaving}>
      <Player
        key={`${player.videoId}|${player.stream?.content_id ?? player.stream?.url ?? ""}`}
        type={player.type}
        metaId={player.metaId}
        videoId={player.videoId}
        stream={player.stream}
        leaving={leaving}
      />
    </div>
  );
}
