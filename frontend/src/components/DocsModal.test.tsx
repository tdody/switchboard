import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocsModal } from "./DocsModal";

afterEach(cleanup);

beforeEach(() => {
  localStorage.clear();
});

describe("DocsModal", () => {
  it("renders the three reference tabs", () => {
    render(<DocsModal onClose={vi.fn()} />);
    expect(screen.getByRole("tab", { name: /session header/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /agent tile/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /shell tile/i })).toBeTruthy();
  });

  it("surfaces the Drag affordance in the Agent tile secondary strip (THI-147)", () => {
    render(<DocsModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: /agent tile/i }));
    const strip = document.querySelector(".docs-secondary");
    expect(strip).toBeTruthy();
    expect(strip!.textContent).toMatch(/drag/i);
    expect(strip!.textContent).toMatch(/reorder within the session column/i);
  });

  it("surfaces the Drag affordance in the Shell tile secondary strip (THI-147)", () => {
    render(<DocsModal onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("tab", { name: /shell tile/i }));
    const strip = document.querySelector(".docs-secondary");
    expect(strip).toBeTruthy();
    expect(strip!.textContent).toMatch(/drag/i);
  });

  it("documents the ✨ auto-rename button on the Session header diagram (THI-158)", () => {
    // The Session header tab is the default — no click needed.
    render(<DocsModal onClose={vi.fn()} />);
    const diagram = document.querySelector('[aria-label*="Session header"]');
    expect(diagram).toBeTruthy();
    expect(diagram!.textContent).toMatch(/auto-rename/i);
    expect(diagram!.textContent).toMatch(/llm call/i);
  });

  it("cross-references auto-rename from both tile secondary strips (THI-158)", () => {
    // The button only lives on the Session header tab visually, but a user
    // who lands on the tile tabs should still discover it.
    for (const tab of [/agent tile/i, /shell tile/i]) {
      cleanup();
      render(<DocsModal onClose={vi.fn()} />);
      fireEvent.click(screen.getByRole("tab", { name: tab }));
      const strip = document.querySelector(".docs-secondary");
      expect(strip).toBeTruthy();
      expect(strip!.textContent).toMatch(/auto-rename/i);
      expect(strip!.textContent).toMatch(/see session header tab/i);
    }
  });

  it("Replay tour button clears the dismissed flag AND triggers a reload (THI-147)", () => {
    // Seed the dismissed flag — like a returning user.
    localStorage.setItem("switchboard:tour:v2:dismissed", "1");
    const reload = vi.fn();
    Object.defineProperty(window.location, "reload", { value: reload, configurable: true });

    render(<DocsModal onClose={vi.fn()} />);

    const replay = screen.getByRole("button", { name: /replay tour/i });
    fireEvent.click(replay);

    expect(localStorage.getItem("switchboard:tour:v2:dismissed")).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("Done button calls onClose", () => {
    const onClose = vi.fn();
    render(<DocsModal onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape key closes the modal", () => {
    const onClose = vi.fn();
    render(<DocsModal onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
