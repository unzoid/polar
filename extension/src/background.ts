/**
 * "Watch together in Polarity" in the context menu (#208): on a link to a video file or stream, and
 * on a tab that is itself one (VIDEO_PATTERNS). It opens the website's /party page with the link in
 * its fragment, which hands it to Polarity; Polarity shows the link and asks before a party starts.
 * Nothing is read from any page and nothing is sent anywhere by the extension.
 */
import { isVideoAddress, togetherPage, VIDEO_PATTERNS } from "./ids";

const LINK = "together-link";
const PAGE = "together-page";

// Menus last across restarts of the background script; made again when the extension is installed,
// updated, or the browser starts, so there's never a stale or a doubled one.
function makeMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: LINK, title: "Watch together in Polarity", contexts: ["link"], targetUrlPatterns: VIDEO_PATTERNS });
    chrome.contextMenus.create({ id: PAGE, title: "Watch together in Polarity", contexts: ["page", "video"], documentUrlPatterns: VIDEO_PATTERNS });
  });
}
chrome.runtime.onInstalled.addListener(makeMenus);
chrome.runtime.onStartup.addListener(makeMenus);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const url = info.menuItemId === LINK ? info.linkUrl : info.menuItemId === PAGE ? info.pageUrl : undefined;
  // The patterns only narrow where the menu shows; the link is checked again here.
  if (!isVideoAddress(url)) return;
  const name = info.menuItemId === LINK ? info.linkText : tab?.title;
  chrome.tabs.create({ url: togetherPage(url, 0, name), index: tab ? tab.index + 1 : undefined });
});
