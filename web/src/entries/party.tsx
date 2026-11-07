import { render } from "solid-js/web";
import "../styles.css";
import { Handover } from "./handover";

// "Join watch party": /party?t=<join token> asks the party's host to let you in, from your own Polarity.
const t = new URLSearchParams(location.search).get("t") ?? "";
const link = /^[A-Za-z0-9_-]{43}$/.test(t) ? `polarity://party/${t}` : null;

render(
  () => (
    <Handover
      title="Joining the watch party…"
      lede="Polarity opens on this computer and asks the host to let you in. You need to be signed in."
      link={link}
      afterInstall="sign in, come back here and press Open in Polarity (the link works for a few minutes)"
    />
  ),
  document.getElementById("root")!,
);
