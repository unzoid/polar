import { nativeDialogsAvailable } from "../lib/platform";
import { useFormFactor } from "../lib/ui";

/**
 * Whether the profile sheet (ProfileMenu.tsx, a phone's) shows Friends and "Join a Watch Party" itself, as views
 * inside it, rather than their own dialogs: on a phone, except on iOS, where the profile menu is the system's.
 */
export function useProfileSheetHosts() {
  return useFormFactor().form === "phone" && !nativeDialogsAvailable;
}
