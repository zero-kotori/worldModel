import "server-only";

import { prisma } from "@/server/prisma";
import { createConfiguredWorldModelServices } from "@/server/services/configured";
import { createPrismaWorldModelStore } from "@/server/services/prisma-store";

export function getWorldModelServices() {
  return createConfiguredWorldModelServices(createPrismaWorldModelStore(prisma));
}
