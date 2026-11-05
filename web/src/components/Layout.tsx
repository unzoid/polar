import type { JSX } from "solid-js";
import { Logo, Nav } from "./Nav";

export function Layout(props: { children: JSX.Element }) {
  return (
    <>
      <Nav />
      <main>{props.children}</main>
      <footer class="mx-auto mt-20 max-w-[1080px] px-6 pb-12 text-xs text-faint sm:mt-24">
        <div class="flex flex-col gap-4 border-t border-hair pt-8 sm:flex-row sm:items-center">
          <Logo width={72} class="-ml-1.5 opacity-80" />
          <p>Polarity plays streams from add-ons you add yourself and hosts no content.</p>
          <nav class="flex gap-5 sm:ml-auto" aria-label="Footer">
            <a href="/download/" class="hover:text-ink">Download</a>
            <a href="/roadmap/" class="hover:text-ink">Roadmap</a>
            <a href="https://github.com/unzoid/polarity" class="hover:text-ink">GitHub</a>
          </nav>
        </div>
      </footer>
    </>
  );
}
