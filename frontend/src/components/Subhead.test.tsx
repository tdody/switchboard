import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import type { FilterPreset } from "../lib/usePresets";
import { Subhead } from "./Subhead";

afterEach(() => cleanup());

const noopCounts = { all: 0, waiting: 0, running: 0, idle: 0 };

const baseProps = {
  filter: "all" as const,
  setFilter: vi.fn(),
  query: "",
  setQuery: vi.fn(),
  counts: noopCounts,
  kindFilter: "" as const,
  onChipClick: vi.fn(),
};

const sample: FilterPreset = {
  name: "Stuck",
  filter: "waiting",
  kind: "agent",
  query: "",
};

describe("Subhead presets (THI-98)", () => {
  it("renders a chip per saved preset", () => {
    const { container } = render(
      <Subhead
        {...baseProps}
        presets={[sample, { ...sample, name: "Dev" }]}
        onApplyPreset={vi.fn()}
        onSavePreset={vi.fn()}
        onDeletePreset={vi.fn()}
      />,
    );
    const chips = container.querySelectorAll(".preset-chip");
    expect(chips).toHaveLength(2);
    expect(chips[0].textContent).toContain("Stuck");
    expect(chips[1].textContent).toContain("Dev");
  });

  it("clicking a chip applies the preset", () => {
    const onApply = vi.fn();
    const { container } = render(
      <Subhead
        {...baseProps}
        presets={[sample]}
        onApplyPreset={onApply}
        onSavePreset={vi.fn()}
        onDeletePreset={vi.fn()}
      />,
    );
    fireEvent.click(container.querySelector(".preset-chip-apply")!);
    expect(onApply).toHaveBeenCalledWith(sample);
  });

  it("clicking the delete control deletes by name without firing apply", () => {
    const onApply = vi.fn();
    const onDelete = vi.fn();
    const { container } = render(
      <Subhead
        {...baseProps}
        presets={[sample]}
        onApplyPreset={onApply}
        onSavePreset={vi.fn()}
        onDeletePreset={onDelete}
      />,
    );
    fireEvent.click(container.querySelector(".preset-chip-x")!);
    expect(onDelete).toHaveBeenCalledWith("Stuck");
    expect(onApply).not.toHaveBeenCalled();
  });

  it("shows a Save button that calls onSavePreset with a name from prompt()", () => {
    const onSave = vi.fn();
    const promptMock = vi.fn(() => "My filter");
    vi.stubGlobal("prompt", promptMock);
    const { container } = render(
      <Subhead
        {...baseProps}
        filter="waiting"
        kindFilter="agent"
        query="branch:x"
        presets={[]}
        onApplyPreset={vi.fn()}
        onSavePreset={onSave}
        onDeletePreset={vi.fn()}
      />,
    );
    fireEvent.click(container.querySelector(".preset-save")!);
    expect(onSave).toHaveBeenCalledWith({
      name: "My filter",
      filter: "waiting",
      kind: "agent",
      query: "branch:x",
    });
    vi.unstubAllGlobals();
  });

  it("does not call onSavePreset when the user cancels the prompt", () => {
    const onSave = vi.fn();
    const promptMock = vi.fn(() => null);
    vi.stubGlobal("prompt", promptMock);
    const { container } = render(
      <Subhead
        {...baseProps}
        presets={[]}
        onApplyPreset={vi.fn()}
        onSavePreset={onSave}
        onDeletePreset={vi.fn()}
      />,
    );
    fireEvent.click(container.querySelector(".preset-save")!);
    expect(onSave).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("trims whitespace from the entered name and skips empty names", () => {
    const onSave = vi.fn();
    const promptMock = vi.fn(() => "   ");
    vi.stubGlobal("prompt", promptMock);
    const { container } = render(
      <Subhead
        {...baseProps}
        presets={[]}
        onApplyPreset={vi.fn()}
        onSavePreset={onSave}
        onDeletePreset={vi.fn()}
      />,
    );
    fireEvent.click(container.querySelector(".preset-save")!);
    expect(onSave).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("renders neither chips nor save button when preset props are omitted", () => {
    const { container } = render(<Subhead {...baseProps} />);
    expect(container.querySelector(".preset-chip")).toBeNull();
    expect(container.querySelector(".preset-save")).toBeNull();
  });
});
