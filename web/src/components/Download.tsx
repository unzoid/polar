import { Show } from "solid-js";
import ArrowDownToLine from "lucide-solid/icons/arrow-down-to-line";
import { REPO_URL } from "./GitHub";
import { DOWNLOAD_PAGE, PLATFORM_NAMES, platform, primaryInstaller, release } from "../lib/release";

/**
 * Downloads straight away when the visitor's platform has a build;
 * otherwise it goes to the download page, which lists what exists.
 */
export function DownloadButton(props: { size?: "sm" | "lg" }) {
  const big = () => props.size !== "sm";
  const installer = primaryInstaller;
  const label = () => {
    if (!big()) return "Download";
    return installer() && platform ? `Download for ${PLATFORM_NAMES[platform]}` : "Download Polarity";
  };
  return (
    <a
      href={installer()?.url ?? DOWNLOAD_PAGE}
      class="press inline-flex items-center justify-center gap-2 rounded-full bg-accent font-medium whitespace-nowrap text-accent-ink select-none hover:bg-accent-hover"
      classList={{ "h-12 px-6 text-[1.0625rem]": big(), "h-8 px-3.5 text-sm": !big() }}
    >
      <Show when={platform === "windows" && installer()} fallback={<ArrowDownToLine class={big() ? "size-[18px]" : "size-3.5"} stroke-width={2.2} />}>
        <WindowsGlyph class={big() ? "size-4" : "size-3"} />
      </Show>
      {label()}
    </a>
  );
}

/** "Free and open source (MIT) · Version 0.17.0 · Other platforms" under a download button. */
export function ReleaseNote(props: { class?: string }) {
  return (
    <p class={`text-sm text-faint ${props.class ?? ""}`}>
      Free and open source (
      <a href={`${REPO_URL}/blob/master/LICENSE`} class="underline-offset-4 hover:text-mute hover:underline">
        MIT
      </a>
      )
      <Show when={release()?.version}>
        {(version) => (
          <>
            {" · "}
            <a href={release()!.notes} class="underline-offset-4 hover:text-mute hover:underline">
              Version {version()}
            </a>
          </>
        )}
      </Show>
      {" · "}
      <a href={DOWNLOAD_PAGE} class="underline-offset-4 hover:text-mute hover:underline">
        Other platforms
      </a>
    </p>
  );
}

export function WindowsGlyph(props: { class?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" class={props.class}>
      <path d="M0 2.3 6.5 1.4v6.2H0zM7.3 1.3 16 0v7.6H7.3zM0 8.4h6.5v6.2L0 13.7zM7.3 8.4H16V16l-8.7-1.2z" />
    </svg>
  );
}
