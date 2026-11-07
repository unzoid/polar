import { linkSimkl, SimklReadOnly, startDeviceSignIn, waitForDeviceSignIn, type DeviceCode } from "../../lib/simkl";
import { DeviceCodeSignIn, type SignInEnd } from "./DeviceCodeSignIn";

type Why = "expired" | "refused" | "readOnly";

const WHY: Record<Why, string> = {
  expired: "The code ran out before it was allowed. Get a new code to try again.",
  refused: "Simkl didn't accept the sign-in. Try again later.",
  readOnly: "Simkl only allowed reading your lists, so nothing could be sent. Get a new code and allow changes too.",
};

/** Simkl's device code sign-in (#86): a short code to enter at simkl.com/pin. */
export function SimklSignIn({ space }: { space: string | null }) {
  const finish = async (code: DeviceCode, signal: AbortSignal, linking: () => void): Promise<SignInEnd<Why>> => {
    const result = await waitForDeviceSignIn(code, { signal });
    if (result.state !== "allowed") return { linked: false, why: result.state === "expired" ? "expired" : "refused" };
    linking();
    try {
      await linkSimkl(space, result.tokens);
    } catch (e) {
      if (e instanceof SimklReadOnly) return { linked: false, why: "readOnly" };
      throw e;
    }
    return { linked: true };
  };
  return (
    <DeviceCodeSignIn
      service="Simkl"
      intro="Polarity shows a short code to enter on Simkl's site from any browser or phone. The sign-in stays on this device."
      start={() => startDeviceSignIn().then((code) => ({ ...code, openUrl: code.completeUrl }))}
      finish={finish}
      why={WHY}
    />
  );
}
