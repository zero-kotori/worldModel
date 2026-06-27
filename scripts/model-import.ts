import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { createPrismaWorldModelStore } from "@/server/services/prisma-store";
import { createWorldModelServices } from "@/server/services/world-model-services";
import {
  modelArtifactImportInput,
  readModelArtifactImportInput,
  resolveModelArtifactPath
} from "@/server/training/model-artifact-import";

config({ path: ".env.local" });
config();

export { modelArtifactImportInput, readModelArtifactImportInput, resolveModelArtifactPath };

export async function runModelImportCommand(artifactPath = process.argv[2] ?? path.join(process.cwd(), "model-artifacts", "lightweight-local.json")) {
  const resolvedPath = resolveModelArtifactPath(artifactPath);
  if (!existsSync(resolvedPath)) {
    return {
      imported: false,
      path: artifactPath,
      message: "Model artifact path does not exist yet; provide a local artifact path to register it."
    };
  }

  const prisma = new PrismaClient();
  try {
    const services = createWorldModelServices(createPrismaWorldModelStore(prisma));
    const record = await services.models.importArtifact(await readModelArtifactImportInput(resolvedPath));
    return { imported: true, artifact: record };
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const result = await runModelImportCommand();
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
