import { describe, expect, it } from "vitest";
import { randomToken, sha256Hex, timingSafeEqual } from "../src/lib/crypto";

describe("randomToken", () => {
  it("produces URL-safe strings of the expected size", () => {
    const token = randomToken(32);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(42);
  });

  it("produces distinct values", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => randomToken(16)));
    expect(tokens.size).toBe(50);
  });
});

describe("sha256Hex", () => {
  it("matches a known SHA-256 vector", async () => {
    await expect(sha256Hex("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("timingSafeEqual", () => {
  it("compares equal and unequal strings", () => {
    expect(timingSafeEqual("same-value", "same-value")).toBe(true);
    expect(timingSafeEqual("same-value", "same-valuf")).toBe(false);
    expect(timingSafeEqual("short", "longer")).toBe(false);
  });
});
