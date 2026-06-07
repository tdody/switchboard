import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { updateSettings } from "../lib/settings";
import type { FilterPreset } from "../lib/usePresets";
import { Subhead } from "./Subhead";

afterEach(() => {
  cleanup();
  // Reset the module-level settings singleton so layout=grid set inside one
  // test can't leak into the next file (these settings tests mutate a global).
  updateSettings({ layout: "kanban" });
});

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

describe("Subhead layout hint (THI-61)", () => {
  it("renders no hint when no visibleCount is provided", () => {
    const { container } = render(<Subhead {...baseProps} />);
    expect(container.querySelector(".layout-hint")).toBeNull();
  });

  it("suggests grid when on kanban with a status filter and few cards", () => {
    const { container } = render(
      <Subhead {...baseProps} filter="waiting" visibleCount={3} />,
    );
    const hint = container.querySelector<HTMLButtonElement>(".layout-hint");
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toMatch(/grid/i);
  });

  it("suggests list when on kanban with many cards", () => {
    const { container } = render(
      <Subhead {...baseProps} filter="all" visibleCount={25} />,
    );
    const hint = container.querySelector<HTMLButtonElement>(".layout-hint");
    expect(hint).not.toBeNull();
    expect(hint!.textContent).toMatch(/list/i);
  });

  it("clicking the hint flips the layout to the suggested one", () => {
    const { container } = render(
      <Subhead {...baseProps} filter="all" visibleCount={25} />,
    );
    fireEvent.click(container.querySelector(".layout-hint")!);
    expect(JSON.parse(localStorage.getItem("switchboard:settings")!).layout).toBe(
      "list",
    );
  });

  it("renders no hint when the current layout already fits", () => {
    const { container } = render(
      <Subhead {...baseProps} filter="all" visibleCount={10} />,
    );
    expect(container.querySelector(".layout-hint")).toBeNull();
  });
});

describe("Subhead memoization (THI-217)", () => {
  it("is wrapped in React.memo so stable parent props short-circuit the render", () => {
    // Memoized components carry the react.memo $$typeof tag. This proves the
    // wrap is in place; the per-keystroke perf benefit relies on the parent
    // (App.tsx) passing referentially stable callbacks, verified separately.
    const tag = (Subhead as unknown as { $$typeof: symbol }).$$typeof;
    expect(tag).toBe(Symbol.for("react.memo"));
  });

  it("tab buttons still wire onSelect through the hoisted Tab component", () => {
    // Tab was previously declared inside Subhead's body; hoisting it changed
    // its prop shape from closure-captured `setFilter` to an explicit
    // `onSelect` prop. This smoke test confirms the rewire didn't break the
    // status-filter click path that the existing arrow-nav + keyboard
    // shortcut tests depend on.
    const setFilter = vi.fn();
    const { container } = render(
      <Subhead {...baseProps} setFilter={setFilter} />,
    );
    const tabs = container.querySelectorAll<HTMLButtonElement>(
      ".subhead > span:nth-of-type(1) .tab",
    );
    expect(tabs).toHaveLength(4);
    fireEvent.click(tabs[1]!); // "Waiting" tab
    expect(setFilter).toHaveBeenCalledWith("waiting");
  });
});

describe("Subhead grouping switcher (THI-243)", () => {
  it("renders both Sessions and Repos buttons, with Sessions active by default", () => {
    localStorage.clear();
    const { container } = render(<Subhead {...baseProps} />);
    const buttons = container.querySelectorAll<HTMLButtonElement>(
      ".grouping-switcher button",
    );
    expect(buttons).toHaveLength(2);
    expect(buttons[0]!.textContent).toBe("Sessions");
    expect(buttons[1]!.textContent).toBe("Repos");
    expect(buttons[0]!.className).toContain("is-active");
    expect(buttons[1]!.className).not.toContain("is-active");
  });

  it("clicking Repos flips the active state and persists groupingMode", () => {
    localStorage.clear();
    const { container } = render(<Subhead {...baseProps} />);
    const buttons = container.querySelectorAll<HTMLButtonElement>(
      ".grouping-switcher button",
    );
    fireEvent.click(buttons[1]!);
    const after = container.querySelectorAll<HTMLButtonElement>(
      ".grouping-switcher button",
    );
    expect(after[0]!.className).not.toContain("is-active");
    expect(after[1]!.className).toContain("is-active");
    expect(
      JSON.parse(localStorage.getItem("switchboard:settings")!).groupingMode,
    ).toBe("repos");
  });
});

describe("Subhead layout switcher (THI-59)", () => {
  it("kanban and grid buttons are both enabled; only the active one has is-active", () => {
    localStorage.clear();
    const { container } = render(<Subhead {...baseProps} />);
    const buttons = container.querySelectorAll<HTMLButtonElement>(
      ".layout-switcher button",
    );
    expect(buttons).toHaveLength(3); // kanban, grid, list
    const [kanban, grid, list] = buttons;
    expect(kanban.disabled).toBe(false);
    expect(grid.disabled).toBe(false);
    expect(list.disabled).toBe(false);
    // Default layout is kanban — only the kanban button has the active class.
    expect(kanban.className).toContain("is-active");
    expect(grid.className).not.toContain("is-active");
  });

  it("clicking the grid button flips the active state to grid", () => {
    localStorage.clear();
    const { container } = render(<Subhead {...baseProps} />);
    const buttons = container.querySelectorAll<HTMLButtonElement>(
      ".layout-switcher button",
    );
    fireEvent.click(buttons[1]); // grid
    const updated = container.querySelectorAll<HTMLButtonElement>(
      ".layout-switcher button",
    );
    expect(updated[0].className).not.toContain("is-active"); // kanban
    expect(updated[1].className).toContain("is-active"); // grid
    // And the setting actually persisted.
    expect(JSON.parse(localStorage.getItem("switchboard:settings")!).layout).toBe(
      "grid",
    );
  });
});
