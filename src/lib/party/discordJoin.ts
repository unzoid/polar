/**
 * Joining a watch party from someone's Discord profile (#153, #154).
 *
 * The "Join watch party" button carries a join token, never the party code:
 * 16 random bytes, then the fingerprint of a key pair the desk made for that
 * token. A token is handed out for JOIN_TOKEN_MS, after which a new one
 * replaces it (the previous one still answers for another JOIN_TOKEN_MS, so a
 * button someone loaded just before the change still works). The member whose
 * profile it is runs a desk: it listens on a channel named after a hash of
 * each live token, and a joiner who has the token asks there.
 *
 * - "Anyone who sees it": the desk lets the joiner in at once.
 * - "Ask me": the member sees "<name> wants to join" and allows or declines.
 * - A locked room (#156) turns everyone away; once in, the room's own rules
 *   (approving joins, removing members) apply as to anyone with the code.
 *
 * Anyone who has the token can listen and speak on its channel. So the code
 * goes to the one joiner let in sealed with a key only the two of them share
 * (ECDH: the joiner's one-time key pair and the token's; AES-GCM), and the
 * joiner only takes an answer from the key the token's fingerprint names:
 * someone else with the token can't hand a joiner the code of another party.
 * (They can still send a joiner a refusal, which only ends that attempt.)
 * Messages are parsed like the room's (messages.ts): anything else is dropped.
 * Pure apart from its deps, so tests run it against a simulated channel
 * (tests/discordJoin.test.ts).
 */

/** How long a join token is handed out; it answers for twice that. */
export const JOIN_TOKEN_MS = 10 * 60_000;
/** Join requests the member hasn't answered yet, at most; more are turned away as busy. */
export const PENDING_MAX = 3;
/** An unanswered "Ask me" request is declined after this. */
export const ASK_MS = 2 * 60_000;
/** A joiner hearing nothing from a desk this long takes the link as expired. */
export const SEEN_MS = 10_000;
const NAME_MAX = 40;

export type JoinMode = "nobody" | "ask" | "anyone";

/** Why a joiner was turned away. */
export type JoinRefusal = "declined" | "locked" | "busy" | "closed" | "expired";

export const REFUSALS: Record<JoinRefusal, string> = {
  declined: "The host declined your request to join.",
  locked: "This watch party is locked. Ask the host to unlock it.",
  busy: "The host has too many join requests right now. Try again in a moment.",
  closed: "This watch party can't be joined from Discord any more.",
  expired: "This join link has expired, or the watch party has ended.",
};

/** A join request waiting for the member's answer. */
export interface JoinRequest {
  id: string;
  name: string;
}

/** A small message channel; the app's is a Realtime channel (`party:join-…`). */
export interface JoinChannel {
  send(message: Record<string, unknown>): void;
  close(): void;
}

