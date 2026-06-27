import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { createReadableCodes, readableCode } from "@/lib/world-model-display";
import { createInMemoryWorldModelStore } from "@/server/services/in-memory-store";
import { createPrismaWorldModelStore } from "@/server/services/prisma-store";
import { createWorldModelServices } from "@/server/services/world-model-services";
import type { EvidenceLoopResult, WorldModelServices } from "@/server/services/types";

export type AcceptanceStoreMode = "memory" | "prisma";

export type AcceptanceAutoLoopCreatedIds = {
  beliefId?: string;
  hypothesisId?: string;
  sourceId?: string;
};

export type AcceptanceAutoLoopOptions = {
  runId?: string;
  onCreated?: (ids: AcceptanceAutoLoopCreatedIds) => void;
};

export type AcceptanceAutoLoopResult = {
  runId: string;
  storeMode?: AcceptanceStoreMode;
  beliefId: string;
  beliefCode: string;
  hypothesisId: string;
  hypothesisCode: string;
  sourceId: string;
  sourceCode: string;
  observationCodes: string[];
  evidenceCodes: string[];
  updateCodes: string[];
  beforeProbability: number;
  afterProbability: number;
  evidenceCount: number;
  updateCount: number;
  loop: EvidenceLoopResult;
};

export type AcceptanceAutoLoopCommandOptions = {
  storeMode: AcceptanceStoreMode;
  runId?: string;
};

export type AcceptanceAutoLoopCliOptions = AcceptanceAutoLoopCommandOptions;

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function fetchAcceptanceSearchPage(url: string) {
  const parsed = new URL(url);
  const query = parsed.searchParams.get("q") ?? "AI agents accelerate engineering teams";
  const escapedQuery = escapeHtml(query);
  return [
    "<html>",
    `<head><title>${escapedQuery} acceptance evidence</title></head>`,
    `<body>${escapedQuery} acceptance evidence shows AI agents accelerate engineering teams.</body>`,
    "</html>"
  ].join("");
}

function argValue(argv: string[], name: string) {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  return argv[index + 1];
}

function normalizeStoreMode(value: string | undefined): AcceptanceStoreMode {
  return value === "memory" ? "memory" : "prisma";
}

export function parseAcceptanceAutoLoopArgs(
  argv = process.argv,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>
): AcceptanceAutoLoopCliOptions {
  return {
    storeMode: normalizeStoreMode(argValue(argv, "--store") ?? env.WORLDMODEL_ACCEPTANCE_STORE),
    runId: argValue(argv, "--run-id")
  };
}

export async function runAcceptanceAutoLoop(
  services: WorldModelServices,
  options: AcceptanceAutoLoopOptions = {}
): Promise<AcceptanceAutoLoopResult> {
  const runId = options.runId ?? `acceptance-${Date.now()}`;
  const hypothesisText = `AI agents accelerate engineering teams ${runId}`;
  const belief = await services.beliefs.createBelief({
    title: `AI agents accelerate engineering teams ${runId}`,
    category: "AI_TREND",
    description: "Acceptance run belief for the automated evidence loop.",
    probabilityMode: "INDEPENDENT",
    hypotheses: [
      {
        proposition: hypothesisText,
        priorProbability: 0.35,
        stance: "SUPPORTS",
        notes: "AI agents accelerate engineering teams acceptance evidence"
      },
      {
        proposition: `AI agents do not accelerate engineering teams ${runId}`,
        priorProbability: 0.35,
        stance: "OPPOSES",
        notes: "Counter-hypothesis for acceptance auto-apply coverage"
      }
    ]
  });
  const hypothesis = belief.hypotheses[0];
  assertCondition(hypothesis, "Acceptance belief did not create a hypothesis.");
  options.onCreated?.({ beliefId: belief.id, hypothesisId: hypothesis.id });

  const source = await services.sources.createSource({
    name: `Acceptance search source ${runId}`,
    kind: "SEARCH",
    url: "https://acceptance.local/search?q={query}",
    adapter: "search",
    credibility: 0.8,
    enabled: true,
    autoConfirm: true,
    autoConfirmThreshold: 0.2
  });
  options.onCreated?.({ beliefId: belief.id, hypothesisId: hypothesis.id, sourceId: source.id });

  const loop = await services.automation.runEvidenceLoop({
    beliefIds: [belief.id],
    sourceIds: [source.id],
    maxQueries: 1,
    maxObservations: 1,
    autoConfirmThreshold: 0.2
  });

  const updatedBelief = await services.beliefs.getBelief(belief.id);
  const updatedHypothesis = updatedBelief?.hypotheses.find((candidate) => candidate.id === hypothesis.id);
  const evidence = (await services.evidence.listEvidence()).filter((item) =>
    item.links.some((link) => link.hypothesisId === hypothesis.id)
  );
  const evidenceIds = new Set(evidence.map((item) => item.id));
  const updates = (await services.updates.listEvents()).filter(
    (event) => event.beliefId === belief.id && evidenceIds.has(event.evidenceId)
  );
  const allBeliefs = await services.beliefs.listBeliefs();
  const allSources = await services.sources.listSources();
  const allObservations = await services.observations.listObservations();
  const allEvidence = await services.evidence.listEvidence();
  const allUpdates = await services.updates.listEvents();
  const beliefCodes = createReadableCodes(allBeliefs, "B", (item) => item.createdAt);
  const hypothesisCodes = createReadableCodes(
    allBeliefs.flatMap((item) => item.hypotheses),
    "H",
    (item) => item.createdAt
  );
  const sourceCodes = createReadableCodes(allSources, "S", (item) => item.createdAt);
  const observationCodes = createReadableCodes(allObservations, "O", (item) => item.observedAt);
  const evidenceCodes = createReadableCodes(allEvidence, "E", (item) => item.confirmedAt);
  const updateCodes = createReadableCodes(allUpdates, "U", (item) => item.createdAt);

  assertCondition(loop.queryCount === 1, `Expected one generated query, received ${loop.queryCount}.`);
  assertCondition(loop.sourceRunCount === 1, `Expected one source run, received ${loop.sourceRunCount}.`);
  assertCondition(loop.itemCount === 1, `Expected one fetched observation, received ${loop.itemCount}.`);
  assertCondition(loop.candidateCount === 1, `Expected one evidence candidate, received ${loop.candidateCount}.`);
  assertCondition(loop.autoAppliedCount === 1, `Expected one auto-applied evidence, received ${loop.autoAppliedCount}.`);
  assertCondition(loop.reviewCount === 0, `Expected no review-only items, received ${loop.reviewCount}.`);
  assertCondition(loop.failureCount === 0, `Expected no source failures, received ${loop.failureCount}.`);
  assertCondition(updatedHypothesis, "Updated hypothesis was not found after the loop.");
  assertCondition(
    updatedHypothesis.currentProbability > hypothesis.currentProbability,
    `Expected probability to increase from ${hypothesis.currentProbability}, received ${updatedHypothesis.currentProbability}.`
  );
  assertCondition(evidence.length === 1, `Expected one confirmed evidence item, received ${evidence.length}.`);
  assertCondition(updates.length === 1, `Expected one update event, received ${updates.length}.`);

  return {
    runId,
    beliefId: belief.id,
    beliefCode: readableCode(beliefCodes, belief.id, "B"),
    hypothesisId: hypothesis.id,
    hypothesisCode: readableCode(hypothesisCodes, hypothesis.id, "H"),
    sourceId: source.id,
    sourceCode: readableCode(sourceCodes, source.id, "S"),
    observationCodes: evidence.map((item) => readableCode(observationCodes, item.observationId, "O")),
    evidenceCodes: evidence.map((item) => readableCode(evidenceCodes, item.id, "E")),
    updateCodes: updates.map((item) => readableCode(updateCodes, item.id, "U")),
    beforeProbability: hypothesis.currentProbability,
    afterProbability: updatedHypothesis.currentProbability,
    evidenceCount: evidence.length,
    updateCount: updates.length,
    loop
  };
}

