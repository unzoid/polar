import { useEffect } from "react";
import { api } from "../../lib/api";
import { discordActivity, sameActivity, type DiscordActivity, type DiscordPresence } from "../../lib/playback";
import type { Meta } from "../../lib/types";
import type { MediaLike } from "./mpvMedia";

const EVENTS = ["play", "pause", "playing", "seeking", "seeked", "ended", "loadedmetadata", "durationchange", "ratechange", "timeupdate"] as const;

/**
 * Keeps the user's Discord profile showing what plays (#31), as Settings → Playback → Show on
 * Discord has it: updated on play, pause, seek and speed changes, cleared when it ends or the
 * player closes.
 */
export function useDiscordPresence(media: MediaLike | null, meta: Meta | undefined, videoId: string, mode: DiscordPresence) {
  const name = meta?.name;
  const poster = meta?.poster;
  const video = meta?.videos?.find((v) => v.id === videoId);
  const season = video?.season;
  const episode = video?.episode;
  const episodeTitle = video?.title;
  useEffect(() => {
    if (mode === "off" || !media || !name) return;
    let sent: DiscordActivity | null = null;
    // Nothing while the loading screen is up: only once it has played.
    let begun = media.currentTime > 0;
    const update = () => {
      begun ||= !media.paused;
      if (!begun) return;
      const next = discordActivity(mode, {
        name,
        poster,
        episode: season !== undefined && episode !== undefined ? { season, episode, title: episodeTitle } : undefined,
        paused: media.paused,
        ended: media.ended,
        current: media.currentTime,
        duration: media.duration,
        rate: media.playbackRate,
      });
      if (sameActivity(sent, next)) return;
      sent = next;
      void api.discordPresence(next);
    };
    update();
    for (const e of EVENTS) media.addEventListener(e, update);
    return () => {
      for (const e of EVENTS) media.removeEventListener(e, update);
      if (sent) void api.discordPresence(null);
    };
  }, [media, mode, name, poster, season, episode, episodeTitle]);
}
