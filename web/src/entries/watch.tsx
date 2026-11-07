import { render } from "solid-js/web";
import "../styles.css";
import { titleLink } from "../lib/appLinks";
import { Handover } from "./handover";

// "Watch in Polarity" (#153) and the browser extension's "Open in Polarity" (#208): /watch?type=series&id=tt0000000
// opens that title in the visitor's own Polarity.
const link = titleLink(location.search);

render(
  () => <Handover title="Opening Polarity…" lede="The title opens in Polarity on this computer." link={link} afterInstall="come back here and press Open in Polarity" />,
  document.getElementById("root")!,
);
