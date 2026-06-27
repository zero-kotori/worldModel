import { prismaMigrateArgs } from "../../scripts/prisma-migrate";

describe("Prisma migration wrapper", () => {
  it("defaults to deploy migrations", () => {
    expect(prismaMigrateArgs(["node", "scripts/prisma-migrate.ts"])).toEqual(["migrate", "deploy"]);
  });

  it("passes through the dev migration mode", () => {
    expect(prismaMigrateArgs(["node", "scripts/prisma-migrate.ts", "dev"])).toEqual(["migrate", "dev"]);
  });
});
