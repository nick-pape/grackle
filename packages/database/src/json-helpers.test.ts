import { describe, it, expect } from "vitest";

import { safeParseJsonArray } from "./json-helpers.js";

describe("safeParseJsonArray", () => {
  describe("falsy / empty input", () => {
    it("returns [] for undefined", () => {
      expect(safeParseJsonArray(undefined)).toEqual([]);
    });

    it("returns [] for null", () => {
      expect(safeParseJsonArray(null)).toEqual([]);
    });

    it("returns [] for empty string", () => {
      expect(safeParseJsonArray("")).toEqual([]);
    });
  });

  describe("malformed JSON", () => {
    it("returns [] for a truncated array literal", () => {
      expect(safeParseJsonArray("[not json")).toEqual([]);
    });

    it("returns [] for a bad object literal", () => {
      expect(safeParseJsonArray("{bad}")).toEqual([]);
    });

    it("returns [] for a bare word", () => {
      expect(safeParseJsonArray("hello")).toEqual([]);
    });
  });

  describe("valid JSON that is not an array", () => {
    it("returns [] for a JSON object", () => {
      expect(safeParseJsonArray('{"a":1}')).toEqual([]);
    });

    it("returns [] for a JSON number", () => {
      expect(safeParseJsonArray("42")).toEqual([]);
    });

    it("returns [] for a JSON string", () => {
      expect(safeParseJsonArray('"hello"')).toEqual([]);
    });

    it("returns [] for JSON null", () => {
      expect(safeParseJsonArray("null")).toEqual([]);
    });

    it("returns [] for JSON boolean", () => {
      expect(safeParseJsonArray("true")).toEqual([]);
    });
  });

  describe("valid string arrays", () => {
    it("returns [] for an empty array", () => {
      expect(safeParseJsonArray("[]")).toEqual([]);
    });

    it("returns the strings for a valid string array", () => {
      expect(safeParseJsonArray('["a","b","c"]')).toEqual(["a", "b", "c"]);
    });

    it("returns a single-element array", () => {
      expect(safeParseJsonArray('["task-1"]')).toEqual(["task-1"]);
    });
  });

  describe("mixed-type arrays", () => {
    it("filters out non-string elements, keeping only strings", () => {
      expect(safeParseJsonArray('["a",1,null,true,"b"]')).toEqual(["a", "b"]);
    });

    it("returns [] when no elements are strings", () => {
      expect(safeParseJsonArray("[1,2,3]")).toEqual([]);
    });
  });
});
