import { useEffect, useRef } from "react";
import { api } from "../api";
import { useAccount } from "../account/AccountProvider";
import { useDownloads, type Download } from "../library/downloads";
import { cachedLookup, queryClient } from "../net/queries";
import { notePermission, onNoteClick, planNotes, showNote, systemPlansNotes } from "../platform/notifications";
import { usePrefs } from "../settings/prefs";
import { useRouter, type TabRoute } from "../router";
import { runCheck, type CheckDeps } from "./check";
import { downloadNotes } from "./messages";
import { payloadRoute, routePayload } from "./store";

/**
 * Notifications while the app runs (#209), mounted once inside the router: checks for new episodes
 * on launch and every few hours (sooner when a listed episode is due), tells of downloads that
 * finish, and opens what a clicked note is about.
 */

/** Between checks while the app runs. */
export const CHECK_EVERY = 3 * 60 * 60_000;
/** After launch, so the first screens load first. */
const FIRST_CHECK = 15_000;

const TABS = new Set(["home", "discover", "anime", "library", "calendar", "search", "settings"]);

/** Shows a note only where the system lets it. */
async function show(note: Parameters<typeof showNote>[0]) {
  if ((await notePermission()) === "granted") await showNote(note);
}

export function useNotifications() {
  const { profile } = useAccount();
  const profileId = profile?.id ?? "guest";
  const { notifyEpisodes, notifySeasons, notifyDownloads, notifyScope } = usePrefs();
  const { navigate, tab } = useRouter();

  // Clicks, also the one that started the app.
  useEffect(
    () =>
      onNoteClick((payload) => {
        const route = payloadRoute(payload);
        if (!route) return;
        if (TABS.has(route.name)) tab(route as TabRoute);
        else navigate(route);
      }),
    [navigate, tab],
  );

  // New episodes and seasons.
  useEffect(() => {
    const options = { episodes: notifyEpisodes, seasons: notifySeasons, scope: notifyScope };
    const lookup = cachedLookup(queryClient);
    const deps: CheckDeps = {
      library: api.library,
      started: async () => [...(await api.continueWatching()), ...(await api.watchHistory())],
      meta: lookup.meta,
      show,
      plan: systemPlansNotes ? planNotes : null,
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = 0;
    let stopped = false;
    const check = async () => {
      clearTimeout(timer);
      last = Date.now();
      const due = await runCheck(profileId, options, deps).catch(() => undefined);
      if (stopped || (!options.episodes && !options.seasons)) return;
      // A second past the listed moment, so it counts as out.
      const wait = due ? Math.min(CHECK_EVERY, Math.max(60_000, due - Date.now() + 1000)) : CHECK_EVERY;
      timer = setTimeout(check, wait);
    };
    // Back from the background (phones, a sleeping laptop): timers may not have run.
    const back = () => document.visibilityState === "visible" && Date.now() - last > CHECK_EVERY && void check();
    timer = setTimeout(check, FIRST_CHECK);
    document.addEventListener("visibilitychange", back);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", back);
    };
  }, [profileId, notifyEpisodes, notifySeasons, notifyScope]);

  // Downloads: compared each time the list changes (it's polled while one is moving).
  const { data: downloads } = useDownloads();
  const seen = useRef<Download[] | undefined>(undefined);
  useEffect(() => {
    if (!downloads) return;
    const before = seen.current;
    seen.current = downloads;
    if (!before || !notifyDownloads) return;
    for (const n of downloadNotes(before, downloads)) void show({ id: n.id, title: n.title, body: n.body, payload: routePayload(n.route) }).catch(() => undefined);
  }, [downloads, notifyDownloads]);
}
