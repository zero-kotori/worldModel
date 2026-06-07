export type DuplicateReason = "URL" | "HASH" | "SEMANTIC" | "NONE";

export type DuplicateDecision = {
  duplicate: boolean;
  reason: DuplicateReason;
  duplicateOfId?: string;
  confidence: number;
};

export type ObservationForDedupe = {
  id?: string;
  title: string;
  content: string;
  url?: string | null;
  normalizedHash?: string | null;
  semanticKey?: string | null;
  observedAt?: Date | null;
  publishedAt?: Date | null;
};

export type DedupeOptions = {
  semanticWindowHours?: number;
};

function timestampFor(observation: ObservationForDedupe) {
  return observation.publishedAt?.getTime() ?? observation.observedAt?.getTime() ?? 0;
}

function withinSemanticWindow(candidate: ObservationForDedupe, existing: ObservationForDedupe, hours: number) {
  if (!candidate.semanticKey || !existing.semanticKey || candidate.semanticKey !== existing.semanticKey) {
    return false;
  }

  const candidateTimestamp = timestampFor(candidate);
  const existingTimestamp = timestampFor(existing);

  if (candidateTimestamp === 0 || existingTimestamp === 0) {
    return true;
  }

  return Math.abs(candidateTimestamp - existingTimestamp) <= hours * 60 * 60 * 1000;
}

export function deduplicateObservation(
  candidate: ObservationForDedupe,
  existingObservations: ObservationForDedupe[],
  options: DedupeOptions = {}
): DuplicateDecision {
  const semanticWindowHours = options.semanticWindowHours ?? 24;
  const urlDuplicate = existingObservations.find((observation) => {
    return Boolean(candidate.url && observation.url && candidate.url === observation.url);
  });

  if (urlDuplicate?.id) {
    return { duplicate: true, reason: "URL", duplicateOfId: urlDuplicate.id, confidence: 1 };
  }

  const hashDuplicate = existingObservations.find((observation) => {
    return Boolean(
      candidate.normalizedHash &&
        observation.normalizedHash &&
        candidate.normalizedHash === observation.normalizedHash
    );
  });

  if (hashDuplicate?.id) {
    return { duplicate: true, reason: "HASH", duplicateOfId: hashDuplicate.id, confidence: 0.98 };
  }

  const semanticDuplicate = existingObservations.find((observation) => {
    return withinSemanticWindow(candidate, observation, semanticWindowHours);
  });

  if (semanticDuplicate?.id) {
    return { duplicate: true, reason: "SEMANTIC", duplicateOfId: semanticDuplicate.id, confidence: 0.82 };
  }

  return { duplicate: false, reason: "NONE", confidence: 0 };
}
