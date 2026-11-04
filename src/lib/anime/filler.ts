/**
 * Which videos are filler, for the player's "skip filler" autoplay. The
 * player only knows video ids; an anime's page leaves its filler ones here
 * once it knows them (lib/anime/episodeFlags.ts).
 */
const filler = new Set<string>();

export function rememberFiller(videoIds: string[]) {
  for (const id of videoIds) filler.add(id);
}

export const isFiller = (videoId: string) => filler.has(videoId);
