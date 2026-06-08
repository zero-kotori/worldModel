import { createReadableCodes, readableCode } from "@/lib/world-model-display";

describe("world model readable codes", () => {
  it("assigns stable short codes by creation time", () => {
    const records = [
      { id: "hypothesis_late", createdAt: new Date("2026-06-08T10:00:00.000Z") },
      { id: "hypothesis_early", createdAt: new Date("2026-06-08T09:00:00.000Z") }
    ];

    const codes = createReadableCodes(records, "H", (record) => record.createdAt);

    expect(readableCode(codes, "hypothesis_early", "H")).toBe("H-001");
    expect(readableCode(codes, "hypothesis_late", "H")).toBe("H-002");
    expect(readableCode(codes, "missing", "H")).toBe("H-?");
  });
});
