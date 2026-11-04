import { PAGE_IDS, PAGE_LABELS, type PageId } from "../../lib/settings/pages";
import {
  Captions,
  Controls,
  Desktop,
  Fire,
  Gamepad,
  Grid,
  Info,
  Play,
  Profile,
  Puzzle,
  Services,
  Settings as Cog,
  Sources,
  Store,
  type Icon,
} from "../icons";

const ICONS: Record<PageId, Icon> = {
  account: Profile,
  playback: Play,
  sources: Sources,
  subtitles: Captions,
  appearance: Desktop,
  browsing: Grid,
  anime: Fire,
  controls: Controls,
  controller: Gamepad,
  marketplace: Store,
  addons: Puzzle,
  services: Services,
  advanced: Cog,
  about: Info,
};

export type SettingsPage = { id: PageId; label: string; icon: Icon };

/** Every settings page with its sidebar label and icon, in order. */
export const PAGES: SettingsPage[] = PAGE_IDS.map((id) => ({ id, label: PAGE_LABELS[id], icon: ICONS[id] }));
