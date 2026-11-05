import type { JSX } from "solid-js";
import { DownloadButton, ReleaseNote } from "./Download";
import { GitHubButton } from "./GitHub";
import { Smooth } from "./Smooth";

/** Inline vars for the `.enter` keyframe: delay, duration, rise distance, blur, start scale. */
const beat = (delay: number, dur: number, rise: number, extra: JSX.CSSProperties = {}): JSX.CSSProperties => ({
  "--delay": `${delay}ms`,
  "--dur": `${dur}ms`,
  "--rise": `${rise}px`,
  ...extra,
});

export function Hero() {
  return (
    <section class="px-6 pt-36 text-center sm:pt-44">
      <h1 class="enter text-display" style={beat(0, 900, 18, { "--blur": "6px" })}>
        Polarity
      </h1>
      <p class="enter text-lede mx-auto mt-5 max-w-[30rem] text-balance text-mute" style={beat(120, 800, 12)}>
        A free and open-source desktop player and library for your shows, movies and anime.
      </p>
      <div class="enter mt-10 flex flex-col items-center gap-4" style={beat(240, 800, 8)}>
        <div class="flex flex-wrap justify-center gap-3">
          <DownloadButton />
          <GitHubButton />
        </div>
        <ReleaseNote />
      </div>

      <div class="enter mx-auto mt-20 max-w-[1200px] sm:mt-24" style={beat(360, 1100, 40, { "--from-scale": "0.98" })}>
        <div class="drop-shadow-[0_30px_60px_var(--shadow)]">
          <Smooth radius={22} edge="var(--edge)">
            <img
              src="/profiles.webp"
              alt="Polarity's profile picker: who's watching?"
              width="1442"
              height="902"
              class="block w-full"
              fetchpriority="high"
            />
          </Smooth>
        </div>
      </div>
    </section>
  );
}
