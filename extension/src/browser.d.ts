// The few extension APIs the background script uses, as Chrome and Firefox both offer them under
// `chrome` (Manifest V3). Declared here instead of a types package: nothing else is used.

declare namespace chrome {
  namespace runtime {
    const onInstalled: { addListener(fn: () => void): void };
    const onStartup: { addListener(fn: () => void): void };
  }
  namespace contextMenus {
    type ContextType = "page" | "link" | "video";
    interface OnClickData {
      menuItemId: string | number;
      linkUrl?: string;
      pageUrl?: string;
      srcUrl?: string;
      /** Firefox only: the link's text. */
      linkText?: string;
    }
    function removeAll(done?: () => void): void;
    function create(props: { id: string; title: string; contexts: ContextType[]; targetUrlPatterns?: string[]; documentUrlPatterns?: string[] }): void;
    const onClicked: { addListener(fn: (info: OnClickData, tab?: { index: number; title?: string }) => void): void };
  }
  namespace tabs {
    function create(props: { url: string; index?: number }): void;
  }
}
