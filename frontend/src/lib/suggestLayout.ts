import type { StatusFilter } from "./filter";
import type { Layout } from "./settings";

/**
 * THI-61: pick a better layout for the current view, or return null if the
 * current one is fine.
 *
 * Thresholds (mirroring the prototype):
 *   - kanban + ≥18 cards          → list  (too many cards, density helps)
 *   - kanban + filtered + ≤6 cards → grid (kanban columns feel wasteful)
 *   - list   + ≤4 cards            → grid (list rows feel sparse)
 *
 * Grid is the neutral baseline — never suggests switching away. The ≥18-list
 * rule deliberately outranks the ≤6-grid rule so a noisy-but-filtered view
 * still escapes Kanban when there's too much.
 */
export function suggestLayout(
  layout: Layout,
  statusFilter: StatusFilter,
  visibleCount: number,
): Layout | null {
  if (layout === "kanban") {
    if (visibleCount >= 18) return "list";
    if (statusFilter !== "all" && visibleCount <= 6) return "grid";
    return null;
  }
  if (layout === "list") {
    if (visibleCount <= 4) return "grid";
    return null;
  }
  return null;
}
