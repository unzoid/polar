import { render } from "solid-js/web";
import "../styles.css";
import { Handover } from "./handover";

// "Watch in Polarity": /watch?type=series&id=tt0000000 opens that title in the visitor's own Polarity.
const q = new URLSearchParams(location.search);
const type = q.get("type");
const id = q.get("id") ?? "";
const ok = (type === "movie" || type === "series") && /^(tt\d{1,10}|kitsu:\d{1,9})$/.test(id);
const link = ok ? `polarity://title/${type}/${encodeURIComponent(id)}` : null;

render(
  () => <Handover title="Opening Polarity…" lede="The title opens in Polarity on this computer." link={link} afterInstall="come back here and press Open in Polarity" />,
  document.getElementById("root")!,
);
