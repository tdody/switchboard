import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { Tour } from "./Tour";
import { markTourDismissed } from "../lib/tour";

function plantAnchor(id: string): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("data-tour", id);
  // Give it a non-zero rect so getBoundingClientRect returns sensible numbers
  // in happy-dom (which otherwise returns zeros for unstyled detached nodes).
  Object.assign(el.style, {
    position: "absolute",
    top: "100px",
    left: "100px",
    width: "200px",
    height: "80px",
  });
  document.body.appendChild(el);
  return el;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("Tour", () => {
  it("renders nothing when `enabled` is false", () => {
    plantAnchor("first-card");
    const { container } = render(<Tour enabled={false} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders nothing when the tour has been dismissed", () => {
    markTourDismissed();
    plantAnchor("first-card");
    render(<Tour enabled={true} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders step 1 when enabled and not dismissed", () => {
    plantAnchor("first-card");
    render(<Tour enabled={true} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("This is a window card");
    expect(dialog.textContent).toContain("Step 1 of 8");
  });

  it("advances on Next click", () => {
    plantAnchor("first-card");
    render(<Tour enabled={true} />);
    expect(screen.getByText(/Step 1 of 8/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText(/Step 2 of 8/)).toBeTruthy();
  });

  it("`Back` is disabled on step 1 and goes back from step 2", () => {
    plantAnchor("first-card");
    render(<Tour enabled={true} />);
    const back = screen.getByRole("button", { name: "Back" });
    expect(back.hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText(/Step 1 of 8/)).toBeTruthy();
  });

  it("the final step's primary action label is `Done` and dismisses the tour", () => {
    plantAnchor("first-card");
    plantAnchor("preset-save");
    plantAnchor("layout-switcher");
    plantAnchor("amber-waiting");
    plantAnchor("kbar-hint");
    render(<Tour enabled={true} />);
    // 7 Next clicks to reach the last (8th) step (THI-225).
    for (let i = 0; i < 7; i++) {
      fireEvent.click(screen.getByRole("button", { name: "Next" }));
    }
    expect(screen.getByText(/Step 8 of 8/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    // Persisted as dismissed.
    expect(localStorage.getItem("switchboard:tour:v2:dismissed")).toBe("1");
  });

  it("Skip tour dismisses and persists immediately", () => {
    plantAnchor("first-card");
    render(<Tour enabled={true} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem("switchboard:tour:v2:dismissed")).toBe("1");
  });

  it("Esc dismisses the tour", () => {
    plantAnchor("first-card");
    render(<Tour enabled={true} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(localStorage.getItem("switchboard:tour:v2:dismissed")).toBe("1");
  });

  it("ArrowRight advances and ArrowLeft goes back", () => {
    plantAnchor("first-card");
    render(<Tour enabled={true} />);
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByText(/Step 2 of 8/)).toBeTruthy();
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(screen.getByText(/Step 1 of 8/)).toBeTruthy();
  });

  it("re-mounting after dismissal stays hidden", () => {
    plantAnchor("first-card");
    const { unmount } = render(<Tour enabled={true} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    unmount();
    render(<Tour enabled={true} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
