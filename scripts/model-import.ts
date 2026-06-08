import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { createPrismaWorldModelStore } from "@/server/services/prisma-store";
import { createWorldModelServices } from "@/server/services/world-model-services";

config({ path: ".env.local" });
config();

const artifactPath = process.argv[2] ?? path.join(process.cwd(), "model-artifacts", "lightweight-local.json");

if (!existsSync(artifactPath)) {
  console.log(
    JSON.stringify(
      {
        imported: false,
        path: artifactPath,
        message: "Model artifact path does not exist yet; provide a local artifact path to register it."
      },
      null,
      2
    )
  );
  process.exit(0);
}

async function main() {
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as {
    name?: string;
    kind?: "LIGHTWEIGHT" | "LLM" | "DEEP_ADAPTER";
    version?: string;
    metrics?: Record<string, unknown>;
  };
  const prisma = new PrismaClient();
  try {
    const services = createWorldModelServices(createPrismaWorldModelStore(prisma));
    const record = await services.models.importArtifact({
      name: artifact.name ?? path.basename(artifactPath, path.extname(artifactPath)),
      kind: artifact.kind ?? "LIGHTWEIGHT",
      version: artifact.version ?? "0.1.0",
      path: path.relative(process.cwd(), artifactPath).replaceAll("\\", "/"),
      metrics: artifact.metrics ?? {},
      enabled: true
    });
    console.log(JSON.stringify({ imported: true, artifact: record }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
