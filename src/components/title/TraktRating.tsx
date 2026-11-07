import type { MetaPreview } from "../../lib/types";
import { useTraktRating } from "../../lib/trakt";
import { Check, Star, Trash } from "../icons";
import { buttonClass } from "../ui/Button";
import { MenuHeader, MenuItem, MenuPopup, MenuRoot, MenuSeparator, MenuTrigger } from "../ui/Menu";

const SCALE = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

/**
 * The profile's Trakt rating of a film or show (#85), in a title page's action row: only when the
 * profile has linked Trakt and the title is one Trakt knows (a `tt…` id). A star alone until rated,
 * then the star and the rating; a menu of 10 to 1 and, once rated, taking the rating off.
 */
export function TraktRating({ item }: { item: MetaPreview }) {
  const r = useTraktRating(item);
  if (!r) return null;
  const label = r.rating ? `Your Trakt rating: ${r.rating} of 10` : "Rate on Trakt";
  return (
    <MenuRoot modal={false}>
      <MenuTrigger className={buttonClass("glass", !r.rating, "trakt-rating")} aria-label={label} title={label}>
        <Star size={r.rating ? 18 : 20} />
        {r.rating ? <span className="tabular">{r.rating}</span> : null}
      </MenuTrigger>
      <MenuPopup side="bottom" align="center" sideOffset={8} collisionPadding={12} aria-label="Rate on Trakt">
        <MenuHeader title="Rate on Trakt" detail="1 to 10" />
        {SCALE.map((n) => (
          <MenuItem key={n} icon={<span className="menu-check">{r.rating === n && <Check />}</span>} onClick={() => r.rate(n)}>
            {String(n)}
          </MenuItem>
        ))}
        {r.rating ? (
          <>
            <MenuSeparator />
            <MenuItem icon={<Trash />} onClick={() => r.rate(null)}>
              Remove Rating
            </MenuItem>
          </>
        ) : null}
      </MenuPopup>
    </MenuRoot>
  );
}
