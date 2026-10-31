import { useRef } from "react";
import { prefetchMeta, preloadImage } from "../lib/queries";
import { useRouter } from "../lib/router";
import type { MetaPreview } from "../lib/types";
import { Img } from "./Img";

const INTENT_DELAY = 120;

/** Prefetch detail + backdrop once the pointer rests on a title. */
export function useIntent(item: Pick<MetaPreview, "type" | "id" | "background">) {
  const timer = useRef<number>(undefined);
  const start = () => {
    timer.current = window.setTimeout(() => {
      prefetchMeta(item.type, item.id);
      preloadImage(item.background);
    }, INTENT_DELAY);
  };
  const cancel = () => window.clearTimeout(timer.current);
  return { onPointerEnter: start, onPointerLeave: cancel, onFocus: start, onBlur: cancel };
}

function useOpen(item: MetaPreview) {
  const { navigate } = useRouter();
  return () => navigate({ name: "detail", type: item.type, id: item.id, preview: item });
}

/** Portrait 2:3 poster — used in grids (Movies, Series, Search, Library). */
export function PosterCard({ item, progress }: { item: MetaPreview; progress?: number }) {
  const open = useOpen(item);
  const intent = useIntent(item);

  return (
    <button className="card card-poster" onClick={open} {...intent}>
      <div className="card-frame">
        <Img src={item.poster} alt="" className="card-img" />
        {!item.poster && <span className="card-fallback t-headline">{item.name}</span>}
        {progress != null && <ProgressBar fraction={progress} />}
      </div>
      <div className="card-caption">
        <span className="card-title t-callout">{item.name}</span>
        <span className="t-caption faint tabular">{item.releaseInfo}</span>
      </div>
    </button>
  );
}

/**
 * Landscape 16:9 lockup in the tvOS style: backdrop art with the title
 * treatment (logo) set on it, caption underneath. Falls back to the poster
 * when an item has no backdrop.
 */
export function LandscapeCard({ item }: { item: MetaPreview }) {
  const open = useOpen(item);
  const intent = useIntent(item);
  const art = item.background ?? item.poster;

  return (
    <button className="card card-landscape" onClick={open} {...intent}>
      <div className="card-frame">
        <Img src={art} alt="" className="card-img" />
        <div className="card-art-scrim" />
        {item.logo ? (
          <Img src={item.logo} alt={item.name} className="card-logo" />
        ) : (
          <span className="card-art-title t-title2">{item.name}</span>
        )}
      </div>
      <div className="card-caption">
        <span className="card-title t-callout">{item.name}</span>
        <span className="t-caption faint">
          {[item.type === "movie" ? "Movie" : "TV Show", item.genres?.[0], item.releaseInfo].filter(Boolean).join(" · ")}
        </span>
      </div>
    </button>
  );
}

export function ProgressBar({ fraction }: { fraction: number }) {
  return (
    <div className="progress-track">
      <div className="progress-fill" style={{ transform: `scaleX(${fraction})` }} />
    </div>
  );
}

export function CardSkeleton({ shape = "poster" }: { shape?: "poster" | "landscape" }) {
  return (
    <div className={`card card-${shape}`} aria-hidden>
      <div className="card-frame skeleton" />
      <div className="card-caption">
        <span className="skeleton skeleton-line" style={{ width: "70%" }} />
      </div>
    </div>
  );
}

export const PosterSkeleton = () => <CardSkeleton shape="poster" />;
