import { downloadedStream, useDownloads } from "../library/downloads";
import { useSettings } from "../net/queries";
import { useRouter } from "../router";
import { needsPick, type PlayRequest } from "./titlePlayback";
import type { RankedStream } from "../types";

/**
 * `play(req, stream?)` for every title page, desktop and TV: it opens the player, or hands the request to
 * `onPick` to show the sources. A finished download of the video plays without asking, unless a stream was
 * picked. `beforePlay` runs just before the player opens.
 */
export function useTitlePlayback(onPick: (req: PlayRequest) => void, beforePlay?: () => void) {
  const { navigate } = useRouter();
  const { data: settings } = useSettings();
  const { data: downloads } = useDownloads();
  const autoPick = settings?.autoPickSource ?? true;
  return (req: PlayRequest, stream?: RankedStream) => {
    const local = stream ? undefined : downloadedStream(downloads, req.videoId);
    if (!local && needsPick(autoPick, req, stream)) return onPick(req);
    beforePlay?.();
    navigate({ name: "player", type: req.type, metaId: req.metaId, videoId: req.videoId, stream: stream?.stream ?? local });
  };
}
