import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";

import type { SearchMatch, SearchResponse } from "../types";
import { SearchModal } from "./SearchModal";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mockSearchResponse(matches: SearchMatch[]): SearchResponse {
  return { query: "needle", matches };
}

function mockFetch(response: SearchResponse) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => response,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function makeMatch(overrides: Partial<SearchMatch> = {}): SearchMatch {
  return {
    paneId: "%1",
    session: "main",
    windowName: "shell",
    windowIndex: 0,
    lineNumber: 1,
    context: ["above", "the match", "below"],
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

describe("SearchModal", () => {
  it("does not fire a fetch until the user has typed something", async () => {
    const fetchMock = mockFetch(mockSearchResponse([]));
    render(<SearchModal onClose={() => {}} onOpenMatch={() => {}} />);

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("debounces typing — only the last value triggers a fetch", async () => {
    const fetchMock = mockFetch(mockSearchResponse([]));
    const { container } = render(
      <SearchModal onClose={() => {}} onOpenMatch={() => {}} />,
    );
    const input = container.querySelector<HTMLInputElement>("input")!;

    fireEvent.change(input, { target: { value: "f" } });
    fireEvent.change(input, { target: { value: "fo" } });
    fireEvent.change(input, { target: { value: "foo" } });

    // Within the 200 ms debounce window — still no fetch.
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();

    // After the debounce — exactly one fetch with the LAST value.
    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("q=foo");
  });

  it("renders result rows from the API response", async () => {
    mockFetch(
      mockSearchResponse([
        makeMatch({
          paneId: "%1",
          session: "main",
          windowName: "shell",
          windowIndex: 0,
          lineNumber: 12,
          context: ["", "error: boom", "stack trace"],
        }),
      ]),
    );

    const { container } = render(
      <SearchModal onClose={() => {}} onOpenMatch={() => {}} />,
    );
    fireEvent.change(container.querySelector("input")!, {
      target: { value: "error" },
    });

    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
      await Promise.resolve();
    });

    const rows = container.querySelectorAll(".search-result");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("main");
    expect(rows[0].textContent).toContain("shell");
    expect(rows[0].textContent).toContain("12");
    expect(rows[0].textContent).toContain("error: boom");
  });

  it("clicking a result fires onOpenMatch with the match's pane id", async () => {
    mockFetch(mockSearchResponse([makeMatch({ paneId: "%9" })]));
    const onOpenMatch = vi.fn();
    const { container } = render(
      <SearchModal onClose={() => {}} onOpenMatch={onOpenMatch} />,
    );
    fireEvent.change(container.querySelector("input")!, {
      target: { value: "anything" },
    });
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
      await Promise.resolve();
    });
    fireEvent.click(container.querySelector(".search-result")!);
    expect(onOpenMatch).toHaveBeenCalledWith("%9");
  });

  it("clears state when the input goes back to empty", async () => {
    mockFetch(mockSearchResponse([makeMatch()]));
    const { container } = render(
      <SearchModal onClose={() => {}} onOpenMatch={() => {}} />,
    );
    const input = container.querySelector<HTMLInputElement>("input")!;

    fireEvent.change(input, { target: { value: "x" } });
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelectorAll(".search-result")).toHaveLength(1);

    fireEvent.change(input, { target: { value: "" } });
    await act(async () => {
      vi.advanceTimersByTime(250);
      await Promise.resolve();
    });
    expect(container.querySelectorAll(".search-result")).toHaveLength(0);
  });
});
