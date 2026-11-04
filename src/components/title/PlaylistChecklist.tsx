import { useState, type FormEvent } from "react";
import { freshPlaylistName, inAnyPlaylist, playlistRows, type PlaylistRow } from "../../lib/playlistChecklist";
import { addToPlaylist, createPlaylist, removeFromPlaylist, usePlaylists } from "../../lib/playlists";
import type { MetaPreview } from "../../lib/types";
import { Check, Plus } from "../icons";
import { Button } from "../ui/Button";
import { MenuCheckItem, MenuItem, MenuSeparator } from "../ui/Menu";
import { TextField } from "../ui/TextField";

/**
 * Add-to-playlist (docs/ui-components.md U10): the playlists as tickable rows
 * and "New Playlist". The card menu's submenu and the detail page's popover
 * draw it with `PlaylistChecklist`; TV's panel draws its own rows from the hook.
 */
export function usePlaylistChecklist(item: MetaPreview) {
  const playlists = usePlaylists();
  return {
    rows: playlistRows(playlists, item.id),
    inAny: inAnyPlaylist(playlists, item.id),
    toggle: (row: PlaylistRow) => (row.has ? removeFromPlaylist(row.id, item.id) : addToPlaylist(row.id, item)),
    /** Starts a playlist with the title in it; without a name, "New Playlist" (2, 3, …). */
    create: (name?: string) => createPlaylist(name || freshPlaylistName(playlists.map((p) => p.name)), item),
  };
}

/**
 * `look="menu"`: rows inside a `MenuSub`, New Playlist made at once with a free name.
 * `look="popover"`: rows inside a `Popover`, New Playlist asks for a name first.
 */
export function PlaylistChecklist({ item, look }: { item: MetaPreview; look: "menu" | "popover" }) {
  const list = usePlaylistChecklist(item);
  if (look === "popover") return <PopoverChecklist list={list} />;
  return (
    <>
      {list.rows.map((row) => (
        <MenuCheckItem key={row.id} checked={row.has} meta={row.count} onCheckedChange={() => list.toggle(row)}>
          {row.name}
        </MenuCheckItem>
      ))}
      {list.rows.length > 0 && <MenuSeparator />}
      <MenuItem icon={<Plus />} onClick={() => list.create()}>
        New Playlist
      </MenuItem>
    </>
  );
}

/** The popover's rows; it remounts each time the popover opens, so the name form starts closed and empty. */
function PopoverChecklist({ list }: { list: ReturnType<typeof usePlaylistChecklist> }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const create = (e: FormEvent) => {
    e.preventDefault();
    list.create(name);
    setName("");
    setCreating(false);
  };

  return (
    <>
      {list.rows.length > 0 && (
        <div className="playlist-menu-list">
          {list.rows.map((row) => (
            <button key={row.id} className="playlist-menu-item" role="menuitemcheckbox" aria-checked={row.has} onClick={() => list.toggle(row)}>
              <span className="playlist-menu-check">{row.has && <Check size={14} strokeWidth={2.5} />}</span>
              <span className="playlist-menu-name">{row.name}</span>
              <span className="playlist-menu-count tabular">{row.count}</span>
            </button>
          ))}
        </div>
      )}
      {creating ? (
        <form className="playlist-menu-form" onSubmit={create}>
          <TextField
            autoFocus
            maxLength={60}
            placeholder="Playlist name"
            value={name}
            onChange={setName}
            onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setCreating(false))}
          />
          <Button variant="primary" disabled={!name.trim()}>
            Create
          </Button>
        </form>
      ) : (
        <button className="playlist-menu-item playlist-menu-new" onClick={() => setCreating(true)}>
          <span className="playlist-menu-check">
            <Plus size={15} strokeWidth={2.25} />
          </span>
          New Playlist
        </button>
      )}
    </>
  );
}
