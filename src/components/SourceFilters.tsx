import { useLayoutEffect, useRef, useState } from "react";
import { SORTS, type SourceFilters } from "../lib/playback";
import type { SourceSort } from "../lib/types";
import { Close, Filters } from "./icons";
import { Segmented } from "./Segmented";
import { Dropdown } from "./Dropdown";
import { Chip } from "./ui/Chip";
import { PopoverPopup, PopoverRoot, PopoverTrigger } from "./ui/Popover";
import { SearchField } from "./ui/SearchField";

/**
 * The controls over a source list (see lib/playback/sources.ts). One decision is in
 * view, the one everybody makes - which picture - and the rest waits behind
 * a single button:
 *
 *   [ All | 4K | 1080p | 720p ]                      [⚙ Filters 2]
 *   Dolby Vision ✕   English ✕                          Clear All
 *
 * The popover holds sort, add-on, audio, source, size and the feature tags as rows of
 * chips. Whatever is narrowing the list (including tags Settings switched on
 * by themselves) shows under the bar, each one a tap away from gone.
 *
 * TV mode gets every choice as rows of chips, which a remote can reach.
 */
export function SourceFilterBar({ f, tv = false, note }: { f: SourceFilters; tv?: boolean; note?: string }) {
  if (!f.total) return null;
  return tv ? <TvBar f={f} note={note} /> : <DesktopBar f={f} note={note} />;
}

/** Size steps, for the popover and the remote alike. */
const SIZE_PRESETS: { label: string; range: [number, number] | null }[] = [
  { label: "Any size", range: null },
  { label: "Under 2 GB", range: [0, 2] },
  { label: "2–8 GB", range: [2, 8] },
  { label: "8–20 GB", range: [8, 20] },
  { label: "Over 20 GB", range: [20, 10_000] },
];
const sameRange = (a: [number, number] | null, b: [number, number] | null) => a?.[0] === b?.[0] && a?.[1] === b?.[1];
const sizeLabel = (r: [number, number] | null) =>
  SIZE_PRESETS.find((p) => sameRange(p.range, r))?.label ?? (r ? `${r[0]}–${r[1]} GB` : "Any size");

interface Chip {
  key: string;
  label: string;
  count?: number;
  on: boolean;
  pick: () => void;
}
interface Section {
  label: string;
  chips: Chip[];
}

/** Every choice as a labelled row of chips. Quality is left out where the segmented control has it. */
/** `withQuality`: TV, where everything is chip rows; desktop has its own quality and add-on controls. */
function sections(f: SourceFilters, withQuality: boolean): Section[] {
  const { filter, facets } = f;
  const out: Section[] = [
    {
      label: "Sort",
      chips: (Object.keys(SORTS) as SourceSort[]).map((k) => ({ key: k, label: SORTS[k], on: f.sort === k, pick: () => f.setSort(k) })),
    },
  ];
  if (withQuality && facets.res.length > 1)
    out.push({
      label: "Quality",
      chips: [
        { key: "", label: "Any", on: !filter.res, pick: () => f.set({ res: null }) },
        ...facets.res.map((r) => ({
          key: r.key,
          label: r.key === f.screenRes ? `${r.label} ★` : r.label,
          count: r.count,
          on: filter.res === r.key,
          pick: () => f.set({ res: filter.res === r.key ? null : r.key }),
        })),
      ],
    });
  if (withQuality && facets.addons.length > 1)
    out.push({
      label: "Add-on",
      chips: [
        { key: "", label: "All", on: !filter.addon, pick: () => f.set({ addon: null }) },
        ...facets.addons.map((a) => ({ key: a.key, label: a.label, count: a.count, on: filter.addon === a.key, pick: () => f.set({ addon: filter.addon === a.key ? null : a.key }) })),
      ],
    });
  if (facets.langs.length > 1)
    out.push({
      label: "Audio",
      chips: [
        { key: "", label: "Any", on: !filter.lang, pick: () => f.set({ lang: null }) },
        ...facets.langs.map((l) => ({ key: l.key, label: l.label, count: l.count, on: filter.lang === l.key, pick: () => f.set({ lang: filter.lang === l.key ? null : l.key }) })),
      ],
    });
  if (facets.sources.length > 1)
    out.push({
      label: "Source",
      chips: [
        { key: "", label: "Any", on: !filter.source, pick: () => f.set({ source: null }) },
        ...facets.sources.map((x) => ({ key: x.key, label: x.label, count: x.count, on: filter.source === x.key, pick: () => f.set({ source: filter.source === x.key ? null : x.key }) })),
      ],
    });
  if (facets.maxGb > 2)
    out.push({
      label: "Size",
      chips: SIZE_PRESETS.filter((p) => !p.range || p.range[0] < facets.maxGb).map((p) => ({
        key: p.label,
        label: p.label,
        on: sameRange(filter.size, p.range),
        pick: () => f.set({ size: sameRange(filter.size, p.range) ? null : p.range }),
      })),
    });
  if (facets.tags.length > 0)
    out.push({
      label: "Features",
      chips: facets.tags.map((t) => ({
        key: t.key,
        label: t.label,
        count: filter.tags.includes(t.key) ? undefined : t.count,
        on: filter.tags.includes(t.key),
        pick: () => f.toggleTag(t.key),
      })),
    });
  return out;
}

