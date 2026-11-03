/**
 * Episode stills ani.zip has for videos the metadata addon can't picture.
 * Cinemeta points every episode at a metahub still, and for most anime past
 * season one (Kurogane Rite's seasons 2 and 3) that image doesn't exist.
 * ani.zip has TVDB's for the same episodes: the Anime page leaves them here,
 * keyed by the app's video id, for the player's episode list to use first.
 */
const stills = new Map<string, string>();

export const rememberStill = (videoId: string, image: string) => stills.set(videoId, image);

export const stillFor = (videoId: string) => stills.get(videoId);
