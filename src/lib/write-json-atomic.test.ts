import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeJsonAtomic } from "./write-json-atomic";

describe("writeJsonAtomic", () => {
  it("roundtrips JSON through rename", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "qadbak-atomic-"));
    const file = path.join(dir, "users.json");
    try {
      await writeJsonAtomic(file, { ok: true, n: 1 }, 0o600);
      const parsed = JSON.parse(await readFile(file, "utf8")) as { ok: boolean; n: number };
      expect(parsed).toEqual({ ok: true, n: 1 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
