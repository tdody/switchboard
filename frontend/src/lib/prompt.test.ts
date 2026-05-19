import { describe, expect, it } from "vitest";
import { arrowSteps, parsePromptMessage } from "./prompt";

describe("parsePromptMessage", () => {
  it("returns undefined for plain terminal output", () => {
    expect(parsePromptMessage("$ ls -la\r\n")).toBeUndefined();
  });

  it("returns undefined for JSON that is not a prompt control message", () => {
    expect(parsePromptMessage('{"type":"other"}')).toBeUndefined();
  });

  it("returns undefined for malformed JSON", () => {
    expect(parsePromptMessage('{"type":"prompt"')).toBeUndefined();
  });

  it("returns null when the prompt is cleared", () => {
    expect(parsePromptMessage('{"type":"prompt","prompt":null}')).toBeNull();
  });

  it("returns the Prompt when one is active", () => {
    const raw = JSON.stringify({
      type: "prompt",
      prompt: {
        kind: "menu",
        question: "Proceed?",
        choices: [{ index: 1, label: "Yes", selected: true }],
      },
    });
    const prompt = parsePromptMessage(raw);
    expect(prompt).not.toBeNull();
    expect(prompt).not.toBeUndefined();
    expect(prompt!.kind).toBe("menu");
    expect(prompt!.choices[0].label).toBe("Yes");
  });
});

describe("arrowSteps", () => {
  it("steps Down when the target is below", () => {
    expect(arrowSteps(0, 2)).toEqual(["Down", "Down"]);
  });

  it("steps Up when the target is above", () => {
    expect(arrowSteps(2, 0)).toEqual(["Up", "Up"]);
  });

  it("is a no-op when already on the target", () => {
    expect(arrowSteps(1, 1)).toEqual([]);
  });

  it("is a no-op when the source position is unknown", () => {
    expect(arrowSteps(-1, 2)).toEqual([]);
  });
});
