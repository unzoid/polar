/**
 * The "Open in Polarity" button (#208), on the database sites the manifest lists, and "Watch together
 * in Polarity" on YouTube video pages. It reads the page's address, IMDb's `og:type` (film or show),
 * Trakt's and Letterboxd's links to the title's IMDb and TMDB pages, and on YouTube the video's title
 * and where it's playing; nothing else, and nothing is sent anywhere. The button is a link to the
 * website's /watch or /party page, which hands the title or video to Polarity (or offers the download).
 *
 * The sites are single-page apps: what the button says is checked again every second and on their
 * own navigation events, so it follows the page without reloading.
 */
import { openPage, titleFromAddress, titleFromLinks, togetherPage, youtubeLink, youtubeVideo } from "./ids";

type Button = { label: string; href: () => string };

/** Links to the title's IMDb and TMDB pages, on the sites that only say which title it is that way. */
function databaseLinks(): string[] {
  if (!/(^|\.)(trakt\.tv|letterboxd\.com)$/.test(location.hostname)) return [];
  return [...document.querySelectorAll<HTMLAnchorElement>('a[href*="imdb.com/title/"], a[href*="themoviedb.org/"]')].slice(0, 50).map((a) => a.href);
}

function buttonHere(): Button | null {
  const href = location.href;
  const video = youtubeVideo(href);
  if (video) {
    const playing = () => document.querySelector<HTMLVideoElement>("video.html5-main-video, video");
    return { label: "Watch together in Polarity", href: () => togetherPage(youtubeLink(video), playing()?.currentTime ?? 0, document.title) };
  }
  const og = document.querySelector('meta[property="og:type"]')?.getAttribute("content");
  const title = titleFromAddress(href, og) ?? titleFromLinks(href, databaseLinks());
  if (!title) return null;
  const page = openPage(title);
  return { label: "Open in Polarity", href: () => page };
}

const STYLE = `
:host { all: initial; }
.bar { position: fixed; right: 20px; bottom: 20px; z-index: 2147483646; display: flex; align-items: center; gap: 2px;
  padding: 4px; border-radius: 999px; background: rgb(20 20 22 / 0.92); box-shadow: 0 6px 24px rgb(0 0 0 / 0.35), inset 0 0 0 1px rgb(255 255 255 / 0.12);
  font: 500 14px/1 system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff; }
a, button { all: unset; box-sizing: border-box; cursor: pointer; border-radius: 999px; }
a { padding: 10px 14px; }
button { width: 32px; height: 32px; display: grid; place-items: center; font-size: 18px; color: rgb(255 255 255 / 0.7); }
a:hover, button:hover { background: rgb(255 255 255 / 0.12); color: #fff; }
a:focus-visible, button:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
@media (prefers-reduced-motion: no-preference) { .bar { animation: in 200ms ease-out; } }
@keyframes in { from { opacity: 0; transform: translateY(6px); } }
`;

const host = document.createElement("polarity-open");
const root = host.attachShadow({ mode: "open" });
root.innerHTML = `<style>${STYLE}</style><div class="bar" role="region" aria-label="Polarity"><a target="_blank" rel="noopener noreferrer"></a><button type="button" aria-label="Hide for this page" title="Hide for this page">×</button></div>`;
const link = root.querySelector("a")!;
let button: Button | null = null;
// Hidden by the user on this page; shows again on the next one.
let hiddenOn: string | null = null;

// The link is made when it's used, so a YouTube video starts where it's playing now.
const freshen = () => button && (link.href = button.href());
link.addEventListener("pointerdown", freshen);
link.addEventListener("keydown", freshen);
link.addEventListener("click", freshen);
root.querySelector("button")!.addEventListener("click", () => {
  hiddenOn = location.href;
  update();
});

function update() {
  if (hiddenOn !== null && hiddenOn !== location.href) hiddenOn = null;
  button = hiddenOn === null && !document.fullscreenElement ? buttonHere() : null;
  if (!button) return host.remove();
  link.textContent = button.label;
  link.href = button.href();
  if (!host.isConnected) document.documentElement.append(host);
}

update();
setInterval(update, 1000);
for (const event of ["popstate", "yt-navigate-finish"]) window.addEventListener(event, update);
document.addEventListener("fullscreenchange", update);
