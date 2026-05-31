/** Unit tests for the pure resource-watch coalescing precedence. */

import { ResourceChangeType } from "@grackle-ai/ahp";
import { describe, expect, it } from "vitest";

import { coalesceChangeType, COALESCE_DROP } from "./resource-watch-coalesce.js";

const { Added, Updated, Deleted } = ResourceChangeType;

describe("coalesceChangeType", () => {
  it("uses the incoming type when nothing is pending", () => {
    expect(coalesceChangeType(undefined, Added)).toBe(Added);
    expect(coalesceChangeType(undefined, Updated)).toBe(Updated);
    expect(coalesceChangeType(undefined, Deleted)).toBe(Deleted);
  });

  it("keeps Added when a change arrives after an add (file not yet announced)", () => {
    expect(coalesceChangeType(Added, Updated)).toBe(Added);
  });

  it("drops the entry when a delete arrives after an add (net no-op)", () => {
    expect(coalesceChangeType(Added, Deleted)).toBe(COALESCE_DROP);
  });

  it("keeps Added when an add follows an add", () => {
    expect(coalesceChangeType(Added, Added)).toBe(Added);
  });

  it("lets the latest win for change→change, change→delete", () => {
    expect(coalesceChangeType(Updated, Updated)).toBe(Updated);
    expect(coalesceChangeType(Updated, Deleted)).toBe(Deleted);
  });

  it("lets the latest win when an add or update follows other prior states", () => {
    // delete→add (recreated within window) and update→add both take the latest.
    expect(coalesceChangeType(Deleted, Added)).toBe(Added);
    expect(coalesceChangeType(Updated, Added)).toBe(Added);
    // change after a (non-add) prior also takes the latest.
    expect(coalesceChangeType(Deleted, Updated)).toBe(Updated);
  });
});
