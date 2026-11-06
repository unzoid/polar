import { Dialog } from "@base-ui/react/dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../lib/errors";
import {
  canOpenFiles,
  onFileDrag,
  onFilesDropped,
  pickFiles,
  playFiles,
  setOpenFilesOpen,
  useOpenFilesOpen,
  type DragState,
  type LocalFile,
} from "../lib/localFiles";
import { useRouter } from "../lib/router";
import { actionFor, isSettingsOpen } from "../lib/settings";
import { OpenFile } from "./icons";

/**
 * "Open File…" (#204): drop videos on it (or anywhere on the window, which opens it), or browse for
 * them. Opening plays at once, so nothing waits here: the files then live in Library → Recent Files.
 * One file brings its folder's other videos along as episodes.
 *
 * Motion: the window scales in once and carries everything in it. A drag over the window is the
 * moment that moves: the two side cards fan out together with the zone taking the accent and the
 * line swapping to "Release…"; all of it settles back at once, quicker and without the overshoot,
 * when the drag leaves.
 */
export function OpenFilesHost() {
  const open = useOpenFilesOpen();
  const [drag, setDrag] = useState<DragState>({ over: false });
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Opened by a drag rather than asked for: it closes again if the drag leaves the window.
  const byDrag = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;
  const { current, navigate, replace } = useRouter();
  const playingRef = useRef(false);
  playingRef.current = current.name === "player";

  const play = useCallback(
    async (files: LocalFile[], start?: LocalFile) => {
      const route = await playFiles(files, start);
      if (!route) return;
      setOpenFilesOpen(false);
      // Over the player, the new file takes its place rather than stacking a second player.
      if (playingRef.current) replace(route);
      else navigate(route);
    },
    [navigate, replace],
  );

  useEffect(() => {
    const drags = onFileDrag((state) => {
      setDrag(state);
      if (state.over) {
        setProblem(null);
        if (!openRef.current) {
          byDrag.current = true;
          setOpenFilesOpen(true);
        }
      } else if (!state.dropped && byDrag.current) setOpenFilesOpen(false);
      // A drop keeps the window up until the files arrive from the native side (below).
    });
    const drops = onFilesDropped((files) => {
      if (files.length) return void play(files);
      setOpenFilesOpen(true);
      setProblem("Only video files can be opened.");
    });
    return () => {
      void drags.then((f) => f());
      void drops.then((f) => f());
    };
  }, [play]);

  useEffect(() => {
    if (open) return;
    setProblem(null);
    byDrag.current = false;
  }, [open]);

  // Its shortcut (Ctrl+O / ⌘O by default) works everywhere but the Settings window.
  useEffect(() => {
    if (!canOpenFiles) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isSettingsOpen() || actionFor(e, "app") !== "openFile") return;
      e.preventDefault();
      setOpenFilesOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const browse = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const files = await pickFiles();
      if (files.length) await play(files);
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!canOpenFiles) return null;
  return (
    <Dialog.Root open={open} onOpenChange={(o) => setOpenFilesOpen(o)}>
      <Dialog.Portal>
        <Dialog.Backdrop className="open-files-scrim" />
        <Dialog.Popup className="open-files" data-dragging={drag.over || undefined}>
          <Dialog.Title className="open-files-label">Open Files</Dialog.Title>
          <DropZone drag={drag} busy={busy} problem={problem} onBrowse={() => void browse()} />
          <p className="open-files-foot">Files you open play at once and are listed in Library, on this device only.</p>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function dragLine(drag: DragState) {
  if (!drag.over) return null;
  if (drag.videos) return `Release to open ${drag.videos} ${drag.videos === 1 ? "file" : "files"}`;
  if (drag.folders) return `Release to open ${drag.folders === 1 ? "this folder" : "these folders"}`;
  return "Only video files can be opened";
}

function DropZone({ drag, busy, problem, onBrowse }: { drag: DragState; busy: boolean; problem: string | null; onBrowse: () => void }) {
  const line = dragLine(drag);
  const refused = drag.over && !drag.videos && !drag.folders;
  return (
    <div className="open-files-zone" data-refused={refused || undefined}>
      <div className="open-files-stack" aria-hidden>
        <span className="open-files-card" data-side="left">
          <span className="open-files-kind">MKV</span>
        </span>
        <span className="open-files-card" data-side="right">
          <span className="open-files-kind">MP4</span>
        </span>
        <span className="open-files-card" data-side="center">
          <OpenFile size={20} />
        </span>
      </div>
      {/* Both lines share one cell: the swap is a crossfade in place, never a jump in height. */}
      <div className="open-files-lines">
        <p className="open-files-title" data-shown={!line || undefined} aria-hidden={!!line}>
          Drop files here or{" "}
          <button type="button" className="open-files-browse" onClick={onBrowse} disabled={busy}>
            browse
          </button>
        </p>
        <p className="open-files-title" data-shown={!!line || undefined} aria-live="polite">
          {line}
        </p>
      </div>
      <p className="open-files-hint" data-problem={!!problem || undefined}>
        {problem ?? "MP4, MKV, HEVC, WebM and more · subtitles beside a file load with it"}
      </p>
    </div>
  );
}

