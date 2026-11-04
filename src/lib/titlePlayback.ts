import type { ContentType, RankedStream } from "./types";

/** What a Play button (a title's, an episode's) starts. */
export interface PlayRequest {
  type: ContentType;
  metaId: string;
  videoId: string;
  /** The source picker's subtitle: the episode, or the title. */
  subtitle?: string;
  /** Something to resume: it keeps the file it was on, so it never asks for a source. */
  resumable?: boolean;
}

/**
 * The play-or-pick rule (critique H14, docs/ui-components.md U5): with Settings → "Pick a source for me" off,
 * Play opens the source list first, unless a source was just chosen or the video resumes.
 */
export const needsPick = (autoPick: boolean, req: PlayRequest, stream?: RankedStream) => !stream && !autoPick && !req.resumable;
