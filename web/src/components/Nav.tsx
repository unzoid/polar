import { createSignal, onCleanup, onMount } from "solid-js";
import { DownloadButton } from "./Download";
import { GitHubMark, REPO_URL } from "./GitHub";
import { Smooth } from "./Smooth";

const links = [
  { href: "/#features", label: "Features" },
  { href: "/roadmap/", label: "Roadmap" },
  { href: "/#faq", label: "FAQ" },
];

export function Logo(props: { class?: string; width?: number }) {
  const w = props.width ?? 88;
  return (
    <picture class={props.class}>
      <source srcset="/logo-dark.svg" media="(prefers-color-scheme: dark)" />
      <img src="/logo.svg" alt="Polarity" width={w} height={Math.round((w * 100) / 260)} />
    </picture>
  );
}

/**
 * Transparent over the top of the page; once you scroll it becomes a floating,
 * frosted bar (Screen Studio's pattern). Only colors change, so nothing shifts.
 */
export function Nav() {
  const [scrolled, setScrolled] = createSignal(false);
  onMount(() => {
    const onScroll = () => setScrolled(scrollY > 8);
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    onCleanup(() => removeEventListener("scroll", onScroll));
  });

  return (
    <header class="fixed inset-x-0 top-0 z-50 px-3 pt-2.5 sm:px-4">
      <Smooth
        radius={16}
        edge={scrolled() ? "var(--hair)" : "transparent"}
        class="material mx-auto max-w-[1080px] transition-[background-color,backdrop-filter] duration-300 ease-[var(--ease-out-strong)]"
        style={{
          "background-color": scrolled() ? "color-mix(in srgb, var(--tile) 82%, transparent)" : "transparent",
          "backdrop-filter": scrolled() ? "blur(20px) saturate(180%)" : "none",
        }}
      >
        <div class="flex h-13 items-center pr-2.5 pl-4">
          <a href="/" aria-label="Polarity home" class="-ml-1.5">
            <Logo />
          </a>
          <nav class="ml-auto hidden items-center gap-7 text-sm font-medium text-ink/70 sm:flex" aria-label="Main">
            {links.map((l) => (
              <a href={l.href} class="transition-colors duration-150 hover:text-ink">
                {l.label}
              </a>
            ))}
          </nav>
          <div class="ml-auto flex items-center gap-3 sm:ml-7">
            <a
              href={REPO_URL}
              aria-label="Polarity on GitHub"
              class="press grid size-8 place-items-center rounded-full text-ink/70 hover:text-ink"
            >
              <GitHubMark class="size-[18px]" />
            </a>
            <DownloadButton size="sm" />
          </div>
        </div>
      </Smooth>
    </header>
  );
}
