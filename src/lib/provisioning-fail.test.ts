import { describe, expect, it } from "vitest";
import { fail, ProvisioningFail } from "../../scripts/lib/provisioning-common.mjs";

describe("fail()", () => {
  it("throws so nested helpers can catch", () => {
    expect(() => fail("zone missing")).toThrow(ProvisioningFail);
    try {
      fail("zone missing");
    } catch (e) {
      expect(e).toBeInstanceOf(ProvisioningFail);
      expect((e as Error).message).toBe("zone missing");
    }
  });
});
