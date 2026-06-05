import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";

import type { TemplatesResponse } from "../types";
import { TemplatesModal } from "./TemplatesModal";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TWO_TEMPLATES: TemplatesResponse = {
  templates: [
    {
      name: "web-project",
      windowCount: 4,
      variables: ["REPO_NAME", "REPO_PATH"],
    },
    {
      name: "agent-grid",
      windowCount: 4,
      variables: ["CWD", "SESSION"],
    },
  ],
};

function mockFetch(
  templatesBody: TemplatesResponse,
  instantiateResult: { ok: boolean; session: string } | "fail" = {
    ok: true,
    session: "demo",
  },
) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.endsWith("/api/templates")) {
      return { ok: true, json: async () => templatesBody };
    }
    if (url.endsWith("/api/templates/instantiate")) {
      if (instantiateResult === "fail") {
        return { ok: false, json: async () => ({ detail: "boom" }) };
      }
      return { ok: true, json: async () => instantiateResult };
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  document.cookie = "sb_csrf=tok-test";
});

describe("TemplatesModal", () => {
  it("loads and lists every available template on mount", async () => {
    mockFetch(TWO_TEMPLATES);
    const { container } = render(
      <TemplatesModal onClose={() => {}} onApplied={() => {}} />,
    );
    await settle();

    const rows = container.querySelectorAll<HTMLButtonElement>(".template-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("web-project");
    expect(rows[0].textContent).toContain("4");
    expect(rows[1].textContent).toContain("agent-grid");
  });

  it("clicking a template surfaces a variable form with one input per var", async () => {
    mockFetch(TWO_TEMPLATES);
    const { container } = render(
      <TemplatesModal onClose={() => {}} onApplied={() => {}} />,
    );
    await settle();
    fireEvent.click(container.querySelectorAll(".template-row")[0]);

    const inputs = Array.from(
      container.querySelectorAll<HTMLInputElement>(
        ".template-var-row input",
      ),
    );
    const names = inputs.map((i) => i.name);
    expect(names).toEqual(["REPO_NAME", "REPO_PATH"]);
  });

  it("Create posts the chosen template + values and calls onApplied with the new session", async () => {
    const fetchMock = mockFetch(TWO_TEMPLATES, { ok: true, session: "switchboard" });
    const onApplied = vi.fn();
    const { container } = render(
      <TemplatesModal onClose={() => {}} onApplied={onApplied} />,
    );
    await settle();

    fireEvent.click(container.querySelectorAll(".template-row")[0]);
    const inputs = container.querySelectorAll<HTMLInputElement>(
      ".template-var-row input",
    );
    fireEvent.change(inputs[0], { target: { value: "switchboard" } });
    fireEvent.change(inputs[1], { target: { value: "/home/me/repo" } });

    fireEvent.click(
      container.querySelector<HTMLButtonElement>("button.template-create")!,
    );
    await settle();

    const instantiateCall = fetchMock.mock.calls.find(([url]) =>
      typeof url === "string" && url.endsWith("/api/templates/instantiate"),
    );
    expect(instantiateCall).toBeDefined();
    const body = JSON.parse((instantiateCall![1] as RequestInit).body as string);
    expect(body).toEqual({
      name: "web-project",
      variables: { REPO_NAME: "switchboard", REPO_PATH: "/home/me/repo" },
    });
    expect(onApplied).toHaveBeenCalledWith("switchboard");
  });

  it("Back button returns from the variable form to the template list", async () => {
    mockFetch(TWO_TEMPLATES);
    const { container } = render(
      <TemplatesModal onClose={() => {}} onApplied={() => {}} />,
    );
    await settle();

    fireEvent.click(container.querySelectorAll(".template-row")[0]);
    expect(
      container.querySelectorAll(".template-var-row input").length,
    ).toBeGreaterThan(0);

    fireEvent.click(container.querySelector<HTMLButtonElement>("button.template-back")!);
    expect(container.querySelectorAll(".template-row")).toHaveLength(2);
  });

  it("shows an error message when instantiate fails (does not auto-close)", async () => {
    mockFetch(TWO_TEMPLATES, "fail");
    const onApplied = vi.fn();
    const { container } = render(
      <TemplatesModal onClose={() => {}} onApplied={onApplied} />,
    );
    await settle();
    fireEvent.click(container.querySelectorAll(".template-row")[0]);
    fireEvent.click(
      container.querySelector<HTMLButtonElement>("button.template-create")!,
    );
    await settle();

    expect(onApplied).not.toHaveBeenCalled();
    expect(container.querySelector(".template-error")).not.toBeNull();
  });
});
