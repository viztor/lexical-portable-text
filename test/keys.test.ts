import { describe, expect, it } from "vitest";

import { randomKey } from "../src/index.js";

describe("randomKey", () => {
  it("returns a 12-character lowercase base-36 key", () => {
    const key = randomKey();
    expect(key).toMatch(/^[a-z0-9]{12}$/);
  });

  it("generates unique keys across a large sample", () => {
    const keys = new Set<string>();
    for (let i = 0; i < 5000; i += 1) keys.add(randomKey());
    expect(keys.size).toBe(5000);
  });
});
