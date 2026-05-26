import { describe, expect, it } from "vitest";
import { contextBand } from "./status";

describe("contextBand", () => {
  // Spec table (THI-131): the four bands pivot at 50 / 75 / 90, with null/undef
  // mapped to the empty string so the WindowCard can compose the class
  // conditionally without an extra guard.
  it("returns empty string for null and undefined", () => {
    expect(contextBand(null)).toBe("");
    expect(contextBand(undefined)).toBe("");
  });

  it.each([
    [0, "ctx-low"],
    [49, "ctx-low"],
  ])("maps %i to ctx-low (< 50)", (input, expected) => {
    expect(contextBand(input)).toBe(expected);
  });

  it.each([
    [50, "ctx-mid"],
    [74, "ctx-mid"],
  ])("maps %i to ctx-mid (50..74)", (input, expected) => {
    expect(contextBand(input)).toBe(expected);
  });

  it.each([
    [75, "ctx-high"],
    [89, "ctx-high"],
  ])("maps %i to ctx-high (75..89)", (input, expected) => {
    expect(contextBand(input)).toBe(expected);
  });

  it.each([
    [90, "ctx-crit"],
    [100, "ctx-crit"],
  ])("maps %i to ctx-crit (>= 90)", (input, expected) => {
    expect(contextBand(input)).toBe(expected);
  });
});
