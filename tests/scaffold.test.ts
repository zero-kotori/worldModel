import { readFileSync } from "node:fs";

describe("project scaffold", () => {
  it("keeps secrets out of committed environment files", () => {
    const gitignore = readFileSync(".gitignore", "utf8");

    expect(gitignore).toContain(".env");
    expect(gitignore).toContain(".env.local");
    expect(gitignore).toContain("*.token");
  });

  it("defines the independent world-model database schema", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf8");

    expect(schema).toContain('url      = env("WORLDMODEL_DATABASE_URL")');
    expect(schema).toContain("model Belief");
    expect(schema).toContain("model BayesianUpdateEvent");
    expect(schema).not.toContain('env("DATABASE_URL")');
  });
});
