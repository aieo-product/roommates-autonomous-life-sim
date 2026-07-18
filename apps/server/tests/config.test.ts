import { describe, expect, it } from "vitest";
import { defaultAppServerTimeoutMs } from "../src/config.js";

describe("App Server timeout defaults", () => {
  it("allows explicit App Server runs to finish while keeping auto fallback responsive", () => {
    expect(defaultAppServerTimeoutMs("app-server")).toBe(60_000);
    expect(defaultAppServerTimeoutMs("auto")).toBe(15_000);
    expect(defaultAppServerTimeoutMs("mock")).toBe(15_000);
  });
});
