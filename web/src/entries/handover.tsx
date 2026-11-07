import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { Layout } from "../components/Layout";

/**
 * The /watch and /party pages (#153, #208): the buttons on someone's Discord profile and the browser
 * extension land here. The page opens the polarity:// link at once; if Polarity doesn't take over
 * within a moment (not installed, or the browser asks first), it offers the download and a button to
 * try again. The link is made from the page's own address (web/src/lib/appLinks.ts), checked first:
 * nothing is fetched and nothing is sent anywhere.
 */
export function Handover(props: { title: string; lede: string; link: string | null; afterInstall: string }) {
  // How long Polarity has to take over before the page offers the download.
  const WAIT_MS = 1500;
  const [missed, setMissed] = createSignal(false);
  const open = () => {
    if (props.link) window.location.href = props.link;
  };
  onMount(() => {
    if (!props.link) return setMissed(true);
    let left = false;
    const away = () => (left ||= document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", away);
    window.addEventListener("blur", away);
    open();
    const t = window.setTimeout(() => !left && setMissed(true), WAIT_MS);
    onCleanup(() => {
      window.clearTimeout(t);
      document.removeEventListener("visibilitychange", away);
      window.removeEventListener("blur", away);
    });
  });
  return (
    <Layout>
      <section class="px-6 pt-36 text-center sm:pt-44">
        <h1 class="enter text-display" style={{ "--rise": "16px", "--dur": "800ms" }}>
          {props.link ? props.title : "This link isn't complete"}
        </h1>
        <p class="enter text-lede mx-auto mt-5 max-w-[32rem] text-mute" style={{ "--rise": "10px", "--delay": "100ms" }}>
          {props.link ? props.lede : "Ask whoever shared it for a new one, or get Polarity below."}
        </p>
        <div class="enter mx-auto mt-10 flex max-w-[32rem] flex-col items-center gap-4" style={{ "--rise": "10px", "--delay": "200ms" }}>
          <Show when={props.link}>
            <button
              type="button"
              onClick={open}
              class="press flex h-11 items-center justify-center rounded-full bg-accent px-6 font-medium text-accent-ink hover:bg-accent-hover"
            >
              Open in Polarity
            </button>
          </Show>
          <Show when={missed()}>
            <p class="text-[0.9375rem] text-mute">
              Don't have Polarity yet?{" "}
              <a href="/download/" class="text-icon hover:underline">
                Download it
              </a>
              <Show when={props.link}>{`, then ${props.afterInstall}`}</Show>.
            </p>
          </Show>
        </div>
      </section>
    </Layout>
  );
}
