import { api } from "../../lib/api";
import { SIMKL_STATUSES, useSimklTitle, type SimklKind, type SimklStatus } from "../../lib/simkl";
import type { ContentType } from "../../lib/types";
import { Check, ChevronDown, Star, Trash } from "../icons";
import { buttonClass } from "../ui/Button";
import { MenuHeader, MenuItem, MenuPopup, MenuRoot, MenuSeparator, MenuTrigger } from "../ui/Menu";

const NAMES: Record<SimklStatus, string> = {
  watching: "Watching",
  plantowatch: "Plan to Watch",
  hold: "On Hold",
  completed: "Completed",
  dropped: "Dropped",
};

const SCALE = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

/** The lists a title of this kind can go on: films have no Watching or On Hold on Simkl. */
const statusesFor = (kind: SimklKind) => SIMKL_STATUSES.filter((s) => kind !== "movies" || (s !== "watching" && s !== "hold"));

/**
 * The title on the profile's Simkl lists (#86), under a title page's actions: only when the profile
 * has linked Simkl and the title is one Simkl can be told about (`tt…` or `kitsu:N`). Its list and
 * its rating 1 to 10, each in a menu, and a link to the title's page on Simkl, which Simkl's API
 * rules ask for.
 */
export function SimklPanel({ item }: { item: { id: string; type: ContentType } }) {
  const t = useSimklTitle(item);
  if (!t) return null;
  const ratingLabel = t.rating ? `Your Simkl rating: ${t.rating} of 10` : "Rate on Simkl";
  const open = async () => {
    const url = await t.pageUrl();
    if (url) void api.openExternal(url);
  };
  return (
    <div className="simkl-panel" role="group" aria-label="Simkl">
      <MenuRoot modal={false}>
        <MenuTrigger className={buttonClass("glass", false, "simkl-status", "sm")}>
          {t.status ? `Simkl: ${NAMES[t.status]}` : "Add on Simkl"}
          <ChevronDown size={16} />
        </MenuTrigger>
        <MenuPopup side="bottom" align="start" sideOffset={8} collisionPadding={12} aria-label="List on Simkl">
          <MenuHeader title="List on Simkl" />
          {statusesFor(t.kind).map((s) => (
            <MenuItem key={s} icon={<span className="menu-check">{t.status === s && <Check />}</span>} onClick={() => t.setStatus(s)}>
              {NAMES[s]}
            </MenuItem>
          ))}
          {t.status ? (
            <>
              <MenuSeparator />
              <MenuItem icon={<Trash />} onClick={() => t.setStatus(null)}>
                Remove from Simkl
              </MenuItem>
            </>
          ) : null}
        </MenuPopup>
      </MenuRoot>
      <MenuRoot modal={false}>
        <MenuTrigger className={buttonClass("glass", false, "simkl-rating", "sm")} aria-label={ratingLabel} title={ratingLabel}>
          <Star size={16} />
          {t.rating ? <span className="tabular">{t.rating}</span> : "Rate"}
        </MenuTrigger>
        <MenuPopup side="bottom" align="start" sideOffset={8} collisionPadding={12} aria-label="Rate on Simkl">
          <MenuHeader title="Rate on Simkl" detail="1 to 10" />
          {SCALE.map((n) => (
            <MenuItem key={n} icon={<span className="menu-check">{t.rating === n && <Check />}</span>} onClick={() => t.rate(n)}>
              {String(n)}
            </MenuItem>
          ))}
          {t.rating ? (
            <>
              <MenuSeparator />
              <MenuItem icon={<Trash />} onClick={() => t.rate(null)}>
                Remove Rating
              </MenuItem>
            </>
          ) : null}
        </MenuPopup>
      </MenuRoot>
      <button type="button" className="simkl-page t-caption" onClick={() => void open()}>
        View on Simkl
      </button>
    </div>
  );
}