export interface JoinDeps {
  /**
   * Opens the channel named `join-<topic>`: `onMessage` hears everything sent on it, ours included;
   * `onReady` once it hears (and again after a reconnect).
   */
  connect(topic: string, onMessage: (message: Record<string, unknown>) => void, onReady: () => void): JoinChannel;
  randomBytes(n: number): Uint8Array;
  newId(): string;
  after(fn: () => void, ms: number): () => void;
  subtle: SubtleCrypto;
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

/** A join token as links carry it: 43 base64url characters (32 bytes). */
export const isJoinToken = (text: string) => /^[A-Za-z0-9_-]{43}$/.test(text);

/** The channel a token's requests go to: a hash, so the channel's name doesn't give the token away. */
export async function joinTopic(subtle: SubtleCrypto, token: string) {
  const hash = new Uint8Array(await subtle.digest("SHA-256", new TextEncoder().encode(`polarity-join:${token}`)));
  return Array.from(hash.slice(0, 16), (b) => b.toString(16).padStart(2, "0")).join("");
}

// One-time keys and the sealed code.

interface PublicKey {
  x: string;
  y: string;
}

const KEY_PART = /^[A-Za-z0-9_-]{43}$/;
const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

async function keyPair(subtle: SubtleCrypto) {
  const pair = (await subtle.generateKey(ECDH, false, ["deriveKey"])) as CryptoKeyPair;
  const jwk = await subtle.exportKey("jwk", pair.publicKey);
  return { pair, pub: { x: jwk.x!, y: jwk.y! } };
}

/** The 16 bytes of a public key a token carries. */
async function fingerprint(subtle: SubtleCrypto, key: PublicKey) {
  return new Uint8Array(await subtle.digest("SHA-256", new TextEncoder().encode(`polarity-join-key:${key.x}.${key.y}`))).slice(0, 16);
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

async function sharedKey(subtle: SubtleCrypto, mine: CryptoKey, theirs: PublicKey) {
  const pub = await subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: theirs.x, y: theirs.y, ext: true }, ECDH, false, []);
  return subtle.deriveKey({ name: "ECDH", public: pub }, mine, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

// Messages, checked before use.

type JoinMessage =
  | { t: "ask"; id: string; name: string; key: PublicKey }
  | { t: "seen"; to: string }
  | { t: "ok"; to: string; key: PublicKey; iv: string; box: string }
  | { t: "no"; to: string; why: JoinRefusal };

const ID = /^[A-Za-z0-9-]{8,64}$/;
const str = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : null);
const keyOf = (v: unknown): PublicKey | null => {
  const k = v as Partial<PublicKey> | null;
  return k && typeof k === "object" && KEY_PART.test(String(k.x)) && KEY_PART.test(String(k.y)) ? { x: k.x!, y: k.y! } : null;
};
/** A name as the member sees it: control characters out, cut to size. */
const cleanName = (v: unknown) =>
  (typeof v === "string" ? v : "")
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .trim()
    .slice(0, NAME_MAX) || "Someone";

export function parseJoinMessage(raw: Record<string, unknown>): JoinMessage | null {
  if (!raw || typeof raw !== "object") return null;
  switch (raw.t) {
    case "ask": {
      const id = str(raw.id, 64);
      const key = keyOf(raw.key);
      return id && ID.test(id) && key ? { t: "ask", id, name: cleanName(raw.name), key } : null;
    }
    case "seen": {
      const to = str(raw.to, 64);
      return to ? { t: "seen", to } : null;
    }
    case "ok": {
      const to = str(raw.to, 64);
      const key = keyOf(raw.key);
      const iv = str(raw.iv, 16);
      const box = str(raw.box, 128);
      return to && key && iv && box ? { t: "ok", to, key, iv, box } : null;
    }
    case "no": {
      const to = str(raw.to, 64);
      const why = raw.why as JoinRefusal;
      return to && why in REFUSALS ? { t: "no", to, why } : null;
    }
    default:
      return null;
  }
}

// The member's side.

export interface DeskRoom {
  /** The party code; null once out of the party. */
  code: string | null;
  locked: boolean;
}

/**
 * Hands out join tokens and answers requests for one party. `room()` is read
 * at each request, so a lock or a change of mode counts at once.
 */
export function createJoinDesk(deps: JoinDeps, room: () => DeskRoom, mode: () => JoinMode) {
  interface Live {
    token: string;
    /** The token's key pair: its fingerprint is in the token, and the code is sealed with it. */
    pair: CryptoKeyPair;
    pub: PublicKey;
    channel: JoinChannel;
    /** Hearing requests: only then is its token handed out. */
    ready: boolean;
  }
  interface Pending extends JoinRequest {
    key: PublicKey;
    live: Live;
    expire: () => void;
  }
  let live: Live[] = [];
  let current: string | null = null;
  let pending: Pending[] = [];
  let stopRotation: (() => void) | null = null;
  let stopped = false;
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((l) => l());
  /** Requests already heard, so a repeat doesn't ask twice (forgotten in bulk past HEARD_MAX). */
  const heard = new Set<string>();
  const HEARD_MAX = 500;

  function rotate() {
    if (stopped) return;
    // The previous token still answers until the next change.
    const keep = live.slice(-1);
    for (const l of live.slice(0, -1)) l.channel.close();
    live = keep;
    void (async () => {
      const { pair, pub } = await keyPair(deps.subtle);
      const bytes = new Uint8Array(32);
      bytes.set(deps.randomBytes(16));
      bytes.set(await fingerprint(deps.subtle, pub), 16);
      const token = b64url(bytes);
      const topic = await joinTopic(deps.subtle, token);
      if (stopped) return;
      current = token;
      const l: Live = { token, pair, pub, channel: null as unknown as JoinChannel, ready: false };
      l.channel = deps.connect(
        `join-${topic}`,
        (m) => void hear(l, m),
        () => {
          if (l.ready) return;
          l.ready = true;
          changed();
        },
      );
      live.push(l);
    })();
    stopRotation = deps.after(rotate, JOIN_TOKEN_MS);
  }

  async function hear(l: Live, raw: Record<string, unknown>) {
    const msg = parseJoinMessage(raw);
    if (stopped || msg?.t !== "ask" || heard.has(msg.id)) return;
    if (heard.size >= HEARD_MAX) heard.clear();
    heard.add(msg.id);
    const channel = l.channel;
    const no = (why: JoinRefusal) => channel.send({ t: "no", to: msg.id, why });
    const r = room();
    const m = mode();
    if (!r.code || m === "nobody") return no("closed");
    if (r.locked) return no("locked");
    if (pending.length >= PENDING_MAX) return no("busy");
    channel.send({ t: "seen", to: msg.id });
    if (m === "anyone") return void (await letIn(l, msg.id, msg.key));
    const expire = deps.after(() => answer(msg.id, false), ASK_MS);
    pending = [...pending, { id: msg.id, name: msg.name, key: msg.key, live: l, expire }];
    changed();
  }

  async function letIn(l: Live, to: string, theirs: PublicKey) {
    const { channel, pair, pub } = l;
    const code = room().code;
    if (!code) return channel.send({ t: "no", to, why: "closed" });
    try {
      const key = await sharedKey(deps.subtle, pair.privateKey, theirs);
      const iv = deps.randomBytes(12);
      const box = new Uint8Array(await deps.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, new TextEncoder().encode(code)));
      if (!stopped) channel.send({ t: "ok", to, key: pub, iv: b64url(iv), box: b64url(box) });
    } catch {
      // A key that isn't a point on the curve: nobody honest sends one.
      channel.send({ t: "no", to, why: "closed" });
    }
  }

