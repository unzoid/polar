import type { UiFont } from "./types";

/** The app font a saved setting means. Anything else (the removed "netflix" test font, say) is Inter. */
export const uiFontOf = (saved: string | undefined): UiFont => (saved === "system" || saved === "opendyslexic" ? saved : "inter");

/** The family name subtitles use for OpenDyslexic: the bundled files' own, so mpv and the CSS preview agree. */
export const OPEN_DYSLEXIC = "OpenDyslexic";
