import { createRecordId } from "@/server/services/in-memory-store";
import { artifactSchema } from "@/server/services/internal/schemas";
import { assertImportableModelArtifact } from "@/server/services/internal/model-artifact";
import { now } from "@/server/services/internal/shared";
import type { WorldModelServiceContext } from "@/server/services/internal/service-context";
import type { ImportArtifactInput, WorldModelServices } from "@/server/services/types";

export function createModelService(context: WorldModelServiceContext): WorldModelServices["models"] {
  const { store } = context;

  return {
    listArtifacts() {
      return store.listModelArtifacts();
    },
    async importArtifact(input: ImportArtifactInput) {
      const parsed = artifactSchema.parse(input);
      assertImportableModelArtifact(parsed);
      return store.createModelArtifact({
        id: createRecordId("model"),
        ...parsed,
        createdAt: now()
      });
    }
  };
}
