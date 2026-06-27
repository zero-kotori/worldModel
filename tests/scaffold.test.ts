import { existsSync, readFileSync } from "node:fs";

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

  it("declares a browser icon asset so local checks do not request a missing favicon", () => {
    const layout = readFileSync("src/app/layout.tsx", "utf8");

    expect(layout).toContain('icon: "/favicon.svg"');
    expect(existsSync("public/favicon.svg")).toBe(true);
  });

  it("runs Prisma migrations through the local environment loader", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["prisma:migrate"]).toBe("tsx scripts/prisma-migrate.ts deploy");
    expect(packageJson.scripts["prisma:dev"]).toBe("tsx scripts/prisma-migrate.ts dev");
    expect(existsSync("scripts/prisma-migrate.ts")).toBe(true);
  });

  it("exposes a persisted-config automation worker command", () => {
    const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts["observe:worker"]).toBe("tsx scripts/observe.ts --loop --repeat --use-worker-config");
  });
});
