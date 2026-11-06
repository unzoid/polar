import { shortHash } from "../party/links";

/**
 * Ids of video files on this device (#204): the prefix and a hash of the path, so a path never
 * appears in an id (ids reach the query cache, logs and watch-party messages). Pure, for the router
 * and the party's message checks.
 */
export const FILE_PREFIX = "file:";
export const isFileId = (id: string) => id.startsWith(FILE_PREFIX);
export const fileId = (path: string) => `${FILE_PREFIX}${shortHash(path)}`;
