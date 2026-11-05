import { createSignal, onCleanup, onMount, Show, type JSX } from "solid-js";
import { squirclePath } from "../lib/squircle";

const supportsPathClip = typeof CSS !== "undefined" && CSS.supports("clip-path", 'path("M0 0")');

type Props = {
  radius: number;
  smoothing?: number;
  /** Hairline drawn along the smoothed edge (a CSS color). */
  edge?: string;
  class?: string;
  style?: JSX.CSSProperties;
  children: JSX.Element;
};

/**
 * A box clipped to a smoothed (squircle) outline that tracks its own size.
 * Falls back to plain border-radius where `clip-path: path()` is unsupported.
 * Put shadows on a parent with `filter: drop-shadow()`; box-shadow is clipped away.
 */
export function Smooth(props: Props) {
  let el!: HTMLDivElement;
  const [d, setD] = createSignal("");

  onMount(() => {
    if (!supportsPathClip) return;
    // offsetWidth/Height ignore transforms, so the outline stays correct while the box is scaled.
    const ro = new ResizeObserver(() => setD(squirclePath(el.offsetWidth, el.offsetHeight, props.radius, props.smoothing)));
    ro.observe(el);
    onCleanup(() => ro.disconnect());
  });

  return (
    <div
      ref={el}
      class={`relative overflow-hidden ${props.class ?? ""}`}
      style={{
        ...props.style,
        "border-radius": d() ? undefined : `${props.radius}px`,
        "clip-path": d() ? `path("${d()}")` : undefined,
      }}
    >
      {props.children}
      <Show when={props.edge}>
        <svg class="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
          {/* Stroke is centered on the clip edge, so 2px renders as a 1px inner hairline. */}
          <Show
            when={d()}
            fallback={<rect width="100%" height="100%" rx={props.radius} fill="none" style={{ stroke: props.edge }} stroke-width="2" />}
          >
            <path d={d()} fill="none" style={{ stroke: props.edge }} stroke-width="2" />
          </Show>
        </svg>
      </Show>
    </div>
  );
}
