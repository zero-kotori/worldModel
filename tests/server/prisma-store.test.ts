import { createPrismaWorldModelStore } from "@/server/services/prisma-store";

describe("Prisma world model store", () => {
  it("exposes a store factory for the service layer", () => {
    expect(typeof createPrismaWorldModelStore).toBe("function");
  });
});
