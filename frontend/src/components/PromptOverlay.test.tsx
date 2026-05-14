import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Prompt } from "../lib/prompt";
import { PromptOverlay } from "./PromptOverlay";

afterEach(cleanup);

const menu: Prompt = {
  kind: "menu",
  question: "Do you want to proceed?",
  choices: [
    { index: 1, label: "Yes", selected: true },
    { index: 2, label: "No, stop", selected: false },
  ],
};

describe("PromptOverlay — menu", () => {
  it("renders the question and choices", () => {
    render(<PromptOverlay prompt={menu} send={vi.fn()} />);
    expect(screen.getByText("Do you want to proceed?")).toBeTruthy();
    expect(screen.getByText("Yes")).toBeTruthy();
    expect(screen.getByText("No, stop")).toBeTruthy();
  });

  it("forwards ArrowDown as an Up/Down signal frame", () => {
    const send = vi.fn();
    render(<PromptOverlay prompt={menu} send={send} />);
    fireEvent.keyDown(screen.getByRole("group"), { key: "ArrowDown" });
    expect(send).toHaveBeenCalledWith(JSON.stringify({ signal: "Down" }));
  });

  it("forwards Enter as an Enter signal frame", () => {
    const send = vi.fn();
    render(<PromptOverlay prompt={menu} send={send} />);
    fireEvent.keyDown(screen.getByRole("group"), { key: "Enter" });
    expect(send).toHaveBeenCalledWith(JSON.stringify({ signal: "Enter" }));
  });

  it("clicking a lower choice jumps with arrow signals but does not commit", () => {
    const send = vi.fn();
    render(<PromptOverlay prompt={menu} send={send} />);
    fireEvent.click(screen.getByText("No, stop"));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(JSON.stringify({ signal: "Down" }));
  });
});

describe("PromptOverlay — yn / enter", () => {
  it("yn sends a literal y / n", () => {
    const send = vi.fn();
    const yn: Prompt = { kind: "yn", question: "Investigate? (y/n)", choices: [] };
    render(<PromptOverlay prompt={yn} send={send} />);
    fireEvent.click(screen.getByText("Yes"));
    expect(send).toHaveBeenCalledWith("y");
    fireEvent.click(screen.getByText("No"));
    expect(send).toHaveBeenCalledWith("n");
  });

  it("enter sends an Enter signal frame", () => {
    const send = vi.fn();
    const enter: Prompt = { kind: "enter", question: "Press Enter", choices: [] };
    render(<PromptOverlay prompt={enter} send={send} />);
    fireEvent.click(screen.getByText("Continue"));
    expect(send).toHaveBeenCalledWith(JSON.stringify({ signal: "Enter" }));
  });
});
