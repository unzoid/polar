# UI components: inventory, duplicates and the target component set

Inventory of every UI element in `src/` at `b31ccbe`, the places where the same job is done by different
code, and the component set and tokens the unification (T-019) builds. It covers about 16,300 lines of
TSX in 70 files and 12,000 lines of CSS in 16 files. The goal is that every job has **one component**,
every visual constant is a **token**, and the look and every feature stay as they are.

Paths are relative to `src/`. `file:line` points at `b31ccbe`. Critique ids (H14, M30 …) refer to
`docs/critique.md`.

Contents: [0 The component set (as built)](#0-the-component-set-as-built) · [1 Facts](#1-facts) · [2 Inventory](#2-inventory) · [3 Duplicate groups](#3-duplicate-groups) ·
[4 Target component set](#4-target-component-set) · [5 Tokens](#5-tokens) · [6 Bugs found on the way](#6-bugs-found-on-the-way) ·
[7 Conventions](#7-conventions) · [8 Order of work](#8-order-of-work)

---

## 0. The component set (as built)

What T-019 built, for whoever writes the next screen: use these before writing markup (§7). Paths are
relative to `src/`; each primitive's CSS is `styles/ui/<name>.css`, the title parts' `styles/title/` or
`styles/cards.css`. §3 stays the record of what was merged into what; §8 says how and what changed.

**Primitives (`components/ui/`)**

| Component | Props | Use it for |
|---|---|---|
| `Button` | `variant` primary/glass/plain/danger/accent/outline, `size` md/sm/block, `busy`, `className` for layout, native button props | Any text button. One `primary` (or `accent` on the account screens) per screen. `busy` swaps the label for a spinner after a short delay. `block` is the account screens' full-width button (soft fill, or `accent`); `sm` the profile screens' row of actions |
| `IconButton` | `label` (required, the accessible name), `variant` plain/glass, or `player`/`transport` over the video | A button holding one glyph |
| `buttonClass(variant, icon, extra)` | | The button look on an element that isn't ours (a Base UI trigger) |
| `Chip`, `ToggleChip`, `Badge` | `Chip`: `variant` filter/tag/choice/link/badge, `pressed`; `ToggleChip`: `on`, `label`, `onToggle`; `Badge`: `variant` rank/tag | Filters and genre links (`Chip`), on/off filters with a check (`ToggleChip`), static labels (`Badge`) |
| `Switch` | `checked`, `onChange(boolean)`, native input props | An on/off setting; name it with the `<label>` around it |
| `SearchField` | `value`, `onChange(string)`, `label` (required), `look` box/pill/mini/plain, `kbd`, `ref` to the input | Every search box: clear button, Escape clears first |
| `TextField` | `value`, `onChange(string)`, `look` box/block, native input props | One-line text (keys, names). `block`: the account screens' full-width field |
| `EmptyState` | message as children, `action` {label, onClick}, `variant="tv"`, `className` for spacing | What a screen or section shows instead of content: nothing there, or it failed |
| `Skeleton` | `shape` block/line, `as` div/span, `width`, `height`, `className` for the box | Placeholders while loading (`aria-hidden`) |
| `Toast` | `icon`, text as children (`<strong>` + `<span>` lines), `actions`, `variant="tv"` | A floating notice (controller, update). The caller decides when and how long |
| `MenuRoot`/`MenuTrigger`/`MenuPopup`, `MenuHeader`, `MenuItem`, `MenuCheckItem`, `MenuSeparator`, `MenuSub` | `MenuPopup`: `look` compact/roomy, positioner props; `MenuItem`: `icon`, `onClick`, `disabled` | Any popup or right-click menu (Base UI Menu, one surface) |
| `PopoverRoot`/`PopoverTrigger`/`PopoverPopup` | `className` for the surface, positioner props | A panel that opens from a button (playlists, source filters) |

**Layers and behaviour (`lib/`)**

| Hook | Use it for |
|---|---|
| `useDismiss(active, onDismiss)` (`lib/dismiss.ts`) | Anything Escape (or TV's Back) should close. One stack: the newest layer closes first; what has focus (a field, an open Base UI popup) handles Escape before it. `dismissTop()` closes the top one from code; `onDismissed` listens |
| `useLayer(root, open, onClose, { modal })` (`lib/layer.ts`) | A modal layer you draw yourself: `useDismiss` plus focus in on open, Tab kept inside, focus back to the opener on close. Give the root `tabIndex={-1}` and `data-layer`. Used by `Sheet`, the trailer, the player's `OptionsOverlay` |
| `useBack(active, handler)` (`tv/shell.ts`) | The same stack, named for TV panels |
| `useNearViewport`, `useInfiniteSentinel` (`lib/viewport.ts`) | Lazy shelves; the next page of a grid |
| `useCardIntent(warm, delay)` (`lib/cardIntent.ts`) | Prefetch after resting on a card (hover or focus) |
| `useTitlePlayback(onPick, beforePlay?)` (`lib/useTitlePlayback.ts`), `needsPick` (`lib/titlePlayback.ts`) | Play now or ask for a source: the one rule (H14) |
| `useSetting(id)` (`lib/settings/useSetting.ts`) | Read and save one setting from the schema |

**Title parts (`components/title/`)**

| Component | Props | Use it for |
|---|---|---|
| `Card` | `shape` poster/landscape, `art` + `fallback`, children on the art, `actions`, `title`, `detail`, `keepCaption`, `trailing`, `hint` | Every title card on desktop. With `actions` it's a focusable `role="link"` |
| `CardArt`, `useCardArt(src)`, `ArtTitle`, `ProgressBar`, `CardSkeleton` | | Art that falls back when missing or broken and retries a new `src` (`useCardArt` for frames drawn elsewhere: `TvCard`, `Still`); logo-or-name on landscape art; the progress stripe; a card's skeleton |
| `Shelf` | `title`, `shape`, `action`, `items`, `skeletons`, `card(item)` | A titled row of cards with skeletons until `items` arrive |
| `PosterGrid` | `pager`, `stale`, `skeletons`, cards as children | Infinite poster grids |
| `TitleHeading` | `name`, `logo`, `look` hero/detail/tv-stage/tv-detail/tv-panel | The logo or the name as a heading |
| `TitleActions` | `request`, `picker`, `label`, `resume`, `playTitle`, `onWarm`, `onTrailer`, `item`, `playlist`, `download`, children | The title page action row |
| `LibraryButton` | `item` | The + / ✓ library toggle |
| `useSourcePicker(onOpen?)` + `SourcePicker` | `picker` | Play-or-choose with the sources sheet, once per page |
| `SeasonPicker` | `value`, `options` {id, label}, `onChange` | Season tabs (up to 6) or a large dropdown |
| `EpisodeCard`, `EpisodeShelf` | see the files | Desktop episodes; state from `episodeState` (`lib/episodeState.ts`) |
| `usePlaylistChecklist(item)` + `PlaylistChecklist` | `look` menu/popover | Add to playlists (TV draws its rows from the hook) |
| `TitleDetails`, `DetailsSection`, `DetailsColumns`, `FactList`, `DetailsLinks` | | The Details tab and its parts |

**Settings (`components/settings/`, `lib/settings/`)**

| Component | Use it for |
|---|---|
| `SettingRow` (`id`, `caption?`, `disabled?`, `onChanged?`) | A row for one stored setting: the schema entry (`lib/settings/schema.ts`) decides switch, dropdown or slider, its wording, range and fallback. TV draws the same entries (`tv/TvSettings.tsx`) |
| `Card`, `RowText`, `ToggleRow`, `PickRow`, `NumberRow`, `ExpandRow`, `LinkRow`, `useExpanded` (`rows.tsx`) | Hand-written rows that don't fit the schema |
| `ActionRow`, `FormRow` (`rows.tsx`) | A row with one button; a row with one field and its submit (dirty check, `pending` text, `error`) |

**Still in `components/` (shared, not moved):** `Sheet` (bottom/side sheet on `useLayer`), `Dropdown` (Base UI
Select), `Segmented`, `SliderField`, `Spinner`, `BusyLabel`, `ConfirmDeleteButton`, `Row` (the rail `Shelf`
draws), `StillPlaceholder`/`Still`.

**TV and player.** TV keeps its own layouts and spatial focus (§4 "TV") and uses the primitives through
`variant="tv"` (`EmptyState`, `Toast`) or the `.tv` scope, and the same hooks (`useBack`, `useCardIntent`,
`useCardArt`, `useTitlePlayback`, `usePlaylistChecklist`, `episodeState`, the settings schema). The player keeps
`Scrubber`, `OptionsOverlay`, `SkipButton` and the start-up screen; its glyph buttons are `IconButton`s.

**Planned in §4 and not built** (each would change what's on screen, or wasn't needed): `Button`
`variant="link"`, `CopyButton`, `ToastHost` and toast placement, `ErrorText`, `ChoiceGrid`, `Segmented` as a
radio group with looks, a `Slider` primitive in `ui/`, one `Dialog`, one popover surface, a `Facts` component
(the two helpers in `lib/format.ts` instead), and the player and party notes as `Toast`s (docs/unverified.md asks the owner).

---

## 1. Facts

- **Styling.** Plain global CSS, one file per area, all imported eagerly from `main.tsx:14-28`.
  `styles/tokens.css` holds colour, glass, motion, radius and card-size tokens. Many rules don't use them:

  | | literals | through tokens |
  |---|---|---|
  | colours | ~420 `rgb()`/hex literals; `rgb(255 255 255 / 0.08)` alone 22×, which is `--hairline` | the rest |
  | radii | ~110 literals (`8px` 18× = `--r-sm`; `50%` 20×) | ~78 |
  | durations | ~110 literal ms/s, bare `ease` 130×+ | ~160 `var(--dur-*)` |
  | font sizes | ~200 literal sizes, 7 values cover nearly all | `.t-*` classes exist, are rarely used |
  | z-index | 25 distinct values from −2 to 2147483647, no scale | none |
  | shadows / blur | 21 elevation stacks, 12 literal blur recipes | `--blur-glass`, `--blur-control` 11× |

- **Tailwind is unused.** `styles/tailwind.css` is imported by nothing and its `@source` points at the
  deleted `catalyst-ui/`. `vite.config.ts:3,7` still runs `@tailwindcss/vite`, and `tailwindcss` and
  `@tailwindcss/vite` are dependencies. No `className` uses a utility class.
- **Three style systems for the same app:** the app's own (`.btn`, `.settings-*`), the settings overlay's
  (`.t3s`, with its own `--t3-*` tokens at `settings-overlay.css:10-21` that restyle `.settings-row`,
  `.switch`, `.btn` and `.select-trigger` with 122 overrides), and the account screens' (`.auth-*`, with a
  private grey palette `#f7f8f8`/`#8a8f98`/`#62666d`, `account.css:127-251`).
- **TV mode** (`tv/`, `tv.css` 2022 lines) reuses the player, `StreamList`, `TitleDetails`, the hooks and a
  few small parts, and re-implements cards, rails, hero, title page, episodes, menus, nav, search and settings
  (§3). It sizes in `rem` against a fluid root (`tv.css:10`), so it skips the px `--r-*` tokens, and it has
  its own `--tv-*` tokens (`tv.css:13-22`).
- **Base UI** (`@base-ui/react`) is used for Select (`Dropdown`), Menu (`CardMenu`, `ProfileMenu`, NavBar
  "More", `DownloadMenu`), Popover (`PlaylistButton`, source filters), Dialog (`SettingsOverlay`, party join)
  and Slider (`SliderField`). Sheets, the trailer, the player overlays and every TV layer are hand-made.
- **No component has its own stylesheet.** A component's classes live wherever the first screen that
  needed them was styled. For example, `SliderField` uses `.srcf-slider-*` from `sheet.css:415`,
  `ToggleChip` extends `.srcf-tag`, `UpdateToast` uses `.tv-prompt` from `tv.css:1831`,
  `.still-placeholder` is in `player.css:1217`, `.imdb-badge` exists only in `tv.css:279`, and NavBar's
  "More" menu borrows `.profile-menu`.

## 2. Inventory

One line per element: where it is, what it does, and what it's built from. "Hand" means hand-rolled
markup rather than a shared component.

### 2.1 App shell and chrome

| Element | Where | Notes |
|---|---|---|
| `App` / `Screen` / `DesktopApp` | `App.tsx:37,196` | Account gate. Mounts `ControllerToast`, `UpdateToast`, `WhatsNewSheet`, `PlayerLayer`, `SettingsOverlay`, `CardMenuHost` and `TrailerHost` (`:242-249`). Global Esc→back and the search hotkey (`:204`, M25). |
| Page stack | `App.tsx:198-201,231-240`; TV `TvApp.tsx:70-73,204-222` | Two renderers (M30). |
| `NavBar` | `components/NavBar.tsx:39` | Brand, back (`.navbar-icon`), `NavLinks` (`:107`, overflow into a "More" Base UI menu), `SearchBox` (`:180`), `SearchSuggestions` (`:299`, portal with genre chips), profile, update pill, window controls. The blur fade is a 4-layer copy of `EdgeBlur` (`:53-58`). |
| `TvNav`, `TvMenu`, `TvHints`, `PadGlyph`, `ControllerToast` | `tv/TvChrome.tsx:46,96,188,239,267` | TV nav (avatar, tabs, clock), side drawer, controller hint bar. `PadGlyph`/`usePadGlyph` and `ControllerToast` are also used on desktop. |
| `ProfileMenu` | `components/ProfileMenu.tsx:18` | Base UI menu, `.profile-menu`. |
| `WindowControls` | `components/WindowControls.tsx:7` | Three hand-drawn SVG buttons. |
| `UpdateToast`, `UpdatePill`, `WhatsNewSheet`, `ReleaseNotes` | `components/Updates.tsx:21,114,143,186` | The toast reuses `.tv-prompt`. It has its own progress bar `.update-progress` and a small Markdown renderer. |
| Account frame | `screens/account/AccountShell.tsx:5` | Drag region and window controls. |

### 2.2 Cards, rails and grids

| Element | Where | Notes |
|---|---|---|
| `PosterCard`, `LandscapeCard`, `ProgressBar`, `CardSkeleton`, `PosterSkeleton`, `useIntent` | `components/PosterCard.tsx:31,59,85,93,104,13` | `.card*` (`cards.css:467-789`). Hover/focus prefetch after 120 ms. Text fallback for broken art. |
| `AnimeCard`, `AnimeLandscapeCard`, `MatureCover` | `components/anime/AnimeCard.tsx:74,118,18` | Markup parallel to `PosterCard`. Adds `--cover`, a kind badge and a star score. Prefetch after 150 ms. |
| `ContinueCard` | `screens/Home.tsx:316` | Hand-made landscape card, `div role=link` with manual Enter/Space, resume button. |
| `DownloadCard` | `screens/Library.tsx:189` | Hand-made landscape card. |
| `EpisodeCard`, `ShelfStill` | `components/EpisodeShelf.tsx:88,79` | `.episode-*`. Floating glass buttons for sources and download. `ShelfStill` duplicates `Still`. |
| `PlaylistTile`, "New Playlist" tile | `components/Playlists.tsx:140`; `screens/Library.tsx:430` | Fanned covers. The new tile is hand-made. |
| `CollectionTile` | `screens/Library.tsx:174` | Library overview tiles. |
| `CalendarItem`, `ScheduleSlot` | `screens/Calendar.tsx:66`; `screens/Anime.tsx:346` | Time-slotted rows. Same job, two class families. |
| `TvCard`, `TvAnimeCard` | `tv/TvRails.tsx:21`; `tv/TvAnime.tsx:139` | One card with `data-shape`. Focus is the selection. Prefetch after 450 ms. Opens `TvCardMenu`. |
| `Row` | `components/Row.tsx:9` | Desktop shelf: native scroll, paddles with `EdgeBlur`. |
| `TvRail`, `TvItemsRail`, `TvShelfRail`, `TvContinueRail`, `TvSkeletonRail`, `TvBrowse` | `tv/TvRails.tsx:115-226` | Focus-driven rails; the focused card stays pinned left. |
| Shelf loaders | `Home.tsx:256` `CatalogRow`, `:281` `LazyShelf`; `Anime.tsx:218` `Shelf`, `:242` `GenreShelf`; `Search.tsx:72,81` | Same "Row + items or skeletons" job; two copies of the IntersectionObserver loader (M30). |
| Poster grids | `Discover.tsx:65`, `Anime.tsx:502`, `Library.tsx:282,298,426,486` | `.poster-grid`; two copies of the infinite-scroll sentinel. |
| Rating displays | `ImdbBadge.tsx:4,22`, `RatingRing.tsx:11`, `TitleDetails.tsx:145,185`, `AnimeDetail.tsx` `.anime-score` | Five ways to show a score. The ≥7/≥5 tone thresholds are copied 3× (`ImdbBadge.tsx:5,30`, `RatingRing.tsx:17`). |

### 2.3 Title pages and heroes

| Element | Where | Notes |
|---|---|---|
| `HeroCarousel`, `HeroContent`, `HeroPeek` | `screens/Home.tsx:79,214,206` | Auto-advances every 9 s. Dot pager is a hand-made `role=tablist` (`:170-185`). |
| `AnimeHeroContent` | `screens/Anime.tsx:178` | Copy of `HeroContent` without the library button. |
| `Detail`, `DetailHero`, `Seasons`, `SeriesBody` | `screens/Detail.tsx:58,111,271,259` | Backdrop layers, trailer, `EdgeBlur`, credits `dl`, two sources sheets. |
| `AnimeDetail`, `Hero`, `Episodes`, `SeasonTabs`, `Related`, `Characters`, `Details` | `screens/AnimeDetail.tsx:56,225,378,593,693,755,833` | Same shell as `Detail`. Own play model (`usePlayback :114`, M28), own range tabs, own details section (hand-made copy of `TitleDetails`). |
| `TvStage`, `TvBackdrop`, `TvAmbient`, `StageProvider` | `tv/TvStage.tsx:334,376,410,281` | Focus-driven hero. |
| `TvDetail`, `Actions`/`ActionPill`, panels | `tv/TvDetail.tsx:37,129,297`; panels at `:192,253,345,454,485` | Vertical pill column; Episodes, Details, Sources, Playlists and Name panels. |
| `TitleDetails`, `Cast`, `ScoreCards`, `ScoreChips`, `FormatBadges` | `components/TitleDetails.tsx:19,109,145,185,219` | Shared by Detail and TV. |
| `Trailer` / `TrailerHost`, `useBackdropTrailer`, `AmbientWash`, `TitleLogo`, `Img`, `EdgeBlur` | `components/*` | Media helpers. `TrailerHost` is a hand-made `role=dialog`. |

### 2.4 Menus, popovers, sheets, dialogs

| Element | Where | Notes |
|---|---|---|
| `CardMenu` / `cardMenu()` / `CardMenuHost` | `components/CardMenu.tsx:52-200` | Base UI context menu `.ctx-menu`, playlist submenu, external links. |
| `DownloadMenu` | `components/DownloadButton.tsx:110` | Base UI menu with the `.ctx-menu` look; its own `Item` copy (`:201`). |
| `ProfileMenu`, NavBar "More" | `ProfileMenu.tsx:18`; `NavBar.tsx:161` | `.profile-menu`, the same surface as `.ctx-menu` copied. |
| `Dropdown` | `components/Dropdown.tsx:17` | Base UI Select `.select-*`, sizes default/large. |
| `PlaylistButton` | `components/Playlists.tsx:29` | Base UI Popover holding a hand-made `menuitemcheckbox` list with no arrow keys. |
| Source filter popover | `components/SourceFilters.tsx:137` | `.srcf-popover`, almost identical to the large `.select-popup`. |
| `TvCardMenu` | `tv/TvCardMenu.tsx:362-576` | Placed beside the card, layered panels. |
| `Sheet` | `components/Sheet.tsx:14` | Side sheet with spring drag-to-dismiss. Esc is a window capture listener. No focus trap. |
| `SettingsOverlay` | `components/SettingsOverlay.tsx:39` | Base UI Dialog with a search combobox. |
| Party join dialog | `components/party/PartyHost.tsx:57` | Base UI Dialog with its own scrim and close button. |
| `OptionsOverlay` | `components/player/OptionsOverlay.tsx:54` | Full-window radio columns. Own focus movement (`:219`). |
| TV panels / drawer / card menu | `tv/TvDetail.tsx`, `TvChrome.tsx:96`, `TvCardMenu.tsx` | `useFocusTrap` + `useBack`. |

### 2.5 Controls

| Job | Implementations |
|---|---|
| Buttons | `.btn`, `.btn-primary`, `.btn-glass`, `.btn-icon` (`base.css:197-261`); `.btn-danger` defined only in `settings-overlay.css`; account screens `.auth-btn`/`.auth-btn-primary` (`account.css:145`), `.auth-primary` (`:378`), `.profiles-done`/`.profiles-manage` (`:678`); TV `.tv-pill` (`tv.css:730-835`). |
| Icon buttons | `.btn-icon`, `.navbar-icon`, `.player-icon` (44 px), `.player-transport`, `.options-head-btn` (34), `.options-close` (32), `.party-dialog-close` (32), `.t3s-icon-btn`, `.shortcut-tool`, `.row-paddle`, `.btn-icon.quiet-btn`, `.confirm-delete`; four separate small "×" clear buttons (`.market-search-clear`, `.navbar-search-clear`, `.t3s-search-clear`, `.shortcut-capture-cancel`). |
| Text links | `.settings-link`, `.anime-row-link`, `.library-see-all`, `.playlist-back`, `.auth-link`, `.auth-link-quiet`, `.auth-back`, `.account-bar-link`. |
| Text inputs | `.settings-input`, `.shortcut-search`, `.market-search` (identical rules, `screens.css:373,450`, `marketplace.css:10`); `.auth-input`, `.auth-field input`, `.profile-editor-name`, `.playlist-name-input`, `.anime-search`; TV `TvKeyboard` (`tv/TvKeyboard.tsx:20`). |
| Search fields | `.navbar-search` (opens out of an icon), `.t3s-search` (kbd hint), `.market-search` (also in `Anime.tsx:435`), `.shortcut-search`, `.srcf-chiprow-search`, `.pill-search` (`AnimeDetail.tsx:495`). Esc-to-clear is written 3× (`SettingsOverlay.tsx:133`, `ShortcutSettings.tsx:46`, `NavBar.tsx:271`). |
| Segmented / tabs | `Segmented` (`components/Segmented.tsx:19`, clip-path pill; re-skinned in `detail.css:337`, `anime.css:424`, `sheet.css:210`); hand-made `role=tab` strips: hero dots `Home.tsx:170`, anime days `Anime.tsx:320`, anime ranges `AnimeDetail.tsx:482` (M31: they are radio groups). |
| Chips | `.genre-chip` (`base.css:575`), `.source-chip` (`player.css:980`, used by `SourceFilters.tsx:277` and `SubtitleSettings.tsx:336`), `.srcf-tag` removable (`sheet.css:454`), `ToggleChip` = `.srcf-tag.toggle-chip`, `.anime-tag`, `.anime-ranking` (also used as a disclosure button), `.details-link`, `.score-chip`, `.badge`, `.episode-tag`, `.card-kind-badge`, `.format-badge`. |
| Switches | `.switch` (`screens.css:1491`) inside `ToggleRow` (`Settings.tsx:197`), `.settings-expand-toggle` (`:2026`) and `.anime-toggle` (`AnimeDetail.tsx:509`); 7 `.t3s .switch` overrides change its look in the overlay. |
| Sliders | `SliderField` (Base UI + number box, `components/SliderField.tsx:9`), player volume native `<input type=range>` (`Player.tsx:861`), `Scrubber` (custom `role=slider`, not keyboard-operable, `components/player/Scrubber.tsx:23`). |
| Steppers / pickers | `SubtitleSettings` private `Stepper`, `Swatches`, `Chips` (`components/player/SubtitleSettings.tsx:260,294,336`); `.settings-swatch` (`Settings.tsx:854`); TV settings `Row` left/right stepper (`tv/TvSettings.tsx:248`). |
| Avatar choice grids | `OnboardingScreen.tsx:87-105` and `ProfilesScreen.tsx:411-433`, each with its own `moveFocus` (`:10`, `:136`, diverged). |
| Confirm before delete | `ConfirmDeleteButton` (arm, then confirm; only used at `Library.tsx:480`), `ProfilesScreen.tsx:353-373` (state flag, second button), `Settings.tsx:330` (type "delete"). |
| Busy buttons | `BusyLabel`/`BusyRing` (`components/BusyLabel.tsx:11,27`; account, TV and party only), "Saving…"/"Installing…" text swaps (`Settings.tsx` forms, `Marketplace.tsx:105`), in-button `Spinner` (`DownloadButton.tsx:82`). |
| Copy buttons | `CopyDetails` (`Player.tsx:1254`, text swap 2.5 s), party invite copy (`PartyUI.tsx:40-49`, blur crossfade 1.8 s). |
| Library toggle | Identical `btn btn-glass btn-icon` + `SwapIcon` at `Home.tsx:237`, `Detail.tsx:184`, `AnimeDetail.tsx:304`. |

### 2.6 Feedback

| Job | Implementations |
|---|---|
| Spinner | One `Spinner` (`components/Spinner.tsx:5`). Good. |
| Skeletons | `CardSkeleton`/`PosterSkeleton`; inline ones in `StreamList.tsx:36`, `Calendar.tsx:35-37` (inline height 96), `Anime.tsx:332` (88), `Home.tsx:122`, `Detail.tsx:81`, `AnimeDetail.tsx:72`; `TvSkeletonRail` (`tv/TvRails.tsx:126`). |
| Empty / error states | About 25 ad-hoc `p.empty t-body muted`; plus `.stream-empty`, `.stream-failed`, `.trailer-empty`, `.market-empty`, `.t3s-empty`, `.calendar-empty`, `.anime-unreachable` (the only one with "Try again"), `.srcf-chiprow-empty`, `.library-hint`, `.tv-empty`, `.tv-note`. Inline errors: `auth-error`/`ErrorLine` (`AuthScreen.tsx:245`), `.settings-error`, `.download-row-error`. |
| Progress | `ProgressBar`; hand copy at `Library.tsx:388`; `.update-progress`; `OptionsOverlay.tsx:190`; download ring (`DownloadButton.tsx:159`); player load mark (`Player.tsx:1143`). |
| Toasts / floating notes | `.player-notice` (`Player.tsx:842`), `.party-hold`, `.party-note`, `.party-float` (`party.css`), `UpdateToast` and `ControllerToast` (`.tv-prompt`). |
| Entrance animations | Eight keyframes doing "fade, small move, maybe blur(4px)": `auth-step-in`, `hero-content-in`, `rise`, `profile-in`, `status-text-in`, `auth-in`, `search-suggest-in`, `auth-arrive`; three plain fades `fade-in`, `page-in`, `trailer-in`. |

### 2.7 Player and party

| Element | Where | Notes |
|---|---|---|
| Player root, chrome auto-hide, click surface | `screens/Player.tsx:786,210-244,802` | State through `data-*` on `.player`. |
| Top bar, centre transport, bottom bar | `Player.tsx:847,885,906` | Volume slider, `SkipIcon` (`components/player/icons.tsx`), `ActionButton` row (`:1272-1291`). |
| Up Next card | `Player.tsx:1022-1065` | `.next-up`, motion slide. |
| Start-up screen, step log, copy details | `Player.tsx:1155-1254` | `PlayerStatus`, `StartSteps`, `CopyDetails` (T-022). |
| `OptionsOverlay` + `Row` | `components/player/OptionsOverlay.tsx:54,172` | Speed, Tracks, Party, Episodes, Sources. |
| `Scrubber`, `SkipButton`, `SubtitleSettings`, `SubtitlePreview`, `VideoBackdrop` | `components/player/*` | |
| Party | `components/party/PartyUI.tsx:20-239`, `PartyHost.tsx:17` | Start, invite, members, join form, badge, hold, notes. TV has its own join screen (`tv/TvJoinParty.tsx:13`). |

### 2.8 Settings and account

| Element | Where | Notes |
|---|---|---|
| Settings primitives | `screens/Settings.tsx:178` `Card`, `:188` `RowText`, `:197` `ToggleRow` (46×), `:225` `PickRow` (29×), `:235` `ExpandRow` (8×), `:267` `LinkRow`, `:360` `NumberRow` (10×), `:278` `useExpanded` | Not exported; `Marketplace.tsx:59-109` and `ShortcutSettings.tsx:36-66` write the same markup by hand. |
| Ad-hoc settings rows | `Settings.tsx:292,305,1394,1491,1509,1622` (row + button); `:655,1255,1804` (input + Save); `:339,1867,1941,1996` (expand form) | No `ActionRow`/`FormRow`. Each repeats its dirty check and busy text. |
| `SettingsPageBody` | `Settings.tsx:143` | Used by the old page and by the overlay (M26). |
| TV settings | `tv/TvSettings.tsx:83,248` | Separate list of about 35 settings, different wording and choices (H15). |
| `ShortcutSettings`, `Keycaps`, `ShortcutRow` | `components/ShortcutSettings.tsx:24,81,96` | |
| `Marketplace` | `components/Marketplace.tsx:16` | |
| `AuthScreen`, `OnboardingScreen`, `ProfilesScreen`, `ProfileEditor`, `IconPicker` | `screens/account/*` | Own buttons, inputs, errors and animations. |

## 3. Duplicate groups

Each group is one job done by several pieces of code. "Target" names the component from §4 that replaces
them. "Look" says what has to stay visually distinct after the merge (as a variant), so nothing changes on
screen.

| # | Job | Members | How they differ | Target | Look kept as |
|---|---|---|---|---|---|
| U1 | Title card | `PosterCard`/`LandscapeCard`, `AnimeCard`/`AnimeLandscapeCard`, `ContinueCard` (`Home.tsx:316`), `DownloadCard` (`Library.tsx:189`), "New Playlist" tile, `TvCard`, `TvAnimeCard` | Prefetch delay 120/150/450 ms; broken-art fallback copied 3×; `ContinueCard` is a `div role=link`; anime adds kind badge and cover colour | `Card` (shape poster/landscape/episode, slots for art, badge, progress, caption, actions) + `useCardIntent(delay)` | `shape`, `variant="tv"` (ring and lift, no caption) |
| U2 | Shelf / rail | `Row`, `TvRail`; loaders `CatalogRow`/`TvShelfRail` (near-verbatim copy with `MIN_FRESH = 6`), `LazyShelf`/`GenreShelf`/`TvBrowse` lookahead | Scroll vs focus-pinned | `Shelf` (data + skeleton + lazy) over `Row` (desktop) or `TvRail` (TV); `useNearViewport` | Two track renderers, one data layer |
| U3 | Infinite grid | `Discover.tsx:36-65`, `Anime.tsx:405-502` | Skeleton type | `PosterGrid` + `useInfiniteSentinel` | — |
| U4 | Hero | `HeroContent`, `AnimeHeroContent`, `DetailHero`, anime `Hero`, `TvStage` | Facts line built 4 ways (`titleFacts`, `hero-kind`, `detail-facts`, anime facts) | `TitleHeading` (logo or title + `Facts` + synopsis) used by all; `HeroCarousel` and `TvStage` stay as layouts | Per-layout CSS |
| U5 | Title page actions | Play/Trailer/Library/Playlist/Sources/Download at `Detail.tsx:169-204`, `AnimeDetail.tsx:293-316`, `TvDetail.tsx:129`; play-or-pick rule 5× (H14) | Anime lacks Playlist/Download | `useTitlePlayback(model)` + `TitleActions` (`layout="row"` icon buttons / `"column"` TV pills); `LibraryButton` | Row vs column |
| U6 | Source picker | Sheet + `StreamList` at `Detail.tsx:233,357`, `AnimeDetail.tsx:322,561`; `SourcesPanel` (`TvDetail.tsx:485`); player Sources overlay | Subtitle text only | `SourcePicker` (opens `Sheet` on desktop, panel on TV) | — |
| U7 | Season / range picker | `Detail.tsx:313-331`, `AnimeDetail.tsx:593-611` (`MAX_SEASON_TABS` twice), ranges `AnimeDetail.tsx:471-488`, TV season column | Thresholds 6 / 4 | `SeasonPicker` (Segmented up to N, Dropdown above) | — |
| U8 | Episode list | `EpisodeShelf`/`EpisodeCard`, `TvDetail` `EpisodesPanel` (`:345`); watched/in-progress logic and `shortRuntime` copied | Layout | `useEpisodeStates` + `EpisodeCard` with `variant="tv"` | — |
| U9 | Popup menu | `.ctx-menu` (`cards.css:792`) and `.profile-menu` (`account.css:931`) byte-identical; `DownloadMenu`; NavBar "More"; `.playlist-menu` popover; `.search-suggest`; `.select-popup` large ≈ `.srcf-popover`; TV `TvMenu`, `TvCardMenu`; two `Item` helpers (`CardMenu.tsx:193`, `DownloadButton.tsx:201`) | Highlight colour, radius 10/13/1.25 rem | `Menu` (+ `MenuItem`, `MenuCheckItem`, `MenuSeparator`, `MenuSub`) on Base UI; one `.surface-popover` recipe | TV keeps its own placement; same surface tokens |
| U10 | Add-to-playlist | `CardMenu.tsx:145-175`, `PlaylistButton` (`Playlists.tsx:29-111`), TV `PlaylistsPanel` (`TvDetail.tsx:192`); `freshName` twice (`TvDetail.tsx:181`, `CardMenu.tsx:206`) | Naming flow | `PlaylistChecklist` (rows + "New Playlist"), shown in a `MenuSub`, `Popover` or TV panel | — |
| U11 | Modal layer | `Sheet`, `TrailerHost`, `SettingsOverlay`, party dialog, `OptionsOverlay`, TV panels/drawer/card menu; 11 window keydown listeners (M25) | Each has its own scrim, timing, Esc and focus handling | `Layer` (scrim, focus trap, `useDismiss` on one shared dismiss stack), used by `Sheet`, `Dialog`, `Overlay` | Each keeps its motion |
| U12 | Buttons | `.btn*` vs `.auth-btn*`/`.auth-primary`/`.profiles-*` vs `.t3s .btn` overrides vs `.tv-pill`; `.btn-danger` only in the overlay | Height 2.25–3 rem, radius pill vs 8 px | `Button` (`variant` primary/glass/plain/danger/link, `size` sm/md/lg, `icon`, `busy`) | Account buttons become `size="lg"` |
| U13 | Icon buttons | ~14 classes (§2.5), sizes 32/34/40/44, hover fills 0.12/0.14/`--glass-control` | Size, fill | `IconButton` (`size`, `variant` glass/plain/overlay) and `ClearButton` | Sizes kept as the size scale |
| U14 | Text and search inputs | 3 identical input classes + 5 variants; 6 search fields; Esc-to-clear 3× | Height and border | `TextField` and `SearchField` (clear button, Esc clears then blurs, optional kbd hint, `shape` pill/box) | `size`, `shape` |
| U15 | Chips | `.genre-chip`, `.source-chip`, `.srcf-tag`, `ToggleChip`, `.anime-tag`, `.anime-ranking`, `.details-link`; "light pill when pressed" written 3× and ~17× more in TV focus rules | Fill and pressed style | `Chip` (`pressed`, `removable`, `href`), `Badge` (static) | Variants `filter`, `tag`, `link` |
| U16 | Choice group | `Segmented`, hero dots, anime days, anime ranges, subtitle `Chips`, TV left/right settings `Row` | Roles: tabs vs radios (M31) | `Segmented` as a radio group (`role=radiogroup`), with a `pill` and a `chips` look | — |
| U17 | Switch | `.switch` in 3 wrappers, overlay overrides | Overlay look | `Switch` (Base UI Switch or the existing input) | Overlay look becomes a token set, not overrides |
| U18 | Slider | `SliderField`, volume range, `Scrubber` | Keyboard support | `Slider` (Base UI) for settings and volume; `Scrubber` stays its own component but gains keys | — |
| U19 | Settings rows | `Settings.tsx` primitives; hand copies in `Marketplace`, `ShortcutSettings`; ad-hoc action/form rows; `TvSettings` `Row`; the overlay's restyle | Two stores side by side (M27) | `settings/` primitives exported (`SettingsCard`, `ToggleRow`, `PickRow`, `NumberRow`, `ExpandRow`, `LinkRow`, new `ActionRow`, `FormRow`) rendered from one schema (H15); TV renders the same schema with its stepper row | Desktop/TV row renderers |
| U20 | Empty / error / loading | ~25 `p.empty`, 10 other empty classes, 3 inline error classes, 7 inline skeletons | Retry exists once | `EmptyState` (`title`, `body`, `action`), `ErrorText`, `Skeleton` (`shape`, `height`) | — |
| U21 | Toast | `.player-notice`, `.party-hold`, `.party-note`, `UpdateToast`, `ControllerToast` | Position, animation | `Toast` (icon, text, actions, `placement`) + one host | Placement |
| U22 | Progress | `ProgressBar`, `Library.tsx:388`, `.update-progress`, `OptionsOverlay.tsx:190` | — | `ProgressBar` (the ring and the load mark stay) | — |
| U23 | Busy / copy feedback | `BusyLabel` vs text swaps vs in-button spinner; two copy buttons | — | `Button busy` uses `BusyLabel`; `CopyButton` | — |
| U24 | Confirm delete | `ConfirmDeleteButton`, profiles two-step, type "delete" | Danger level | `ConfirmDeleteButton` for normal deletes; keep "type delete" for account deletion as a `ConfirmField` | — |
| U25 | Choice grids | Avatar grids in onboarding and profiles, two `moveFocus` | Arrow-key directions | `ChoiceGrid` + one `useGridFocus` (shared with TV spatial rules where possible) | — |
| U26 | Rating | `ImdbBadge`, `CardRating`, `RatingRing`, `ScoreCards`/`ScoreChips`, `.anime-score`; tone thresholds copied | — | `scoreTone()` in lib; components keep their looks | All looks kept |
| U27 | Details section | `TitleDetails` vs hand copy in `AnimeDetail.tsx:833` | Anime adds rankings, tags, characters | `TitleDetails` with optional sections | — |
| U28 | Nav and profile menu | `NavBar` vs `TvNav` (tab lists `TvChrome.tsx:23-40` vs `NavBar.tsx:47-49`), `ProfileMenu` vs `TvMenu` | Layout | `useNavTabs()` and `useProfileMenuItems()` shared; two renderers | Both |
| U29 | Search screen | `Search` + NavBar suggestions vs `TvSearch`; debounce 180/250 ms; genre lists in 3 places | — | `useSearch()` (one debounce, one genre list in `lib/genres.ts`) | Both layouts |
| U30 | Entrance animation | 8 keyframes for one effect, 3 plain fades | Distance 4–10 px | `@keyframes enter` with `--enter-y` and `--enter-blur` custom properties; one `fade-in` | Distances become per-use variables |
| U31 | Module-store hosts | `CardMenu.tsx:32-77`, `Trailer.tsx:24-41`, `TvCardMenu` store, ~15 lib stores (M30) | — | `createStore()` in lib | — |
| U32 | Icons | `PlaylistIcon` = `LayoutList`; `ExternalGlyph` vs `ArrowUpRight`; hand SVGs in `WindowControls`, `Updates`, `SkipIcon`, `Tomato`/`Splat` | — | Everything through `components/icons.tsx` | Same glyphs |

## 4. Target component set

All in `src/components/ui/` unless noted. Each is one `.tsx` with its CSS in `src/styles/ui/<name>.css`
(§7). Screen-level parts move to `components/title/`, `components/settings/` and so on.

**Primitives (`components/ui/`)**

| Component | Replaces | API sketch |
|---|---|---|
| `Button` | U12, U23 | `variant: "primary" \| "glass" \| "plain" \| "danger" \| "link"`, `size: "sm" \| "md" \| "lg"`, `icon?`, `busy?`, polymorphic `href` |
| `IconButton`, `ClearButton` | U13 | `label` (required, becomes `aria-label`), `size: 32 \| 36 \| 44`, `variant: "glass" \| "plain" \| "overlay"` |
| `CopyButton` | U23 | `text`, `label`, `copiedLabel` |
| `ConfirmDeleteButton` | U24 | existing, moved |
| `TextField`, `SearchField` | U14 | `SearchField`: `value`, `onChange`, `onEscape?`, `kbd?`, `shape: "pill" \| "box"`, `expandable?` (navbar) |
| `Chip`, `ToggleChip`, `Badge` | U15 | `Chip`: `pressed?`, `variant: "filter" \| "tag" \| "choice" \| "link" \| "badge"`; `ToggleChip` (on/off with the check); `Badge`: `variant: "rank" \| "tag"` (static) |
| `Segmented` | U16 | existing, made a radio group; `look: "pill" \| "chips" \| "dots"` |
| `Switch` | U17 | `checked`, `onChange(checked)`; named by the `<label>` around it |
| `Slider` | U18 | Base UI; `withInput?` covers `SliderField` |
| `Dropdown` | — | existing |
| `Menu`, `MenuItem`, `MenuCheckItem`, `MenuSeparator`, `MenuSub`, `ContextMenu` | U9 | Base UI Menu with one surface; `ContextMenu` keeps the `cardMenu()` spread API |
| `Popover` | U9 | Base UI Popover with the same surface |
| `Layer`, `useDismiss` | U11 | the shared dismiss stack (M25); scrim, focus trap, restore focus |
| `Sheet`, `Dialog` | U11 | `Sheet` existing on `Layer`; `Dialog` for party join, trailer and settings overlay |
| `Toast`, `ToastHost` | U21 | `toast({icon, text, actions, placement, timeout})` |
| `EmptyState`, `ErrorText`, `Skeleton`, `Spinner`, `ProgressBar`, `BusyLabel` | U20, U22 | `EmptyState`: `title?`, `body`, `action?` |
| `ChoiceGrid` | U25 | `options`, `value`, `columns`, renders `role=radiogroup` |

**Title parts (`components/title/`)**: `Card` (+ `useCardIntent`), `Shelf`, `PosterGrid`, `TitleHeading`,
`Facts`, `TitleActions`, `LibraryButton`, `SourcePicker`, `SeasonPicker`, `EpisodeCard`, `PlaylistChecklist`,
`TitleDetails`, the rating components. Hooks in `lib/`: `useTitlePlayback`, `useEpisodeStates`,
`useNearViewport`, `useInfiniteSentinel`, `useSearch`, `useNavTabs`, `useProfileMenuItems`, `scoreTone`,
`createStore`.

**Settings (`components/settings/`)**: the primitives from `Settings.tsx:178-360` plus `ActionRow` and
`FormRow`; a declarative schema in `lib/settings/schema.ts` that the desktop pages, TV and the search index
all read (H15, M27).

**TV.** TV keeps its own layouts (`TvRail`, `TvStage`, `TvDetail` panels, `TvKeyboard`, `TvCardMenu`
placement, spatial navigation), because they work differently, not only look different. They are built from
the same primitives with `variant="tv"` or under the `.tv` scope, and the same hooks.

**Player.** The player keeps its own layout. Its icon buttons, toasts, chips, steppers and swatches move to
the primitives above (`IconButton variant="overlay"`, `Toast`, `Chip`, `Segmented look="chips"`). It keeps
`Scrubber`, `OptionsOverlay`, `SkipButton` and the start-up screen.

## 5. Tokens

### 5.1 Keep

Everything in `tokens.css` today: surfaces, text, accent (with `--accent-fg`, `--accent-hi`, `--focus`),
glass recipes, `--ease-*`, `--dur-*`, `--r-*`, layout and card sizes, and the theme/contrast/transparency/
reduce-motion switches.

### 5.2 Add

| Group | Tokens | Replaces |
|---|---|---|
| White fills | `--fill-1: rgb(255 255 255 / 0.04)`, `--fill-2: / 0.06`, `--fill-3: / 0.1`, `--fill-4: / 0.14` | ~110 literals (`/0.04` 13×, `/0.06` 24×, `/0.1` 15×, `/0.14` 9×, plus `/0.05` `/0.07` `/0.08` `/0.09` `/0.12` rounded to the nearest step after checking each by eye in T-019) |
| Scrims | `--scrim-1: rgb(0 0 0 / 0.35)`, `--scrim-2: / 0.5`, `--scrim-3: / 0.7` | ~45 literals |
| Popover surface | `--surface-popover: rgb(38 38 38 / 0.82)`, `--blur-popover: blur(40px) saturate(160%)`, `--r-popover: 1.25rem` | the 6 menu recipes (U9) |
| Floating dark | `--surface-float: rgb(22 22 22 / 0.88)`, `--surface-float-glass: rgb(16 16 16 / 0.78)` | toasts, `.next-up`, `.skip-button` |
| Tints | `--good-soft: color-mix(in srgb, var(--good) 20%, transparent)`, `--danger-soft` | the tinted literals in player and TV |
| Brand | `--brand-imdb: #f5c518`, `--brand-rt: #fa320a`, `--brand-letterboxd: #00e054` | 8 literals |
| Selected pill | `.is-selected` recipe: `background: var(--pill-light); color: var(--text-on-light)` as a shared rule or `@mixin`-like class | ~21 repeats |
| Radius | `--r-round: 50%`; drop `999px`/`8px`/`13px` literals in favour of `--r-pill`/`--r-sm`/`--r-md` | ~40 literals |
| Easing | `--ease-std: ease` (named, so it can be tuned once) | 130+ bare `ease` |
| Durations | use existing `--dur-*`; add `--dur-xslow: 500ms` for overlays | ~110 literals (`160ms` = `--dur-fast`, `220ms` = `--dur-base`, `300ms` = `--dur-slow` written out) |
| Type scale | `--fs-micro: 0.6875rem`, `--fs-xs: 0.75rem`, `--fs-sm: 0.8125rem`, `--fs-md: 0.875rem`, `--fs-base: 0.9375rem`, `--fs-lg: 1rem`, `--fs-xl: 1.0625rem` (+ the existing `.t-*` display sizes) | ~200 literal sizes; the settings overlay's px sizes |
| Elevation | `--shadow-1` (cards), `--shadow-2` (popovers: `0 18px 48px rgb(0 0 0 / 0.5)`), `--shadow-3` (dialogs: `0 32px 80px -16px rgb(0 0 0 / 0.85)`), `--ring-hairline: inset 0 0 0 1px var(--fill-2)` | 21 stacks |
| Z scale | `--z-raised: 1`, `--z-nav: 20`, `--z-player: 30`, `--z-toast: 35`, `--z-sheet: 40`, `--z-overlay: 50`, `--z-popover: 60`, `--z-modal: 900`, `--z-dropdown: 1000`, `--z-system: 2147483647` | 25 ad-hoc values; separates player and update toast (both 30 today) |
| Progressive blur | `.edge-blur` as the one implementation | the copy in `shell.css:111-126` |
| TV | Keep `--tv-*`, add `--tv-r-sm/md/lg` in rem and use them instead of 25 radius literals; focus ring from `--focus` (TV hard-codes `#fff` 5×) | TV literals |

The settings overlay's `--t3-*` set (`settings-overlay.css:10-21`) becomes either the app's tokens (if they
match) or a scoped override block of tokens. Its 122 restyle rules go away.

## 6. Bugs found on the way

These are small and come with T-019. Items 1-4 are fixed (`ed796a1`, `15e4412`).

1. **`auth-form-in` doesn't exist.** `account.css:513,545` animate with it, and no `@keyframes` of that name
   exists, so the profile form and editor appear without their entrance animation.
2. **Two menus ignore the accent setting.** `.ctx-menu-item[data-highlighted]` (`cards.css:860-861`) and
   `.profile-menu-item` (`account.css:992`) set `#0a84ff`, then `AccentColor`. `AccentColor` is the
   operating system's accent, not the one picked in Settings → Appearance.
3. **Dead CSS:** `.about-grid`, `.about-description`, `.about-label`, `.about-info`, `.about-cast`,
   `.cast-list`, `.cast-chip`, `.cast-avatar` and `.detail-tabs` (`detail.css:574-680`, ~75 lines);
   `.grid-section`, `.grid-title` (`shell.css:454-457`); `.badge-good` (`sheet.css:152`); `.navbar-signin`
   (`account.css:904`); `.tv-library`, `.tv-grid` (`tv.css:512-523`). Conversely, `.download-done`
   (`DownloadButton.tsx:194`) has no CSS.
4. **Tailwind is unused** (§1); remove `tailwind.css`, the Vite plugin and both dependencies (M24).
5. **Not keyboard-operable:** `Scrubber` (`tabIndex -1`); `PlaylistButton`'s menu has no arrow keys; hand
   tab strips use the tab role without tabpanels (M31); `Sheet` and `TrailerHost` don't trap focus.
6. **`ShelfStill`** (`EpisodeShelf.tsx:79`) doesn't reset `failed` when `src` changes. Harmless while
   each card is keyed by episode; the merged `Still` must reset it.
7. **Settings buttons open the old settings page.** `StreamList.tsx:47,79` route to `tab({name:"settings"})`;
   `Marketplace` uses `openSettings()` (M26).
8. **`outline: none|0` 57×** across the CSS (TV 20, account 10); each needs a `:focus-visible` replacement
   (M31).
9. **Infinite grids loaded late.** `Discover` and Anime → Browse watched their end marker with the window as
   the root and a 1200 px margin, but the page scrolls inside `.scroll`, which clips the marker; the margin
   never applied. Fixed in `useInfiniteSentinel` (root `.scroll`, like the lazy shelves).

## 7. Conventions

For new and moved code from T-019 on.

- **One component per job.** Before writing markup for a button, field, chip, menu, layer, toast, empty
  state or card, use the component in `components/ui/` or `components/title/`. If it can't do the job, extend
  it with a prop or variant; don't fork it.
- **Folders.** `components/ui/` primitives with no app knowledge; `components/title/`, `components/settings/`,
  `components/player/`, `components/party/` for app parts; `screens/` only composes; `tv/` holds TV layouts and
  spatial navigation. `lib/` never imports from `components`, `screens` or `tv` (M27).
- **CSS next to its component.** `styles/ui/<component>.css` per primitive, named after it; the class family
  is the component name in kebab case (`.icon-button`, `.icon-button[data-size="sm"]`). State goes in
  `data-*` or ARIA attributes (`[aria-pressed]`, `[data-variant]`), not extra classes. Screens may add
  layout (grid, gaps, position) but not restyle a primitive.
- **Tokens only.** No colour, radius, duration, easing, font size, z-index, shadow or blur literal outside
  `tokens.css`. Exceptions: gradients' alpha masks, brand colours (as tokens), `0`/`1px` hairlines.
- **TV variant.** A primitive takes `variant="tv"` or reacts to the `.tv` scope for size and focus look. Its
  behaviour is the same. Focus look on TV is the selected-pill recipe or the `--focus` ring.
- **Keyboard and layers.** Every layer registers with `useDismiss`; no new `window` keydown listeners. Every
  interactive element is reachable and operable by keyboard, has a visible `:focus-visible` style, and has an
  accessible name (`IconButton` requires `label`).
- **Motion.** `--dur-*` and `--ease-*` only; entrances use `@keyframes enter` with per-use variables;
  reduce-motion is already global (`tokens.css`).
- **Copy.** Title Case for buttons and headings as today ("Choose Another Source").

## 8. Order of work

T-019 does this in steps that each keep `tsc`, `vite build` and the tests green. Each step changes what
code draws, not what's on screen.

1. **Clean-up with no visual change:** remove Tailwind; delete dead CSS (§6.3); add the missing
   `auth-form-in` keyframes or point both rules at the shared entrance; add the tokens in §5.2 without using
   them yet.
2. **Token pass, file by file:** replace literals whose value equals a token exactly (hairlines,
   `--dur-fast`/`base`/`slow`, `--r-sm`, `--r-pill`, `--danger`, `--good`, `--accent`). Close-but-not-equal
   values (for example `/0.05` → `--fill-1` at 0.04) are listed and changed only where the difference can't
   be seen; the rest stay literal with a comment. Z-indexes go to the scale.
   *Done:* tokens in `tokens.css` (fills, scrims, popover/float surfaces, brands, `--ease-std`, `--fs-*`,
   `--z-*`, `--r-round`); ~600 exact-equal literals moved, z-indexes of app layers on the scale (`--z-toast`
   is 30, same as the player, until someone decides the order). Not yet: close-but-not-equal fills
   (`/0.05` `/0.07` `/0.08` `/0.09` `/0.12`), shadows, `--dur-xslow`, TV radii, the `--t3-*` set.
3. **Primitives:** `Button`, `IconButton`, `Chip`, `SearchField`/`TextField`, `Switch`, `EmptyState`,
   `Skeleton`, `Toast`, `Menu`/`Popover` surface, `Layer`/`useDismiss`. Move screens over one primitive at a
   time, account screens included.
   *Done:* `components/ui/Button.tsx` (`Button`, `IconButton`, `buttonClass()` for Base UI triggers and
   components that take a class) with its CSS moved from `base.css` to `styles/ui/button.css` (imported right
   after `base.css`, so the cascade is unchanged). Every `.btn` in the TSX goes through them; they emit the
   same class lists as before, so nothing changes on screen. `IconButton` requires `label`. The class names
   stay `.btn*` for now: the settings pages and the overlay restyle `.btn` by scope until step 5. Not yet:
   `size`, `variant="link"`, the account screens' `.auth-btn` (different height and font: needs the `lg`
   size), the other icon-button classes (`.options-head-btn`, `.t3s-icon-btn`, player glyph buttons, §2.5).
   `components/ui/Chip.tsx` (`Chip`, `ToggleChip`, `Badge`, `chipClass()`): every `.genre-chip`, `.srcf-tag`,
   `.source-chip`, `.details-link`, `.anime-ranking` and `.anime-tag` in the TSX goes through them, with the
   same class lists. Their rules moved to `styles/ui/chip.css` (imported after `button.css`); no rule in the
   files they jumped over matches those elements, and the built CSS holds the same rules as before, only
   reordered. Screens keep their size tweaks (`.search-suggest`, `.srcf-popover`, `.sub-settings`, `.tv`).
   A removable filter is a pressed `tag` chip with a close glyph; a separate `onRemove` wasn't needed. Not
   yet: the TV focus rules that repeat the light-pill recipe, `.anime-tag` spoiler colours as tokens.
   `components/ui/Switch.tsx` (`checked`, `onChange(boolean)`, native input props): the three `.switch`
   checkboxes; CSS moved from `screens.css` to `styles/ui/switch.css` (after `chip.css`, same check). The
   anime "Skip filler" switch gained `role="switch"`, like the others. The overlay's `.t3s .switch` restyle
   stays until step 5.
   `components/ui/SearchField.tsx` (`value`, `onChange(string)`, required `label`, `look` box/pill/mini/plain,
   `kbd`, native input props and `ref` to the input): the Marketplace, Shortcuts, Anime → Browse, episode,
   source-filter and settings-overlay searches. CSS in `styles/ui/search-field.css`: shared structure, clear
   button and three looks taken over rule for rule from `.market-search`/`.shortcut-search` (identical),
   `.pill-search` and `.srcf-chiprow-search`; screens keep only width (`.anime-search`,
   `.anime-episode-search`, `.srcf-chiprow-search`, `.shortcut-search`). The overlay uses `look="plain"` and
   draws its box in `.t3s-search`. Every field now has the clear button and Esc-clears-first (written once
   instead of 3×; listed in `docs/unverified.md`). Not yet: the NavBar field (opens out of an icon, Esc
   clears then blurs, suggestions under it: `expandable` later).
   `components/ui/TextField.tsx` (`value`, `onChange(string)`, native input props): the nine `.settings-input`
   fields (Settings forms and keys, the new-playlist name), class renamed `.text-field`, CSS moved from
   `screens.css` to `styles/ui/text-field.css`; the built CSS is the same rules with the new name. Not yet: the
   account inputs (`.auth-input`, `.auth-field input`, `.profile-editor-name`), `.playlist-name-input`,
   `.party-join-input`.
   `components/ui/EmptyState.tsx` (message as children, optional `action` link, `className` for spacing): the
   21 `p.empty t-body muted` notes and Anime's "Try again" one, class renamed `.empty-state`, CSS moved from
   `shell.css` to `styles/ui/empty-state.css` (same rules). Not yet: the panel-specific empty notes with their
   own looks (`.stream-empty`, `.trailer-empty`, `.market-empty`, `.t3s-empty`, `.srcf-chiprow-empty`,
   `.options-empty`, `.tv-empty`), `ErrorText`.
   `components/ui/Skeleton.tsx` (`shape` block/line, `as` div/span, `className` for the box, `width`, `height`):
   every `.skeleton` in the TSX (cards, Calendar, Anime schedule, stream list, hero, both detail pages, TV rails
   and the TV detail pill), same class lists, now all `aria-hidden`. `.skeleton`, `.skeleton-line` and the
   reduced-motion rule moved from `base.css`/`cards.css` to `styles/ui/skeleton.css` (after `empty-state.css`);
   the built CSS is the same rules. `CardSkeleton` stays in `PosterCard.tsx` until `Card` (step 4).
   `components/ui/Toast.tsx` (`icon`, text as children, `actions`, `variant="tv"`, `className`, `data-*`):
   `ControllerToast` and `UpdateToast`, which shared `.tv-prompt`. Classes renamed `.toast`, `.toast-tv`,
   `.toast-icon`, `.toast-text`, `.toast-action` (was `.tv-prompt-go`); CSS moved from `tv.css` to
   `styles/ui/toast.css` (after `skeleton.css`), nothing in the files it jumped over matches its parts at equal
   specificity; built CSS is the same rules with the rename mapped back. The caller still owns showing and
   timing. Not yet: one `ToastHost` and `placement` (the two can overlap at the bottom centre today, as
   before), and the player and party notes (`.player-notice`, `.party-hold`, `.party-note`, step 6).
   `components/ui/Menu.tsx` (`MenuRoot`, `MenuTrigger`, `MenuPopup` with `look` compact/roomy and the
   positioner props, `MenuHeader`, `MenuItem`, `MenuCheckItem`, `MenuSeparator`, `MenuSub`): the title's
   right-click menu, the download menu, the profile menu and the navbar's "More". The two `Item` helpers are
   gone. One surface `.menu` (the identical half of `.ctx-menu` and `.profile-menu`), `.menu-compact` /
   `.menu-roomy` for what differed (widths, font); compact rows renamed from `.ctx-menu-*` to `.menu-*`,
   roomy rows from `.profile-menu-item` to `.menu-roomy-item`; `.profile-menu-sep` (identical) is `.menu-sep`
   now and a real separator. CSS in `styles/ui/menu.css` (after `toast.css`); the profile header keeps its
   own classes in `account.css`. Built CSS: the same rules with the renames mapped back, apart from that split.
   Not yet: the TV menus (step 6).
   `components/ui/Popover.tsx` (`PopoverRoot`, `PopoverTrigger`, `PopoverPopup` with `className` and the
   positioner props): `PlaylistButton` and the source filters. Structure only: the surfaces stay as they are,
   because they differ on screen (`.playlist-menu` is the dark glass of the toasts, `.srcf-popover` the
   frosted panel of the large season `Select` at 0.86 instead of 0.82 fill, with a 0.96 instead of 0.94
   entrance). Merging those into one `.surface-popover` is a visible change: left for the owner's look in the
   running app (docs/unverified.md). The playlist checklist's own rows go with U10 in step 4.
   `lib/dismiss.ts` (`useDismiss(active, onDismiss)`, `pushDismiss`): one stack of open layers and one
   `document` keydown listener in the bubble phase. What has focus handles Escape first (a search field clears,
   an open Base UI menu/select/popover closes, an armed delete disarms, the slider's number box resets); then
   the topmost layer closes and the event stops; only then do the `window` listeners (Esc → Back, the player)
   see it. `Sheet` and the trailer use it instead of their capture-phase listeners, which used to close the
   sheet before anything inside it could react. `DesktopApp` now ignores an Escape that was already handled.
   Tests in `tests/dismiss.test.ts`. `lib/layer.ts` `useLayer(root, open, onClose, { modal })` is the `Layer`
   part: `useDismiss`, focus onto the layer when it opens (`tabIndex={-1}`, `data-layer`, no ring:
   `styles/ui/layer.css`), Tab kept inside the topmost layer (wraps at the edges; focus in a menu portalled
   outside is left alone), focus back to the opener on close if focus is still in the layer or dropped.
   `Sheet` (modal ones) and the trailer use it; the edge rule is `trapTarget()`, tested in
   `tests/layer.test.ts`. A hook, not a wrapper component: each keeps its own scrim and motion (the sheet's
   scrim fades separately, the trailer's backdrop is the layer itself), so a shared scrim element would only
   change their look. Base UI's `Dialog` (party join, settings) already traps and restores. Not yet: the other
   listeners: `OptionsOverlay` and the player (step 6), `ShortcutSettings`' key capture (its own job),
   `TvKeyboard` and `TvApp` (step 6), the settings dialog (Base UI's own Escape).
4. **Title parts:** `useTitlePlayback`, `TitleActions`, `LibraryButton`, `SourcePicker`, `SeasonPicker`,
   `Card`, `Shelf`, `PosterGrid` (with T-008: the `AnimeDetail` split and H14).
   *Done:* `lib/viewport.ts` (`useNearViewport(eager, margin)`, `useInfiniteSentinel(pager, margin)`, both
   rooted at the page's `.scroll`): Home's `LazyShelf` and Anime's `GenreShelf` on the first, the infinite
   grids on the second (§6.9). `components/title/PosterGrid.tsx` (`pager` for skeletons and the next page,
   `stale` to dim, children are the cards): Discover, Anime → Browse and the four Library grids. Its CSS moved
   from `shell.css` to `styles/title/poster-grid.css` (after `ui/menu.css`; no rule in between matches the
   grid); `.discover-grid` folded into `.poster-grid[data-stale]`. Built CSS: the same rules plus that merge.
   `components/title/SeasonPicker.tsx` (`value`, `options` id/label, `onChange`): the show page's and the anime
   franchise's season choice, tabs up to 6 and a large dropdown above, written once (the two `MAX_SEASON_TABS`
   are gone). Same elements as before. Not yet: anime episode ranges (their own small tab look, threshold
   `RANGE_TABS`), the TV season column (TV layout).
   The play-or-pick rule (H14) once: `needsPick()` in `lib/titlePlayback.ts` (with `PlayRequest`: type, ids,
   picker subtitle, `resumable`; tested in `tests/titlePlayback.test.ts`) and `useTitlePlayback(onPick,
   beforePlay?)` in `lib/useTitlePlayback.ts`. `components/title/SourcePicker.tsx`: `useSourcePicker(onOpen?)`
   gives `play(req)`, `choose(req)` and the state, `<SourcePicker picker>` draws the Sheet + `StreamList`
   once. The four desktop copies (show and movie hero, show episodes, anime hero, anime episodes) use them;
   `TvDetail` uses `useTitlePlayback` with its sources panel. The sheet now keeps the request it was opened
   with (before, the hero's sheet followed the page's next episode while open), and an anime episode that's
   only scheduled no longer opens an empty sources sheet. Not yet: `TitleActions`, `LibraryButton`, TV's
   `SourcesPanel` as the TV look of `SourcePicker`, the player's Sources overlay.
   `components/title/LibraryButton.tsx` (`item`): the + / ✓ glass icon button of the Home hero, title pages and
   anime pages, written 3× before; same element. The anime page now checks "in Library" by the loaded meta's
   id instead of the linked id (the same id; it's what the button saves).
   `lib/cardIntent.ts` `useCardIntent(warm, delay)`: the rest-then-prefetch timer of the desktop cards
   (`useIntent`, 120 ms), the anime cards (150 ms) and `TvCard` (450 ms, focus only), each keeping its delay.
   Anime cards now also warm on keyboard focus, and a pending timer is cleared when the card unmounts.
   `components/title/Card.tsx` `Card` (`shape`, `art` + `fallback`, children drawn on the art, `actions`,
   `title`, `detail`, `keepCaption`, `trailing`, `hint`): the frame, the art with its broken-art fallback (a new
   `src` gets a fresh try, §6 item 6's bug can't happen here) and the caption, once. `PosterCard`,
   `LandscapeCard`, both anime cards, Continue Watching's card and the Library download card are on it, with
   the same elements and classes. With `actions` the card is a focusable `role="link"` (a button can't hold a
   button) that opens on Enter/Space; that was `ContinueCard`'s own code. `ArtTitle` (scrim + logo or name),
   `ProgressBar` and `CardSkeleton` live there too (`PosterSkeleton` is gone). `TvCard`/`TvAnimeCard` wait for
   step 6. `components/title/Shelf.tsx` `Shelf` (`title`, `shape`, `action`, `items`, `skeletons`, `card`): a
   `Row` with skeletons of its shape until `items` is there; Home's catalog shelves, Anime's shelves and
   Airing Today, and Search's result rows are on it (the four "items or 8 skeletons" copies). The lazy part
   stays `useNearViewport` in the two callers that need it. `TvRail` keeps its own track (step 6).
   `components/title/TitleActions.tsx` (`request`, `picker`, `label`, `resume`, `playTitle`, `onWarm`,
   `onTrailer`, `item` with `playlist`/`download`, children for page-own trailing buttons): the action row of
   the show/movie page and the anime page, Play → Trailer → Library → Playlist → Choose source → Download,
   same elements and classes as before. Play and "Choose source" are disabled exactly when there's no
   request; on the anime page that was "no target" before, which differed only when an episode was known
   but no meta id (a button that did nothing on click). The show page's mute button stays its own child.
   `components/title/TitleHeading.tsx` (`name`, `logo`, `look` hero/detail/tv-stage/tv-detail/tv-panel): the
   logo-or-heading written 7× (Home and Anime heroes, both title pages, TV stage, TV detail and its episodes
   panel); `look` names the classes (`hero-logo`/`hero-title`, …), so every layout keeps its CSS and element.
   The facts lines go through `joinFacts(parts)` and `kindFacts(item)` in `lib/format.ts` (tested in
   `tests/format.test.ts`): Home's `hero-kind`, Anime's, both title pages' and TV's `titleFacts` built the
   " · " line or the type + two genres by hand. The lines themselves stay in each layout: their order and
   extras differ (rating ring, score chips, format badges, the anime next-episode line), and TV draws its facts
   as separate spans. So no single `Facts` component; that part of U4 is the two helpers.
   `components/title/EpisodeCard.tsx` and `EpisodeShelf.tsx` (moved from `components/`): the desktop episode
   card, same elements; its still is `Card`'s `CardArt` with the still placeholder (the copy `ShelfStill` is
   gone, and a new still URL now gets a fresh try). `episodeState(video, progress, threshold)` in
   `lib/episodeState.ts` (released, fraction, watched, in progress) and `shortRuntime` in `lib/format.ts`,
   tested in `tests/episodeState.test.ts`: the episode card, TV's episodes panel and the player's episode list
   computed them by hand (`shortRuntime` twice). The card's rest-to-warm timer is `useCardIntent` (150 ms, as
   before), so it now also warms on keyboard focus and stops on unmount.
   `lib/score.ts` (`scoreTone`, `metacriticTone`, `isFresh`, tested in `tests/score.test.ts`): the IMDb bands
   that `ImdbBadge`, `CardRating` and `RatingRing` each wrote out, and the score cards' Metacritic and Rotten
   Tomatoes rules; the rating components keep their looks (U26).
   `components/title/PlaylistChecklist.tsx` (U10): `usePlaylistChecklist(item)` (rows, `inAny`, `toggle`,
   `create(name?)`) and `PlaylistChecklist look="menu" | "popover"`, the card menu's submenu and the detail
   page's popover, same elements and classes (CSS moved to `styles/title/playlist-checklist.css`, same rules).
   TV's playlists and name panels draw their own rows from the hook. `lib/playlistChecklist.ts`
   (`playlistRows`, `inAnyPlaylist`, `freshPlaylistName`, tested in `tests/playlistChecklist.test.ts`) replaces
   the two `freshName` copies and the "is it in a playlist" check written three times. The popover's name form
   now resets when the popover unmounts after its closing fade, not as it starts to close.
   `AnimeDetail` split (with T-008; U27, M28): `screens/AnimeDetail.tsx` keeps the page shell and the body's
   order; its parts are `components/anime/` `AnimeHero`, `AnimeEpisodes` (with `SeasonTabs` and the `Franchise`
   type), `AnimeCharacters`, `AnimeDetails`, `AnimeRelated`, and the hook `useAnimePlayback`. The playback
   model without React is `lib/anime/episodes.ts` (`animeEpisodes`, `progressByVideo`, `upNext`, `upNextLabel`)
   and the season tab names `lib/anime/seasonLabels.ts` (`distinctLabels`), tested in
   `tests/animeEpisodes.test.ts`. `TitleDetails` moved to `components/title/` and gives its parts out:
   `DetailsSection` (label over content; `as="div"` inside a column), `DetailsColumns` (left column + facts),
   `FactList`, `DetailsLinks`. The anime details are built from them; the anime-only parts (rankings, tags,
   streaming links) stay in `AnimeDetails`. Same elements and classes on both pages.
   Not yet: the TV column of pills and TV's episode row as `EpisodeCard variant="tv"` (step 6).
5. **Settings schema** with `components/settings/`, TV rendering the same schema (with T-008: H15, M26, M27).
   Rows (60c038c): `components/settings/rows.tsx` holds `Card`, `RowText`, `ToggleRow`, `PickRow`, `NumberRow`,
   `ExpandRow`, `LinkRow`, `useExpanded` and the `Expandable` type, out of `Settings.tsx`; the pages' ids and
   labels are `lib/settings/pages.ts` (`PageId`, `PAGE_LABELS`), the icons `components/settings/pages.ts`
   (`PAGES`), so `lib` no longer imports `screens/Settings`. Marketplace's groups are `Card`s.
   Schema: `lib/settings/schema.ts` lists every searchable setting once (`id`, page, title, caption,
   keywords) and, for the ones a generic row can draw, its store (`bind`: synced settings with a fallback, or
   prefs), its `control` (toggle, choice list, number range with `tvStep`/`scale`/TV label), what a change
   makes stale (`invalidates`) and its TV label. `useSetting(id)` (`lib/settings/useSetting.ts`) reads and
   saves one. Desktop draws those with `components/settings/SettingRow.tsx` (switch, dropdown or slider, rows
   marked `data-setting={id}`); `tv/TvSettings.tsx` draws the same entries by id (left/right through the
   choices or the number steps). The settings search is built from the schema (`lib/settingsIndex.ts`) and
   scrolls to `data-setting`, falling back to the title. `tests/settingsSchema.test.ts` checks unique ids, that
   every title the pages draw themselves is still written in them (it found two stale search entries: "With
   sound" and "Hide filler episodes"; and "Add-on Marketplace", which named no row), fallbacks and TV steps.
   H15 fixed by sharing: resolution offers Any/4K/1440p/1080p/720p/480p on both; mature content show/blur/hide
   on TV too; seek step 1-120 with TV steps of 5 plus whatever was set; languages list the current one on TV
   too; missing values fall back once, in the schema; TV source changes now refresh source lists as desktop's
   do. TV keeps its own row labels (`tv`) but shows desktop's choice wording.
   Pages (b0a75e9): each page is `screens/settings/<Name>Page.tsx` (with the rows only it uses), and
   `screens/settings/SettingsPageBody.tsx` picks one. The lines moved unchanged (not reformatted, so
   `git blame -C` follows them); `tests/settingsSchema.test.ts` reads every page file.
   One Settings UI (M26): the old sidebar page is gone, with its CSS (`.settings` layout, `.settings .btn`,
   `.settings .btn-primary`). `StreamList`'s "Source Filters"/"Manage Add-ons" open the overlay on desktop and
   TV's settings screen on TV, which now opens on the asked category when it has one (Sources). The settings
   route on desktop (only reached by switching from TV on that screen) opens the overlay and steps off the
   route (`SettingsRoute` in `App.tsx`).
   `ActionRow` (title, caption, one button: `label`, `glyph`, `variant`, `pending`/`pendingLabel`) and `FormRow`
   (one `TextField` and its submit button; enabled when the value tidied by `tidy`, default trim, differs from
   `saved`, or is non-empty with no `saved`; `pending`/`pendingLabel`, `error` under the row, `look="expand"`
   inside an `ExpandRow`) in `rows.tsx`: Sign In, Sign Out, Open TV Mode, the controller Reset and the anime
   cache Clear; the add-on install, preferred release groups, hidden words and TMDB key forms. Each page's own
   dirty check and busy text went into them; same elements and classes as before.
   Rows from the schema: every switch, dropdown and slider on the pages whose value is one stored setting is a
   `SettingRow` now (Playback, Sources, Subtitles, Appearance, Browsing, Anime, Controls, Controller, Advanced,
   About), its title, caption, choices, range and fallback moved into the schema unchanged; side effects stay on
   the page as `onChanged` (clear recent searches, play the sound pack, download a waiting update) or as the
   schema's `invalidates` (metadata language, watched threshold, file sizes). `SOUND_PACKS` moved from
   `tv/sounds.ts` into the schema. A test checks that every fallback (and prefs default) is a value its control
   offers. Hand-written on purpose, each with a comment or an obvious reason: "Skip recaps" (unset follows Skip
   intros), "Remember playback speed" (also resets the speed), "Show details" (off and greyed while titles are
   off), "Open the app on" (Anime only while the section is on), interface size (0 stored means 100%), the accent
   swatches, Version, the update row (four states), the two-key ratings form, the Seekr key form (save and check)
   and the delete-account confirm. The first four now carry `data-setting`, so search lands on the row itself.
6. **TV and player** onto the primitives.
   Layers: `OptionsOverlay` (the player's picker, desktop and TV) uses `useLayer`: Escape through the dismiss
   stack instead of its own capture-phase branch, Tab kept inside, focus back to the opener; with nothing
   checked the layer itself takes focus (`tabIndex={-1}`, `data-layer`). Its capture listener keeps only the
   arrows and Space/Enter. TV's Back stack (`pushBack`/`runBack` in `tv/spatial.ts`) is gone: `useBack` in
   `tv/shell.ts` is `useDismiss`, so TV panels, the card menu, sheets and the trailer sit on one stack in the
   order they opened. Escape reaches it on `document`; `TvApp` sends Backspace and a remote's Back to
   `dismissTop()` and plays the back sound from `onDismissed` (while not playing). `TvKeyboard`'s listener
   takes only typing keys, so it stays. TV's `useFocusTrap` (focus in when ready, back on close; no Tab trap,
   the arrows are the TV's navigation) stays its own.
   `EmptyState variant="tv"` draws TV's `p.tv-empty` (same element and class): the seven TV notes (Library,
   Search, Calendar, title page, Anime's three). `useCardArt(src)` in `components/title/Card.tsx` is
   `CardArt`'s "art until it fails, a new `src` tries again" as a hook; `TvCard` uses it for its own frame, so
   a TV card whose art failed now tries again when better art arrives (a playlist entry filling in), as the
   desktop cards do (§6 item 6). `TvAnimeCard` is a `TvCard` already.
   `IconButton variant="player" | "transport"` emits the player's own classes (`player-icon pressable`,
   `player-transport pressable`) for the top bar's Back, Mute and Fullscreen, the options close and the three
   centre transport glyphs, so they get `label` as their name like every other icon button; same elements and
   classes. The labelled `player-action` buttons stay `ActionButton` in `Player.tsx` (text + glyph, one place).
   `Still` (episode stills: TV's episodes panel, the player's episode rows) is on `useCardArt` too, instead of
   its own failed flag reset one render late.
   TV layouts kept as they are (§4 "TV": TV shares primitives and logic, not layout), each already on
   the shared logic: the card menu and the side menu (own placement beside the card, spatial focus; actions
   from `useTitleActions`, as the desktop card menu), the episodes panel row (`episodeState`, `ProgressBar`,
   `Still`), the season column, `TvRail`'s track, the sources panel (`useTitlePlayback`) and the player's
   Sources picker (`OptionsOverlay` with `useSourceFilters`, as the title page). Making them `EpisodeCard`,
   `Menu` or `SeasonPicker` with a `tv` variant would put two layouts in one component.
   Kept apart on purpose: the player's top note (`.player-notice`), the party's hold pill and activity notes
   are not `Toast`s: other surface (`--surface-float`, no glass edge), other place (top centre, bottom left
   following the controls) and motion; one look for all of them is the owner's call (docs/unverified.md).
7. **Document** the final set at the top of this file (component, props, when to use), and keep §3 as the
   record of what was merged. *Done:* §0.

**Checking the look.** This machine has no browser (NOTES), so screenshots can't be compared here. Each step
is checked by reading the computed CSS: a rule moved to a token must resolve to the same value. Steps that
change a value on purpose are listed in `docs/unverified.md` for the owner to look at in the running app.