  /** The member's answer to a request (also the timeout's "no"). */
  function answer(id: string, allow: boolean) {
    const p = pending.find((x) => x.id === id);
    if (!p) return;
    p.expire();
    pending = pending.filter((x) => x !== p);
    changed();
    const r = room();
    if (!allow) p.live.channel.send({ t: "no", to: id, why: "declined" });
    else if (r.locked) p.live.channel.send({ t: "no", to: id, why: "locked" });
    else void letIn(p.live, id, p.key);
  }

  rotate();

  return {
    /** The token buttons carry now; null until its channel is open. */
    token: () => (current && live.some((l) => l.token === current && l.ready) ? current : null),
    requests: (): JoinRequest[] => pending.map(({ id, name }) => ({ id, name })),
    answer,
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    stop() {
      stopped = true;
      stopRotation?.();
      for (const p of pending) {
        p.expire();
        p.live.channel.send({ t: "no", to: p.id, why: "closed" });
      }
      pending = [];
      for (const l of live) l.channel.close();
      live = [];
      current = null;
      changed();
    },
  };
}

export type JoinDesk = ReturnType<typeof createJoinDesk>;

// The joiner's side.

export type AskProgress = "asking" | "waiting";

/**
 * Asks the desk behind `token` to join; resolves with the party code once let
 * in, or rejects with a JoinRefusal's text. `progress` hears "waiting" once
 * the desk has the request (the member deciding, with "Ask me").
 */
export function askToJoin(
  deps: JoinDeps,
  token: string,
  name: string,
  progress?: (p: AskProgress) => void,
): { done: Promise<string>; cancel: () => void } {
  let cancel = () => {};
  const done = new Promise<string>((resolve, reject) => {
    if (!isJoinToken(token)) return reject(new Error(REFUSALS.expired));
    const id = deps.newId();
    let channel: JoinChannel | null = null;
    let over = false;
    let asked = false;
    let stopSeen = () => {};
    const stops: (() => void)[] = [];
    const finish = (fn: () => void) => {
      if (over) return;
      over = true;
      stops.forEach((s) => s());
      channel?.close();
      fn();
    };
    cancel = () => finish(() => reject(new Error("cancelled")));
    progress?.("asking");
    void (async () => {
      const { pair, pub } = await keyPair(deps.subtle);
      const topic = await joinTopic(deps.subtle, token);
      const desk = fromB64url(token).slice(16);
      if (over) return;
      const ask = () => {
        if (asked || over) return;
        asked = true;
        channel?.send({ t: "ask", id, name: cleanName(name), key: pub });
        // "Anyone" answers with the code at once, so "seen" may come with it.
        stopSeen = deps.after(() => finish(() => reject(new Error(REFUSALS.expired))), SEEN_MS);
        stops.push(() => stopSeen());
      };
      channel = deps.connect(`join-${topic}`, (raw) => {
        const msg = parseJoinMessage(raw);
        if (!msg || msg.t === "ask" || msg.to !== id || over) return;
        if (msg.t === "seen") {
          stopSeen();
          progress?.("waiting");
          stops.push(deps.after(() => finish(() => reject(new Error(REFUSALS.declined))), ASK_MS + SEEN_MS));
        } else if (msg.t === "no") finish(() => reject(new Error(REFUSALS[msg.why])));
        else
          // Only from the key the token names; anything else (someone else with the token) is ignored.
          void (async () => {
            if (!sameBytes(await fingerprint(deps.subtle, msg.key), desk)) return;
            const key = await sharedKey(deps.subtle, pair.privateKey, msg.key);
            const plain = await deps.subtle.decrypt({ name: "AES-GCM", iv: fromB64url(msg.iv) as BufferSource }, key, fromB64url(msg.box) as BufferSource);
            finish(() => resolve(new TextDecoder().decode(plain)));
          })().catch(() => {});
      }, ask);
      // A channel that never opens (offline, signed out on the server): said, not waited on forever.
      stops.push(deps.after(() => !asked && finish(() => reject(new Error(REFUSALS.expired))), 2 * SEEN_MS));
    })().catch(() => finish(() => reject(new Error(REFUSALS.expired))));
  });
  return { done, cancel: () => cancel() };
}
