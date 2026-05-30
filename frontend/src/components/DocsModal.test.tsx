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

  it("Replay tour button clears the dismissed flag and closes (THI-147)", () => {
    // Seed the dismissed flag — like a returning user.
    localStorage.setItem("switchboard:tour:v1:dismissed", "1");
    const onClose = vi.fn();
    render(<DocsModal onClose={onClose} />);

    const replay = screen.getByRole("button", { name: /replay tour/i });
    fireEvent.click(replay);

    expect(localStorage.getItem("switchboard:tour:v1:dismissed")).toBeNull();
    expect(onClose).toHaveBeenCalled();
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
