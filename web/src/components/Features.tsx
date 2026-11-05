import { For, Show, type Component } from "solid-js";
import type { LucideProps } from "lucide-solid";
import FastForward from "lucide-solid/icons/fast-forward";
import History from "lucide-solid/icons/rotate-ccw-clock";
import Users from "lucide-solid/icons/users";
import Sparkles from "lucide-solid/icons/sparkles";
import CalendarDays from "lucide-solid/icons/calendar-days";
import Download from "lucide-solid/icons/download";
import Bookmark from "lucide-solid/icons/bookmark";
import CircleUser from "lucide-solid/icons/circle-user";
import Captions from "lucide-solid/icons/captions";
import { reveal } from "../lib/reveal";
import { Ref } from "./Footnotes";
import { Smooth } from "./Smooth";

type Feature = { icon: Component<LucideProps>; title: string; body: string; note?: 1 | 2 | 3 };

const features: Feature[] = [
  { icon: FastForward, title: "Skip intros", body: "Jump past intros and recaps, and skip filler episodes in anime.", note: 1 },
  { icon: History, title: "Resume anywhere", body: "Pick up exactly where you stopped, on any of your devices." },
  { icon: Users, title: "Watch parties", body: "Watch together with playback kept in sync." },
  { icon: Sparkles, title: "Anime", body: "Its own section, search and episode lists.", note: 2 },
  { icon: CalendarDays, title: "Calendar", body: "Upcoming episodes from your library and the shows you're watching.", note: 3 },
  { icon: Download, title: "Downloads", body: "Save a title and watch it later, offline." },
  { icon: Bookmark, title: "Your library", body: "A watchlist, your history, and playlists of your own." },
  { icon: CircleUser, title: "Profiles", body: "Everyone gets their own avatar, history and settings." },
  { icon: Captions, title: "Subtitles and sound", body: "Settings that apply straight away, even mid-video." },
];

export function Features() {
  return (
    <section id="features" class="mx-auto mt-32 max-w-[1080px] px-6 sm:mt-48">
      <header ref={reveal} class="reveal mx-auto max-w-[40rem] text-center">
        <h2 class="text-headline text-balance">Features</h2>
      </header>
      <div ref={reveal} class="reveal mt-14 sm:mt-16">
        <Smooth radius={28} class="bg-tile px-8 py-12 sm:px-12 sm:py-14">
          <ul class="grid gap-x-12 gap-y-12 sm:grid-cols-2 sm:gap-y-16 lg:grid-cols-3">
            <For each={features}>
              {(f) => (
                <li>
                  <f.icon class="size-6 text-icon" stroke-width={1.75} aria-hidden="true" />
                  <h3 class="mt-4 text-[1.0625rem] font-semibold tracking-[-0.016em]">
                    {f.title}
                    <Show when={f.note}>{(n) => <Ref n={n()} />}</Show>
                  </h3>
                  <p class="mt-1 max-w-[19rem] text-[0.9375rem] leading-[1.45] text-mute">{f.body}</p>
                </li>
              )}
            </For>
          </ul>
        </Smooth>
      </div>
    </section>
  );
}
