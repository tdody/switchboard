import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { StatusLegend } from "./StatusLegend";

afterEach(cleanup);

describe("StatusLegend", () => {
  it("renders the trigger but no popover initially", () => {
    render(<StatusLegend />);
    expect(screen.getByRole("button", { name: "Status legend" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the popover on trigger click and lists all five statuses", () => {
    render(<StatusLegend />);
    fireEvent.click(screen.getByRole("button", { name: "Status legend" }));
    const dialog = screen.getByRole("dialog", { name: "Status legend" });
    expect(dialog).toBeTruthy();
    // The five rows: idle, running, waiting, done, error.
    expect(dialog.textContent).toContain("idle");
    expect(dialog.textContent).toContain("running");
    expect(dialog.textContent).toContain("waiting");
    expect(dialog.textContent).toContain("done");
    expect(dialog.textContent).toContain("error");
  });

  it("includes each status's description copy", () => {
    render(<StatusLegend />);
    fireEvent.click(screen.getByRole("button", { name: "Status legend" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("shell prompt is idle");
    expect(dialog.textContent).toContain("agent is asking for your input");
    expect(dialog.textContent).toContain("process exited with an error");
  });

  it("toggles closed on a second trigger click", () => {
    render(<StatusLegend />);
    const trigger = screen.getByRole("button", { name: "Status legend" });
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog")).toBeTruthy();
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes on outside (document-level) mousedown", () => {
    render(<StatusLegend />);
    fireEvent.click(screen.getByRole("button", { name: "Status legend" }));
    expect(screen.queryByRole("dialog")).toBeTruthy();
    // A mousedown outside the trigger AND outside the popover dismisses.
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does NOT close on a mousedown inside the popover", () => {
    render(<StatusLegend />);
    fireEvent.click(screen.getByRole("button", { name: "Status legend" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.mouseDown(dialog);
    expect(screen.queryByRole("dialog")).toBeTruthy();
  });

  it("closes on Escape and returns focus to the trigger", () => {
    render(<StatusLegend />);
    const trigger = screen.getByRole("button", { name: "Status legend" });
    fireEvent.click(trigger);
    expect(screen.queryByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("reflects open state on aria-expanded for screen readers", () => {
    render(<StatusLegend />);
    const trigger = screen.getByRole("button", { name: "Status legend" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });
});
