import { For } from "solid-js";
import { reveal } from "../lib/reveal";

const questions = [
  {
    q: "Is Polarity free?",
    a: "Yes. Download it from the releases page; after that it keeps itself up to date.",
  },
  {
    q: "Is it open source?",
    a: "Yes. The full source is on GitHub under the MIT license, so you can read it, build it yourself, or contribute.",
  },
  {
    q: "Where do the streams come from?",
    a: "Polarity doesn't host anything. It plays streams from Stremio-compatible addons that you add yourself in Settings.",
  },
  {
    q: "Do I need an account?",
    a: "No, you can use Polarity as a guest. An account lets you sync profiles and history between your devices.",
  },
  {
    q: "Does it work on Mac or Linux?",
    a: "Not yet. Both are on the roadmap, and the download page lists them as soon as they ship.",
  },
];

export function Faq() {
  return (
    <section id="faq" class="mx-auto mt-32 max-w-[760px] px-6 sm:mt-48">
      <h2 ref={reveal} class="reveal text-headline">
        FAQ
      </h2>
      <div ref={reveal} class="reveal mt-10 border-t border-hair">
        <For each={questions}>
          {(item) => (
            <details class="group border-b border-hair">
              <summary class="flex cursor-pointer list-none items-center justify-between gap-6 py-6 text-[1.1875rem] font-semibold tracking-[-0.02em] [&::-webkit-details-marker]:hidden">
                {item.q}
                <svg
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                  class="size-4 shrink-0 text-faint transition-transform duration-200 ease-[var(--ease-out-strong)] group-open:rotate-45"
                >
                  <path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                </svg>
              </summary>
              <p class="-mt-2 max-w-[38rem] pb-6 text-mute">{item.a}</p>
            </details>
          )}
        </For>
      </div>
    </section>
  );
}
