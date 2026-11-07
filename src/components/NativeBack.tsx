import { useEffect, useRef, type RefObject } from "react";
import { nativeBackAvailable, onNativeBack, setNativeBack } from "../lib/platform";
import { warnFailed } from "../lib/errors";

type Holder = { el: RefObject<HTMLElement | null>; shown: boolean; history: string[]; onBack: (steps: number) => void };

/** Every Back that could be iOS's, in mount order: the last one showing is the one the button stands for. */
const holders: Holder[] = [];
let listening = false;

const top = () => holders.findLast((h) => h.shown);

function sync() {
  const holder = top();
  const r = holder?.el.current?.getBoundingClientRect();
  const rect = r && r.width > 0 ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  setNativeBack({ shown: !!rect, rect, history: holder?.history ?? [] }).catch(warnFailed("back button"));
}

/**
 * On iOS a web app's Back is drawn by the system (lib/platform/nativeBack.ts) at the place of `button`, while `shown`:
 * a tap calls `onBack(1)`, a page picked from its long-press menu (`history`, nearest first) `onBack(steps)`. Returns
 * whether the system draws it, so the web button hides but keeps its place. Elsewhere nothing, and false.
 */
export function useNativeBack(button: RefObject<HTMLElement | null>, shown: boolean, history: string[], onBack: (steps: number) => void): boolean {
  const holder = useRef<Holder>({ el: button, shown: false, history: [], onBack });
  Object.assign(holder.current, { shown, history, onBack });
  const key = JSON.stringify([shown, history]);

  useEffect(() => {
    if (!nativeBackAvailable) return;
    const h = holder.current;
    holders.push(h);
    if (!listening) {
      listening = true;
      void onNativeBack((steps) => top()?.onBack(steps));
    }
    const ro = new ResizeObserver(sync);
    if (button.current) ro.observe(button.current);
    window.addEventListener("resize", sync);
    return () => {
      holders.splice(holders.indexOf(h), 1);
      ro.disconnect();
      window.removeEventListener("resize", sync);
      sync();
    };
  }, [button]);

  useEffect(() => {
    if (!nativeBackAvailable) return;
    sync();
    // Again once what holds the button has slid or faded into place.
    const later = [350, 700].map((ms) => window.setTimeout(sync, ms));
    return () => later.forEach(clearTimeout);
  }, [key]);

  return nativeBackAvailable && shown;
}
