import { describe, expect, it } from "vitest";
import { buildRepoSecuritySummary } from "../../src/utils/security";

describe("security utilities", () => {
  it("summarizes dependabot and code scanning alerts", () => {
    const summary = buildRepoSecuritySummary({
      dependabotAlerts: [
        { updated_at: "2026-04-21T10:00:00Z" },
        { updatedAt: "2026-04-23T08:00:00Z" },
      ],
      codeScanningAlerts: [
        { updated_at: "2026-04-20T10:00:00Z" },
      ],
    });

    expect(summary.dependabotOpen).toBe(2);
    expect(summary.codeScanningOpen).toBe(1);
    expect(summary.totalOpen).toBe(3);
    expect(summary.latestUpdatedAt).toBe("2026-04-23T08:00:00Z");
    expect(summary.unavailable).toBe(false);
  });

  it("preserves an unavailable flag when alert sources cannot be loaded", () => {
    const summary = buildRepoSecuritySummary({
      dependabotAlerts: [],
      codeScanningAlerts: [],
      unavailable: true,
    });

    expect(summary.totalOpen).toBe(0);
    expect(summary.unavailable).toBe(true);
  });
});
