import { For } from "solid-js";

/**
 * Where the app's data comes from (see docs/data-sources.md), as numbered
 * footnotes. `<Ref n={1} />` marks a claim; `<Footnotes />` lists them.
 */
const NOTES = [
  "Intro, recap and credits times come from IntroDB, and from AniSkip for anime. Filler episodes come from Jikan, which serves MyAnimeList data, and animefillerlist.com.",
  "Anime details, seasons, schedules, characters and rankings come from AniList. Ids and per-episode data come from ani.zip.",
  "Upcoming episodes come from TMDB, or from Cinemeta when no TMDB key is set, and from AniList for anime.",
];

export function Ref(props: { n: 1 | 2 | 3 }) {
  return (
    <sup class="ml-0.5 text-[0.65em] font-medium">
      <a
        href={`#note-${props.n}`}
        aria-label={`Source note ${props.n}`}
        class="text-faint no-underline hover:text-icon"
      >
        {props.n}
      </a>
    </sup>
  );
}

export function Footnotes() {
  return (
    <section aria-label="Notes" class="mx-auto mt-32 max-w-[1080px] px-6 sm:mt-40">
      <ol class="space-y-2 border-t border-hair pt-8 text-xs leading-relaxed text-faint">
        <For each={NOTES}>
          {(text, i) => (
            <li id={`note-${i() + 1}`} class="flex max-w-[52rem] gap-2 scroll-mt-24">
              <span class="tabular-nums">{i() + 1}.</span>
              <span>{text}</span>
            </li>
          )}
        </For>
        <li class="pt-2">Polarity isn't affiliated with or endorsed by any of these services.</li>
      </ol>
    </section>
  );
}
