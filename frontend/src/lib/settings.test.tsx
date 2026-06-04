import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { useEffect } from "react";

import { DEFAULT_SETTINGS, updateSettings, useSetting, useSettings } from "./settings";

afterEach(() => {
  // Reset settings so prior-test mutations don't leak.
  updateSettings(DEFAULT_SETTINGS);
  cleanup();
});

function RenderCounter(props: { onRender: () => void }) {
  // Increment per commit. useEffect with no deps runs once per commit.
  useEffect(() => {
    props.onRender();
  });
  return null;
}

describe("useSetting (THI-186)", () => {
  it("returns the current value for the selected key", () => {
    let value: string | null = null;
    function Probe() {
      value = useSetting("theme");
      return null;
    }
    render(<Probe />);
    expect(value).toBe(DEFAULT_SETTINGS.theme);
  });

  it("re-renders only when the selected key changes", () => {
    let renders = 0;
    function Probe() {
      useSetting("theme");
      return <RenderCounter onRender={() => renders++} />;
    }
    render(<Probe />);
    const baseline = renders;

    // Unrelated update — must NOT re-render a `theme` subscriber.
    act(() => {
      updateSettings({ pollIntervalMs: 12345 });
    });
    expect(renders).toBe(baseline);

    // Related update — MUST re-render.
    act(() => {
      updateSettings({ theme: "light" });
    });
    expect(renders).toBe(baseline + 1);
  });

  it("does not re-render when the selected key is patched with the same value", () => {
    let renders = 0;
    function Probe() {
      useSetting("theme");
      return <RenderCounter onRender={() => renders++} />;
    }
    render(<Probe />);
    const baseline = renders;

    // Patch theme with its current value — Object.is short-circuits, no
    // re-render expected.
    act(() => {
      updateSettings({ theme: DEFAULT_SETTINGS.theme });
    });
    expect(renders).toBe(baseline);
  });

  it("two subscribers to different keys stay independent", () => {
    let themeRenders = 0;
    let pollRenders = 0;
    function ThemeProbe() {
      useSetting("theme");
      return <RenderCounter onRender={() => themeRenders++} />;
    }
    function PollProbe() {
      useSetting("pollIntervalMs");
      return <RenderCounter onRender={() => pollRenders++} />;
    }
    render(
      <>
        <ThemeProbe />
        <PollProbe />
      </>,
    );
    const themeBaseline = themeRenders;
    const pollBaseline = pollRenders;

    act(() => {
      updateSettings({ pollIntervalMs: 5000 });
    });
    expect(themeRenders).toBe(themeBaseline);
    expect(pollRenders).toBe(pollBaseline + 1);

    act(() => {
      updateSettings({ theme: "light" });
    });
    expect(themeRenders).toBe(themeBaseline + 1);
    expect(pollRenders).toBe(pollBaseline + 1);
  });
});

describe("useSettings backward compat", () => {
  it("still returns the full Settings object and re-renders on any change", () => {
    let renders = 0;
    let snapshot: ReturnType<typeof useSettings> | null = null;
    function Probe() {
      snapshot = useSettings();
      return <RenderCounter onRender={() => renders++} />;
    }
    render(<Probe />);
    const baseline = renders;
    expect(snapshot).not.toBeNull();
    expect(snapshot!.theme).toBe(DEFAULT_SETTINGS.theme);

    act(() => {
      updateSettings({ pollIntervalMs: 9999 });
    });
    // Existing broadcast behavior preserved for callers that haven't migrated.
    expect(renders).toBe(baseline + 1);
    expect(snapshot!.pollIntervalMs).toBe(9999);
  });
});
