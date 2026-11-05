import { useRef } from "react";
import { useJoinParty } from "../components/party/PartyUI";
import { BusyLabel } from "../components/BusyLabel";
import { WatchParty } from "../components/icons";
import { useAccount } from "../lib/account";
import { CODE_LENGTH, setJoinPartyOpen } from "../lib/party";
import { useBack, useFocusTrap } from "./shell";
import { TvKeyboard } from "./TvKeyboard";

/**
 * TV mode's "Join a Watch Party": the code on the on-screen keyboard (or a
 * real one). Joins as soon as the sixth character is in; Back cancels.
 */
export function TvJoinParty() {
  const { profile } = useAccount();
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  const close = () => setJoinPartyOpen(false);
  useBack(true, close);
  const { code, change, submit, busy, error } = useJoinParty(profile!, close);

  return (
    <div className="tv-panel tv-sources tv-name tv-join" ref={ref} data-nav-scope role="dialog" aria-label="Join a watch party">
      <header className="tv-sources-head">
        <h2 className="tv-heading">Join a Watch Party</h2>
        <p className="tv-sources-sub">Enter the code a friend shared with you.</p>
      </header>
      <div className="tv-osk tv-name-osk">
        <TvKeyboard text={code} onChange={change} onSubmit={() => submit()} placeholder="Party code" active max={CODE_LENGTH} />
        <p className="tv-join-error" role="alert" data-shown={!!error}>
          {error}
        </p>
        <button className="tv-pill tv-name-save" onClick={() => submit()} disabled={busy || !code} aria-busy={busy}>
          <WatchParty size={20} />
          <BusyLabel busy={busy}>Join</BusyLabel>
        </button>
      </div>
    </div>
  );
}
