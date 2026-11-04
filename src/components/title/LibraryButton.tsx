import { useLibrary, useToggleLibrary } from "../../lib/net";
import type { MetaPreview } from "../../lib/types";
import { Check, Plus } from "../icons";
import { SwapIcon } from "../SwapIcon";
import { IconButton } from "../ui/Button";

/** Add to or remove from the Library (docs/ui-components.md U5): the + / ✓ button of the heroes and title pages. */
export function LibraryButton({ item }: { item: MetaPreview }) {
  const { data: library } = useLibrary();
  const toggle = useToggleLibrary();
  const inLibrary = library?.some((l) => l.id === item.id);
  const label = inLibrary ? "Remove from Library" : "Add to Library";
  return (
    <IconButton variant="glass" onClick={() => toggle.mutate(item)} label={label} title={label} aria-pressed={inLibrary}>
      <SwapIcon state={library && (inLibrary ? "in" : "out")}>{inLibrary ? <Check size={20} /> : <Plus size={20} />}</SwapIcon>
    </IconButton>
  );
}
