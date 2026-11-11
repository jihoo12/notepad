import { describe, expect, it } from "vitest";
import {
  LIMITS,
  normalizeSearchQuery,
  parseNoteCreate,
  parseNotePatch,
} from "../src/lib/validation";

describe("parseNoteCreate", () => {
  it("applies empty defaults", () => {
    expect(parseNoteCreate({})).toEqual({
      ok: true,
      value: { title: "", content: "" },
    });
  });

  it("accepts valid title and content", () => {
    const result = parseNoteCreate({ title: "할 일", content: "첫 번째 메모" });
    expect(result).toEqual({
      ok: true,
      value: { title: "할 일", content: "첫 번째 메모" },
    });
  });

  it("allows exactly the maximum lengths", () => {
    const result = parseNoteCreate({
      title: "a".repeat(LIMITS.title),
      content: "b".repeat(LIMITS.content),
    });
    expect(result.ok).toBe(true);
  });

  it("rejects titles over the limit", () => {
    const result = parseNoteCreate({ title: "a".repeat(LIMITS.title + 1) });
    expect(result).toMatchObject({ ok: false, error: "title_too_long" });
  });

  it("rejects content over the limit", () => {
    const result = parseNoteCreate({ content: "b".repeat(LIMITS.content + 1) });
    expect(result).toMatchObject({ ok: false, error: "content_too_long" });
  });

  it("rejects non-object bodies", () => {
    expect(parseNoteCreate(null)).toMatchObject({ ok: false, error: "invalid_body" });
    expect(parseNoteCreate([])).toMatchObject({ ok: false, error: "invalid_body" });
    expect(parseNoteCreate("hello")).toMatchObject({ ok: false, error: "invalid_body" });
  });

  it("rejects non-string fields", () => {
    expect(parseNoteCreate({ title: 1 })).toMatchObject({
      ok: false,
      error: "invalid_title",
    });
    expect(parseNoteCreate({ content: false })).toMatchObject({
      ok: false,
      error: "invalid_content",
    });
  });
});

describe("parseNotePatch", () => {
  it("accepts partial updates", () => {
    expect(parseNotePatch({ pinned: true })).toEqual({
      ok: true,
      value: { pinned: true },
    });
    expect(parseNotePatch({ title: "새 제목", content: "내용" })).toEqual({
      ok: true,
      value: { title: "새 제목", content: "내용" },
    });
  });

  it("rejects empty or unknown-only patches", () => {
    expect(parseNotePatch({})).toMatchObject({ ok: false, error: "empty_patch" });
    expect(parseNotePatch({ unknown: 1 })).toMatchObject({
      ok: false,
      error: "empty_patch",
    });
  });

  it("rejects a non-boolean pinned value", () => {
    expect(parseNotePatch({ pinned: 1 })).toMatchObject({
      ok: false,
      error: "invalid_pinned",
    });
  });

  it("still validates lengths in patches", () => {
    expect(parseNotePatch({ title: "a".repeat(LIMITS.title + 1) })).toMatchObject({
      ok: false,
      error: "title_too_long",
    });
  });
});

describe("normalizeSearchQuery", () => {
  it("trims and caps search input", () => {
    expect(normalizeSearchQuery("  메모  ")).toBe("메모");
    expect(normalizeSearchQuery(undefined)).toBe("");
    expect(normalizeSearchQuery("a".repeat(200))).toHaveLength(LIMITS.search);
  });
});