/** What narrows the list besides the picture, each with its own undo. */
function activeFilters(f: SourceFilters) {
  const { filter, facets } = f;
  const out: { key: string; label: string; clear: () => void }[] = [];
  if (filter.lang)
    out.push({ key: "lang", label: facets.langs.find((l) => l.key === filter.lang)?.label ?? filter.lang, clear: () => f.set({ lang: null }) });
  if (filter.source) out.push({ key: "source", label: filter.source, clear: () => f.set({ source: null }) });
  if (filter.size) out.push({ key: "size", label: sizeLabel(filter.size), clear: () => f.set({ size: null }) });
  for (const t of filter.tags)
    out.push({ key: `tag:${t}`, label: facets.tags.find((x) => x.key === t)?.label ?? t, clear: () => f.toggleTag(t) });
  return out;
}

function DesktopBar({ f, note }: { f: SourceFilters; note?: string }) {
  const { filter, facets } = f;
  const active = activeFilters(f);
  return (
    <div className="srcf">
      <div className="srcf-bar">
        {facets.res.length > 1 ? (
          <Segmented
            label="Picture quality"
            value={filter.res ?? "all"}
            onChange={(v) => f.set({ res: v === "all" ? null : (v as typeof filter.res) })}
            options={[
              { id: "all", label: "All" },
              ...facets.res.map((r) => ({ id: r.key as string, label: r.key === "other" ? "SD" : r.label })),
            ]}
          />
        ) : (
          <span />
        )}
        {facets.addons.length > 1 && (
          <span className="srcf-addon">
          <Dropdown
            label="Add-on"
            value={filter.addon ?? ""}
            onChange={(v) => f.set({ addon: v || null })}
            options={[
              { value: "", label: "All add-ons" },
              ...facets.addons.map((a) => ({ value: a.key, label: `${a.label} · ${a.count}` })),
            ]}
          />
          </span>
        )}
        <PopoverRoot>
          <PopoverTrigger className="srcf-filters pressable" aria-label={active.length ? `Filters, ${active.length} on` : "Filters"}>
            <Filters size={16} strokeWidth={2} />
            Filters
            {active.length > 0 && <span className="srcf-filters-count tabular">{active.length}</span>}
          </PopoverTrigger>
          <PopoverPopup className="srcf-popover" sideOffset={8} align="end">
            {sections(f, false).map((s) => (
              <ChipRow key={s.label} {...s} collapsible />
            ))}
            {note && <p className="srcf-popover-note">{note}</p>}
          </PopoverPopup>
        </PopoverRoot>
      </div>
      {active.length > 0 && (
        <div className="srcf-active" role="group" aria-label="Filters on">
          {active.map((a) => (
            <Chip key={a.key} variant="tag" pressed onClick={a.clear} aria-label={`Remove ${a.label}`}>
              {a.label}
              <Close size={12} />
            </Chip>
          ))}
          <button className="srcf-clear" onClick={() => f.set({ lang: null, size: null, source: null, tags: [] })}>
            Clear All
          </button>
        </div>
      )}
    </div>
  );
}

function TvBar({ f, note }: { f: SourceFilters; note?: string }) {
  // Sort goes last on TV, under the filters it orders.
  const [sort, ...rest] = sections(f, true);
  return (
    <div className="srcf srcf-tv" data-nav-memory>
      {[...rest, sort].map((s) => (
        <ChipRow key={s.label} {...s} />
      ))}
      {note && <p className="srcf-tv-note t-caption">{note}</p>}
    </div>
  );
}

/** Rows of chips a choice shows before folding the rest away (desktop popover). */
const FOLD_ROWS = 3;
/** More chips than this: a search beside the label. */
const SEARCH_FROM = 10;

/**
 * One choice as a labelled row of chips. `collapsible` (the desktop popover):
 * past three rows the rest fold behind "Show all", and long rows get a search
 * beside their label. TV keeps every chip in reach of the remote.
 */
function ChipRow({ label, chips, collapsible = false }: Section & { collapsible?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [folds, setFolds] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();
  // Searching keeps what's on in view, so it can still be switched off.
  const shown = q ? chips.filter((c) => c.on || c.label.toLowerCase().includes(q)) : chips;
  const searchable = collapsible && chips.length > SEARCH_FROM;

  // Whether the chips run past FOLD_ROWS rows: measured, since chip widths vary.
  useLayoutEffect(() => {
    const el = box.current;
    if (!collapsible || !el) return;
    const measure = () => {
      const first = el.firstElementChild as HTMLElement | null;
      if (!first) return setFolds(false);
      const gap = parseFloat(getComputedStyle(el).rowGap) || 0;
      const max = FOLD_ROWS * first.offsetHeight + (FOLD_ROWS - 1) * gap;
      el.style.setProperty("--fold-height", `${max}px`);
      setFolds(el.scrollHeight > max + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [collapsible, shown.length]);

  const folded = folds && !open && !q;
  return (
    <div className="srcf-chiprow" role="group" aria-label={label}>
      <div className="srcf-chiprow-head">
        <span className="srcf-chiprow-label">{label}</span>
        {searchable && (
          <SearchField
            look="mini"
            className="srcf-chiprow-search"
            value={query}
            onChange={setQuery}
            label={`Search ${label.toLowerCase()}`}
            placeholder="Search"
          />
        )}
      </div>
      <div className="srcf-chips" ref={box} data-folded={folded || undefined}>
        {shown.map((c) => (
          <Chip key={c.key} variant="choice" pressed={c.on} onClick={c.pick}>
            {c.label}
            {c.count != null && <span className="srcf-count tabular">{c.count}</span>}
          </Chip>
        ))}
      </div>
      {q && !shown.length && <p className="srcf-chiprow-empty">Nothing matches “{query.trim()}”.</p>}
      {folds && !q && (
        <button className="srcf-chiprow-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Show less" : `Show all ${chips.length}`}
        </button>
      )}
    </div>
  );
}
