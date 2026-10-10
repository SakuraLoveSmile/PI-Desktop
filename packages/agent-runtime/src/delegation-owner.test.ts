import { describe, expect, it } from "vitest";
import { nestedDelegationPermission } from "./delegation-owner.js";

describe("nested delegation permission", () => {
  it("preserves inherited authority and only permits stricter overrides", () => {
    expect(nestedDelegationPermission("ask", "auto")).toBe("ask");
    expect(nestedDelegationPermission("accept-edits", "auto")).toBe("accept-edits");
    expect(nestedDelegationPermission("auto", "ask")).toBe("ask");
    expect(nestedDelegationPermission("ask", "inherit")).toBe("ask");
    expect(nestedDelegationPermission("inherit", "auto")).toBe("inherit");
    expect(nestedDelegationPermission("inherit", "accept-edits")).toBe("inherit");
    expect(nestedDelegationPermission("inherit", "ask")).toBe("ask");
  });
});
