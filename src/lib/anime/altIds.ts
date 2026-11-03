/**
 * Other ids an anime episode is known by. An episode played from an IMDb page
 * is asked of the stream addons by its IMDb id, which anime p2ps rarely
 * follow (they number by absolute episode, not IMDb's seasons); the Kitsu id
 * (`kitsu:48036:5`) is what addon and Comet index them under. The Anime
 * page leaves it here and `api.streams` asks for both, so the sources of
 * either show up.
 */
const alternates = new Map<string, string[]>();

export const rememberAltIds = (videoId: string, ids: string[]) => alternates.set(videoId, ids);

export const altIdsFor = (videoId: string) => alternates.get(videoId);
