import "server-only";

import { prisma } from "@/server/prisma";
import { createPrismaWorldModelStore } from "@/server/services/prisma-store";
import { createWorldModelServices } from "@/server/services/world-model-services";

export function getWorldModelServices() {
  return createWorldModelServices(createPrismaWorldModelStore(prisma));
}
