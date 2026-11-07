// Friends (#135): friend codes as typed or pasted, and what arrives from friends, checked before use.
import { expect, test } from "bun:test";
import {
  formatFriendCode,
  friendFromState,
  friendRank,
  friendStatus,
  normalizeFriendCode,
  ownPresence,
  parseFriendPresence,
  parseInvite,
  samePresence,
} from "../src/lib/friends/messages";

const ID = "00000000-0000-4000-8000-00000000005a";
const OTHER = "00000000-0000-4000-8000-0000000000a1";
const watching = { type: "movie" as const, metaId: "tt0000001", title: "The Lantern and the Key" };

test("a friend code typed with dashes, spaces or lower case, or pasted as a link, comes out the same", () => {
  expect(normalizeFriendCode("abcd-2345")).toBe("ABCD2345");
  expect(normalizeFriendCode(" ABCD 2345 ")).toBe("ABCD2345");
  expect(normalizeFriendCode("https://example.com/friend/ABCD2345")).toBe("ABCD2345");
  expect(normalizeFriendCode("https://example.com/add?code=abcd2345")).toBe("ABCD2345");
  // Too long: cut to eight. O, I, 0 and 1 are never in a code.
  expect(normalizeFriendCode("ABCD23456789")).toBe("ABCD2345");
  expect(normalizeFriendCode("ABCO2I01")).toBe("ABC2");
  expect(formatFriendCode("ABCD2345")).toBe("ABCD-2345");
  expect(formatFriendCode("ABC")).toBe("ABC");
});

test("a friend's presence: only their own entry, with a party code and what's on in shape", () => {
  expect(parseFriendPresence({ id: ID, seq: 3, party: "ABC123", watching }, ID)).toEqual({ id: ID, seq: 3, party: "ABC123", watching });
  // Someone else's entry, or not an entry.
  expect(parseFriendPresence({ id: OTHER, seq: 1 }, ID)).toBeUndefined();
  expect(parseFriendPresence("online", ID)).toBeUndefined();
  // A party "code" that is a link, a type that isn't one: dropped, the rest kept.
  expect(parseFriendPresence({ id: ID, seq: 1, party: "https://media.example.com/film.mkv" }, ID)).toEqual({ id: ID, seq: 1 });
  expect(parseFriendPresence({ id: ID, seq: 1, watching: { ...watching, type: "game" } }, ID)).toEqual({ id: ID, seq: 1 });
  // Text cut to size, control characters out.
  const long = parseFriendPresence({ id: ID, seq: 1, watching: { ...watching, title: "A\u0000B" + "x".repeat(500), label: "S1:E2" } }, ID);
  expect(long?.watching?.title.startsWith("A B")).toBe(true);
  expect(long?.watching?.title.length).toBe(120);
  expect(long?.watching?.label).toBe("S1:E2");
  expect(parseFriendPresence({ id: ID, seq: -4 }, ID)).toEqual({ id: ID, seq: 0 });
});

test("presence state: the newest entry under the friend's key; nothing there means offline", () => {
  const state = { [ID]: [{ id: ID, seq: 2, party: "AAA111" }, { id: ID, seq: 5 }, { id: ID, seq: 4, party: "BBB222" }], [OTHER]: [{ id: OTHER, seq: 9 }] };
  expect(friendFromState(state, ID)).toEqual({ id: ID, seq: 5 });
  expect(friendFromState({}, ID)).toBeNull();
  expect(friendFromState({ [ID]: [{ id: OTHER, seq: 1 }] }, ID)).toBeNull();
});

test("an invite: a profile id and a party code, nothing else", () => {
  expect(parseInvite({ from: ID, party: "ABC123" })).toEqual({ from: ID, party: "ABC123" });
  expect(parseInvite({ from: ID, party: "ABC123", url: "https://media.example.com/film.mkv" })).toEqual({ from: ID, party: "ABC123" });
  expect(parseInvite({ from: "Sam", party: "ABC123" })).toBeUndefined();
  expect(parseInvite({ from: ID, party: "abc123" })).toBeUndefined();
  expect(parseInvite(null)).toBeUndefined();
});

test("this profile's presence follows its settings: hidden, joinable without the title, or everything", () => {
  const all = { online: true, watching: true, join: true };
  expect(ownPresence(ID, 1, { ...all, online: false }, "ABC123", watching)).toBeNull();
  expect(ownPresence(ID, 2, { ...all, watching: false }, "ABC123", watching)).toEqual({ id: ID, seq: 2, party: "ABC123" });
  expect(ownPresence(ID, 3, { ...all, join: false }, "ABC123", watching)).toEqual({ id: ID, seq: 3, watching });
  expect(ownPresence(ID, 4, all, null, null)).toEqual({ id: ID, seq: 4 });
  expect(samePresence(ownPresence(ID, 1, all, "ABC123", watching), ownPresence(ID, 7, all, "ABC123", { ...watching }))).toBe(true);
  expect(samePresence(ownPresence(ID, 1, all, "ABC123", watching), ownPresence(ID, 2, all, null, watching))).toBe(false);
  expect(samePresence(null, null)).toBe(true);
});

test("a friend's line: offline, online, watching, or in a party with or without the title", () => {
  expect(friendStatus(null)).toBe("Offline");
  expect(friendStatus({ id: ID, seq: 1 })).toBe("Online");
  expect(friendStatus({ id: ID, seq: 1, watching: { ...watching, label: "S1:E2" } })).toBe("Watching The Lantern and the Key · S1:E2");
  expect(friendStatus({ id: ID, seq: 1, party: "ABC123" })).toBe("In a watch party");
  expect(friendStatus({ id: ID, seq: 1, party: "ABC123", watching })).toBe("In a watch party · The Lantern and the Key");
  expect([null, { id: ID, seq: 1 }, { id: ID, seq: 1, watching }, { id: ID, seq: 1, party: "ABC123" }].map(friendRank)).toEqual([3, 2, 1, 0]);
});
