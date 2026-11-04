import { useCardIntent } from "../lib/ui";
import { prefetchMeta, preloadImage } from "../lib/net";
import { useRouter } from "../lib/router";
import type { MetaPreview, Progress } from "../lib/types";
import { cardMenu } from "./CardMenu";
import { CardRating } from "./ImdbBadge";
import { ArtTitle, Card, ProgressBar } from "./title/Card";

const INTENT_DELAY = 120;

/** Prefetch detail + backdrop once the pointer rests on a title. */
export function useIntent(item: Pick<MetaPreview, "type" | "id" | "background">) {
  return useCardIntent(() => {
    prefetchMeta(item.type, item.id);
    preloadImage(item.background);
  }, INTENT_DELAY);
}

function useOpen(item: MetaPreview) {
  const { navigate } = useRouter();
  return () => navigate({ name: "detail", type: item.type, id: item.id, preview: item });
}

/** Portrait 2:3 poster — used in grids (Movies, Series, Search, Library). A poster that doesn't load leaves the name. */
export function PosterCard({ item, progress, entry }: { item: MetaPreview; progress?: number; entry?: Progress }) {
  const open = useOpen(item);
  const intent = useIntent(item);
  return (
    <Card
      shape="poster"
      art={item.poster}
      fallback={<span className="card-fallback t-headline">{item.name}</span>}
      title={item.name}
      detail={item.releaseInfo ?? ""}
      trailing={<CardRating rating={item.imdbRating} />}
      onClick={open}
      {...intent}
      {...cardMenu(item, entry)}
    >
      {progress != null && <ProgressBar fraction={progress} />}
      <CardRating rating={item.imdbRating} placement="poster" />
    </Card>
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
  return (
    <Card
      shape="landscape"
      art={item.background ?? item.poster}
      title={item.name}
      detail={[item.type === "movie" ? "Movie" : "Series", item.genres?.[0], item.releaseInfo].filter(Boolean).join(" · ")}
      tabular={false}
      onClick={open}
      {...intent}
      {...cardMenu(item)}
    >
      <ArtTitle name={item.name} logo={item.logo} />
    </Card>
  );
}
