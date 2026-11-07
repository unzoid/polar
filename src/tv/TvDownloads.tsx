import { DownloadsPage } from "../components/downloads/DownloadsPage";

/**
 * Downloads in TV mode (#15): the desktop page itself, its rows and toggles plain buttons the D-pad
 * walks through (spatial.ts), the focused row kept in the middle of the screen. A title or season
 * opens and closes with A; its deletes sit right of it and inside it, one press to arm, one to delete.
 */
export function TvDownloads() {
  return (
    <div className="tv-downloads" data-nav-scroll="center">
      <h1 className="tv-heading">Downloads</h1>
      <DownloadsPage />
    </div>
  );
}
