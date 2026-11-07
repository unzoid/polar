import { render } from "solid-js/web";
import "../styles.css";
import { joinLink, togetherLink } from "../lib/appLinks";
import { Handover } from "./handover";

// "Join watch party" (#153): /party?t=<join token> asks the party's host to let you in, from your own Polarity.
// "Watch together in Polarity" (#208): /party#u=<video link> asks your Polarity to start a party on that video.
const together = location.search ? null : togetherLink(location.hash);
const link = together ?? joinLink(location.search);

render(
  () =>
    together ? (
      <Handover
        title="Starting a watch party…"
        lede="Polarity opens on this computer and shows you the video's link. The party starts once you say so."
        link={link}
        afterInstall="come back here and press Open in Polarity"
      />
    ) : (
      <Handover
        title="Joining the watch party…"
        lede="Polarity opens on this computer and asks the host to let you in. You need to be signed in."
        link={link}
        afterInstall="sign in, come back here and press Open in Polarity (the link works for a few minutes)"
      />
    ),
  document.getElementById("root")!,
);
