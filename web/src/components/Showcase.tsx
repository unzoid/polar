import { For, Show } from "solid-js";
import { reveal } from "../lib/reveal";
import { Ref } from "./Footnotes";
import { Smooth } from "./Smooth";

// Screenshots follow AGENTS.md: no unblurred posters, key art or title logos.
const scenes: {
  id: string;
  title: string;
  body: string;
  note?: 1 | 2 | 3;
  img: { src: string; w: number; h: number; alt: string };
}[] = [
  {
    id: "anime",
    title: "Anime",
    body: "Rankings, tags, studios, seasons and alternative titles on every show's page.",
    note: 2,
    img: { src: "/anime-details.webp", w: 1442, h: 540, alt: "An anime's page with its rankings, story, tags and facts" },
  },
  {
    id: "settings",
    title: "Customizable",
    body: "Settings for playback, subtitles, audio, appearance and controls, all searchable.",
    img: { src: "/settings.webp", w: 1442, h: 902, alt: "Playback settings for autoplay, Up Next and skipping intros" },
  },
  {
    id: "tv",
    title: "TV mode",
    body: "Large cards, with navigation by controller or arrow keys.",
    img: { src: "/tv-search.webp", w: 2000, h: 1125, alt: "Search in TV mode with an on-screen keyboard and genres" },
  },
];

/** A centered heading, then the screenshot, large. */
export function Showcase() {
  return (
    <For each={scenes}>
      {(scene) => (
        <section id={scene.id} class="mx-auto mt-32 max-w-[1200px] px-6 sm:mt-48">
          <header ref={reveal} class="reveal mx-auto max-w-[40rem] text-center">
            <h2 class="text-headline text-balance">
              {scene.title}
              <Show when={scene.note}>{(n) => <Ref n={n()} />}</Show>
            </h2>
            <p class="text-lede mx-auto mt-5 max-w-[34rem] text-mute">{scene.body}</p>
          </header>
          <div ref={reveal} class="reveal mt-14 drop-shadow-[0_24px_48px_var(--shadow)] sm:mt-16">
            <Smooth radius={20} edge="var(--edge)" class="bg-black">
              <img
                src={scene.img.src}
                alt={scene.img.alt}
                width={scene.img.w}
                height={scene.img.h}
                loading="lazy"
                class="block w-full"
              />
            </Smooth>
          </div>
        </section>
      )}
    </For>
  );
}
