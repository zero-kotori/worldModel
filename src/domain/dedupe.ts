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

const TRACKING_QUERY_PARAMS = new Set([
  "fbclid",
  "gclid",
  "gbraid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "ref",
  "ref_src",
  "wbraid"
]);

function timestampFor(observation: ObservationForDedupe) {
  return observation.publishedAt?.getTime() ?? observation.observedAt?.getTime() ?? 0;
}

function canonicalUrl(value?: string | null) {
  const raw = value?.trim();
  if (!raw) {
    return "";
  }

  try {
    const url = new URL(raw);
    const retainedParams = [...url.searchParams.entries()]
      .filter(([key]) => {
        const normalizedKey = key.toLowerCase();
        return !normalizedKey.startsWith("utm_") && !TRACKING_QUERY_PARAMS.has(normalizedKey);
      })
      .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
        return leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue);
      });

    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    url.search = "";
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }

    for (const [key, queryValue] of retainedParams) {
      url.searchParams.append(key, queryValue);
    }

    return url.toString();
  } catch {
    return raw;
  }
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
  const candidateUrl = canonicalUrl(candidate.url);
  const urlDuplicate = existingObservations.find((observation) => {
    const observationUrl = canonicalUrl(observation.url);
    return Boolean(candidateUrl && observationUrl && candidateUrl === observationUrl);
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