export async function runAcceptanceAutoLoopCommand(options: AcceptanceAutoLoopCommandOptions): Promise<AcceptanceAutoLoopResult> {
  if (options.storeMode === "memory") {
    const services = createWorldModelServices(createInMemoryWorldModelStore(), {
      sourceAdapterDependencies: { fetchText: fetchAcceptanceSearchPage }
    });
    return {
      ...(await runAcceptanceAutoLoop(services, { runId: options.runId })),
      storeMode: "memory"
    };
  }

  const prisma = new PrismaClient();
  const createdIds: AcceptanceAutoLoopCreatedIds = {};
  try {
    const services = createWorldModelServices(createPrismaWorldModelStore(prisma), {
      sourceAdapterDependencies: { fetchText: fetchAcceptanceSearchPage }
    });
    return {
      ...(await runAcceptanceAutoLoop(services, {
        runId: options.runId,
        onCreated(ids) {
          Object.assign(createdIds, ids);
        }
      })),
      storeMode: "prisma"
    };
  } finally {
    await cleanupAcceptanceAutoLoop(prisma, createdIds);
    await prisma.$disconnect();
  }
}

async function cleanupAcceptanceAutoLoop(prisma: PrismaClient, ids: AcceptanceAutoLoopCreatedIds) {
  const observationIds = ids.sourceId
    ? (await prisma.observation.findMany({ where: { sourceId: ids.sourceId }, select: { id: true } })).map((item) => item.id)
    : [];
  const evidenceIds =
    observationIds.length > 0
      ? (await prisma.evidence.findMany({ where: { observationId: { in: observationIds } }, select: { id: true } })).map((item) => item.id)
      : [];

  if (evidenceIds.length > 0) {
    await prisma.bayesianUpdateEvent.deleteMany({ where: { evidenceId: { in: evidenceIds } } });
    await prisma.likelihoodRun.deleteMany({ where: { evidenceId: { in: evidenceIds } } });
    await prisma.evidenceHypothesisLink.deleteMany({ where: { evidenceId: { in: evidenceIds } } });
    await prisma.evidence.deleteMany({ where: { id: { in: evidenceIds } } });
  }

  if (observationIds.length > 0) {
    await prisma.observation.deleteMany({ where: { id: { in: observationIds } } });
  }

  if (ids.sourceId) {
    await prisma.observationRun.deleteMany({ where: { sourceId: ids.sourceId } });
    await prisma.observationSource.deleteMany({ where: { id: ids.sourceId } });
  }

  if (ids.beliefId) {
    await prisma.bayesianUpdateEvent.deleteMany({ where: { beliefId: ids.beliefId } });
    await prisma.hypothesis.deleteMany({ where: { beliefId: ids.beliefId } });
    await prisma.belief.deleteMany({ where: { id: ids.beliefId } });
  }
}

async function main() {
  config({ path: ".env.local" });
  config();

  const result = await runAcceptanceAutoLoopCommand(parseAcceptanceAutoLoopArgs());
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
