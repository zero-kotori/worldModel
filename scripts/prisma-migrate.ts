import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { config } from "dotenv";

config({ path: ".env.local" });
config();

export function prismaMigrateArgs(argv = process.argv) {
  const command = argv[2] === "dev" ? "dev" : "deploy";
  return ["migrate", command];
}

function main() {
  const prismaCli = path.join(process.cwd(), "node_modules", "prisma", "build", "index.js");
  const result = spawnSync(process.execPath, [prismaCli, ...prismaMigrateArgs()], {
    stdio: "inherit",
    env: process.env
  });

  if (result.error) {
    throw result.error;
  }
  process.exit(result.status ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
