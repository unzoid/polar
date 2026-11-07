import { linkTrakt, startDeviceSignIn, waitForDeviceSignIn, type DeviceCode } from "../../lib/trakt";
import { DeviceCodeSignIn, type SignInEnd } from "./DeviceCodeSignIn";

type Why = "denied" | "expired" | "refused";

const WHY: Record<Why, string> = {
  denied: "The code was declined on Trakt. Get a new code to try again.",
  expired: "The code ran out before it was entered. Get a new code to try again.",
  refused: "Trakt didn't accept the sign-in. If you already use other Trakt apps, Trakt may limit how many a free account can connect.",
};

/** Trakt's device code sign-in (#85): a short code to enter at trakt.tv/activate. */
export function TraktSignIn({ space }: { space: string | null }) {
  const finish = async (code: DeviceCode, signal: AbortSignal, linking: () => void): Promise<SignInEnd<Why>> => {
    const result = await waitForDeviceSignIn(code, { signal });
    if (result.state !== "allowed") return { linked: false, why: result.state === "denied" ? "denied" : result.state === "expired" ? "expired" : "refused" };
    linking();
    await linkTrakt(space, result.tokens);
    return { linked: true };
  };
  return (
    <DeviceCodeSignIn
      service="Trakt"
      intro="Polarity shows a short code to enter on Trakt's site from any browser or phone. The sign-in stays on this device."
      start={() => startDeviceSignIn()}
      finish={finish}
      why={WHY}
    />
  );
}
