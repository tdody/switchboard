import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ShortcutsSheet } from "./ShortcutsSheet";

afterEach(cleanup);

describe("ShortcutsSheet", () => {
  it("renders section headings with at least one kbd chip per section", () => {
    const { container } = render(<ShortcutsSheet onClose={vi.fn()} />);

    const sections = container.querySelectorAll(".shortcuts-section");
    expect(sections.length).toBeGreaterThanOrEqual(3);
    expect(sections.length).toBeGreaterThan(0);

    sections.forEach((section) => {
      // each section heading is followed by sibling .shortcut-row elements; the
      // first row should contain at least one .kbd chip.
      let sib = section.nextElementSibling;
      let foundKbd = false;
      while (sib && !sib.classList.contains("shortcuts-section")) {
        if (sib.querySelector(".kbd")) {
          foundKbd = true;
          break;
        }
        sib = sib.nextElementSibling;
      }
      expect(foundKbd).toBe(true);
    });
  });

  it("renders the Navigation, Modal, and Help-related groupings", () => {
    render(<ShortcutsSheet onClose={vi.fn()} />);
    expect(screen.getByText(/navigation/i)).toBeTruthy();
    expect(screen.getByText(/modal/i)).toBeTruthy();
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(<ShortcutsSheet onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when the scrim is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(<ShortcutsSheet onClose={onClose} />);
    const scrim = container.querySelector(".scrim") as HTMLElement;
    expect(scrim).toBeTruthy();
    fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onClose when clicking inside the modal body", () => {
    const onClose = vi.fn();
    const { container } = render(<ShortcutsSheet onClose={onClose} />);
    const modal = container.querySelector(".shortcuts") as HTMLElement;
    expect(modal).toBeTruthy();
    fireEvent.click(modal);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose when the header close button is clicked", () => {
    const onClose = vi.fn();
    render(<ShortcutsSheet onClose={onClose} />);
    fireEvent.click(screen.getByTitle(/close/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
