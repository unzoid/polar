import { render } from "solid-js/web";
import { For, Match, Show, Switch, type JSX } from "solid-js";
import Command from "lucide-solid/icons/command";
import Terminal from "lucide-solid/icons/terminal";
import ArrowDownToLine from "lucide-solid/icons/arrow-down-to-line";
import "../styles.css";
import { Layout } from "../components/Layout";
import { Smooth } from "../components/Smooth";
import { WindowsGlyph } from "../components/Download";
import { formatSize, platform, PLATFORM_NAMES, release, RELEASES_PAGE, type Platform } from "../lib/release";

const ICONS: Record<Platform, () => JSX.Element> = {
  windows: () => <WindowsGlyph class="size-6" />,
  macos: () => <Command class="size-6" stroke-width={1.75} />,
  linux: () => <Terminal class="size-6" stroke-width={1.75} />,
};

const REQUIREMENTS: Record<Platform, string> = {
  windows: "Windows 10 or later, 64-bit",
  macos: "",
  linux: "",
};

// The visitor's own platform goes first.
const ORDER: Platform[] = (["windows", "macos", "linux"] as Platform[]).sort(
  (a, b) => Number(b === platform) - Number(a === platform),
);

function Download() {
  const published = () => {
    const at = release()?.publishedAt;
    return at ? new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : null;
  };

  return (
    <Layout>
      <section class="px-6 pt-36 text-center sm:pt-44">
        <h1 class="enter text-display" style={{ "--rise": "16px", "--dur": "800ms" }}>
          Download Polarity
        </h1>
        <p class="enter text-lede mx-auto mt-5 max-w-[32rem] text-mute" style={{ "--rise": "10px", "--delay": "100ms" }}>
          Free and open source. Updates install automatically.
          <Show when={release()?.version}>
            {(v) => (
              <>
                <br />
                <a href={release()!.notes} class="text-faint underline-offset-4 hover:underline">
                  Version {v()}
                  {published() && ` · ${published()}`}
                </a>
              </>
            )}
          </Show>
        </p>
      </section>

      <section class="enter mx-auto mt-16 max-w-[1080px] px-6 sm:mt-20" style={{ "--rise": "20px", "--delay": "200ms", "--dur": "900ms" }}>
        <ul class="grid gap-4 md:grid-cols-3">
          <For each={ORDER}>
            {(p) => (
              <li>
                <Smooth radius={28} class="flex h-full min-h-72 flex-col bg-tile p-8">
                  <div class="flex items-center gap-3 text-icon">{ICONS[p]()}</div>
                  <h2 class="mt-5 text-2xl font-semibold tracking-[-0.024em]">
                    {PLATFORM_NAMES[p]}
                    <Show when={p === platform}>
                      <span class="ml-2 align-middle text-xs font-medium tracking-normal text-faint">Your system</span>
                    </Show>
                  </h2>
                  <Show when={REQUIREMENTS[p]}>
                    <p class="mt-1 text-[0.9375rem] text-mute">{REQUIREMENTS[p]}</p>
                  </Show>

                  <div class="mt-auto pt-8">
                    <Switch>
                      <Match when={release.loading}>
                        <p class="h-11 text-sm leading-[2.75rem] text-faint">Checking the latest release…</p>
                      </Match>
                      <Match when={release() === null}>
                        <a href={RELEASES_PAGE} class="text-sm font-medium text-icon hover:underline">
                          Get it from GitHub releases
                        </a>
                      </Match>
                      <Match when={release()!.platforms[p].length === 0}>
                        <span
                          class="inline-flex h-6 items-center rounded-md px-2 text-xs font-semibold"
                          style={{ background: "var(--progress-bg)", color: "var(--progress-ink)" }}
                        >
                          Coming soon
                        </span>
                        <p class="mt-3 text-sm text-mute">
                          Follow along on the{" "}
                          <a href="/roadmap/" class="text-icon hover:underline">
                            roadmap
                          </a>
                          .
                        </p>
                      </Match>
                      <Match when={release()!.platforms[p]}>
                        {(installers) => (
                          <>
                            <a
                              href={installers()[0].url}
                              class="press flex h-11 w-full items-center justify-center gap-2 rounded-full bg-accent font-medium text-accent-ink hover:bg-accent-hover"
                            >
                              <ArrowDownToLine class="size-4" stroke-width={2.2} />
                              {installers()[0].label}
                            </a>
                            <ul class="mt-4 space-y-2 text-sm">
                              <For each={installers().slice(1)}>
                                {(i) => (
                                  <li>
                                    <a href={i.url} class="flex justify-between gap-4 text-mute hover:text-ink">
                                      {i.label}
                                      <span class="text-faint tabular-nums">{formatSize(i.size)}</span>
                                    </a>
                                  </li>
                                )}
                              </For>
                            </ul>
                          </>
                        )}
                      </Match>
                    </Switch>
                  </div>
                </Smooth>
              </li>
            )}
          </For>
        </ul>
        <p class="mt-8 text-center text-sm text-faint">
          Looking for an older version?{" "}
          <a href="https://github.com/unzoid/polarity/releases" class="text-mute hover:text-ink hover:underline">
            All releases
          </a>
          {" · "}
          <a href="https://github.com/unzoid/polarity#getting-started" class="text-mute hover:text-ink hover:underline">
            Build from source
          </a>
        </p>
      </section>
    </Layout>
  );
}

render(() => <Download />, document.getElementById("root")!);
