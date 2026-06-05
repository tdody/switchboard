import { describe, expect, it } from "vitest";

import { suggestLayout } from "./suggestLayout";

describe("suggestLayout (THI-61)", () => {
  describe("from kanban", () => {
    it("suggests grid when a status filter is active and ≤6 cards are visible", () => {
      expect(suggestLayout("kanban", "waiting", 4)).toBe("grid");
      expect(suggestLayout("kanban", "waiting", 6)).toBe("grid");
    });

    it("does not suggest grid when 'all' is selected, regardless of count", () => {
      expect(suggestLayout("kanban", "all", 4)).toBeNull();
    });

    it("does not suggest grid past 6 visible cards", () => {
      expect(suggestLayout("kanban", "waiting", 7)).toBeNull();
    });

    it("suggests list once ≥18 cards are visible (regardless of filter)", () => {
      expect(suggestLayout("kanban", "all", 18)).toBe("list");
      expect(suggestLayout("kanban", "running", 25)).toBe("list");
    });

    it("does not suggest below 18 visible cards", () => {
      expect(suggestLayout("kanban", "all", 17)).toBeNull();
    });

    it("the ≥18 list suggestion wins over filtered-grid at high counts", () => {
      // Edge: a status filter is active AND there are 18+ cards. Density
      // wins because too-many-cards is a worse UX than too-few.
      expect(suggestLayout("kanban", "waiting", 20)).toBe("list");
    });
  });

  describe("from list", () => {
    it("suggests grid when ≤4 cards are visible", () => {
      expect(suggestLayout("list", "all", 2)).toBe("grid");
      expect(suggestLayout("list", "all", 4)).toBe("grid");
    });

    it("does not suggest above 4 visible cards", () => {
      expect(suggestLayout("list", "all", 5)).toBeNull();
    });
  });

  describe("from grid", () => {
    it("never suggests a switch — grid is the neutral baseline", () => {
      expect(suggestLayout("grid", "all", 1)).toBeNull();
      expect(suggestLayout("grid", "all", 50)).toBeNull();
      expect(suggestLayout("grid", "waiting", 3)).toBeNull();
    });
  });
});
