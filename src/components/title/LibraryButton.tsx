import { useLibrary, useToggleLibrary } from "../../lib/net";
import type { MetaPreview } from "../../lib/types";
import { Check, Plus } from "../icons";
import { SwapIcon } from "../SwapIcon";
import { Button, IconButton } from "../ui/Button";

/**
 * Add to or remove from the Library (docs/ui-components.md U5): the + / ✓ button of the heroes and title pages.
 * `labelled`: a pill with its word beside the glyph, for a phone's featured card (Play | Save, side by side).
 */
export function LibraryButton({ item, labelled = false }: { item: MetaPreview; labelled?: boolean }) {
  const { data: library } = useLibrary();
  const toggle = useToggleLibrary();
  const inLibrary = library?.some((l) => l.id === item.id);
  const label = inLibrary ? "Remove from Library" : "Add to Library";
  const glyph = <SwapIcon state={library && (inLibrary ? "in" : "out")}>{inLibrary ? <Check size={20} /> : <Plus size={20} />}</SwapIcon>;
  if (labelled) {
    return (
      <Button variant="glass" onClick={() => toggle.mutate(item)} aria-label={label} aria-pressed={inLibrary}>
        {glyph}
        {inLibrary ? "Saved" : "Save"}
      </Button>
    );
  }
  return (
    <IconButton variant="glass" onClick={() => toggle.mutate(item)} label={label} title={label} aria-pressed={inLibrary}>
      {glyph}
    </IconButton>
  );
}
