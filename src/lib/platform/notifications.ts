import { call, on, type Unlisten } from "./bridge";
import { os } from "./device";

/**
 * The system's notifications (#209), behind one interface: lib/notifications decides what to say
 * and this only shows it. Android goes through the activity's `polarNotes` (MainActivity.kt,
 * NotesWorker.kt); every other platform through src-tauri/src/notifications (Linux D-Bus, Windows
 * toasts, macOS and iOS UserNotifications). Swapping that for a plugin changes this file alone.
 *
 * A note carries an opaque `payload` the click hands back; lib/notifications checks it before
 * acting on it, since a click can also arrive from outside the app.
 */

export type NotePermission = "granted" | "denied" | "prompt";

export interface NativeNote {
  id: string;
  title: string;
  body: string;
  payload: string;
}

/** A note the system shows at `at` (ms since 1970) by itself, with the app closed too. */
export interface PlannedNote extends NativeNote {
  at: number;
}

interface AndroidNotes {
  permission(): string;
  request(): void;
  show(json: string): void;
  plan(json: string): void;
  takeLaunch(): string | null;
}

const android = os === "android" && typeof window !== "undefined" ? (window as { polarNotes?: AndroidNotes }).polarNotes : undefined;

/** Phones show planned notes themselves (Android's WorkManager, iOS's notification triggers); desktops only while running. */
export const systemPlansNotes = os === "android" || os === "ios";

const asPermission = (v: unknown): NotePermission => (v === "granted" || v === "denied" ? v : "prompt");

export async function notePermission(): Promise<NotePermission> {
  if (android) return asPermission(android.permission());
  return asPermission(await call<string>("notifications_permission").catch(() => "denied"));
}

/** Asks only where the system asks (phones, macOS); resolves with the answer. */
export async function askNotePermission(): Promise<NotePermission> {
  if (android) {
    android.request();
    // The system's dialog answers to the activity; the web side looks again once it's gone.
    return new Promise((done) => {
      const look = () => {
        const p = asPermission(android.permission());
        if (p !== "prompt" || document.visibilityState === "visible") {
          document.removeEventListener("visibilitychange", look);
          window.removeEventListener("focus", look);
          done(p);
        }
      };
      setTimeout(() => {
        document.addEventListener("visibilitychange", look);
        window.addEventListener("focus", look);
      }, 300);
    });
  }
  return asPermission(await call<string>("notifications_request").catch(() => "denied"));
}

export async function showNote(note: NativeNote): Promise<void> {
  if (android) return android.show(JSON.stringify(note));
  await call("notifications_show", { note });
}

/** Replaces every note planned before (an empty list cancels them all). Does nothing where `systemPlansNotes` is false. */
export async function planNotes(notes: PlannedNote[]): Promise<void> {
  if (!systemPlansNotes) return;
  if (android) return android.plan(JSON.stringify(notes));
  await call("notifications_plan", { notes });
}

const CLICK = "notification://click";

/**
 * Hear clicks on notes, including the one that started the app. Android's activity dispatches a
 * `polar-note` DOM event; the native shell a `notification://click` event.
 */
export function onNoteClick(handler: (payload: string) => void): Unlisten {
  let unlisten: Unlisten | undefined;
  let stopped = false;
  const dom = (e: Event) => {
    const payload = (e as CustomEvent<unknown>).detail;
    if (typeof payload === "string") handler(payload);
  };
  if (android) {
    window.addEventListener("polar-note", dom);
    const first = android.takeLaunch();
    if (first) handler(first);
  } else {
    on<string>(CLICK, (p) => typeof p === "string" && handler(p)).then((u) => (stopped ? u() : (unlisten = u)));
    call<string | null>("notifications_take_launch")
      .then((p) => !stopped && typeof p === "string" && handler(p))
      .catch(() => undefined);
  }
  return () => {
    stopped = true;
    window.removeEventListener("polar-note", dom);
    unlisten?.();
  };
}
