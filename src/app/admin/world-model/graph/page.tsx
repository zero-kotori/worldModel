import Link from "next/link";
import { loadWorldModelData } from "@/app/admin/world-model/data";
import { DataWarning } from "@/components/world-model/PageSection";
import { WorldModelGraphView } from "@/components/world-model/WorldModelGraphView";
import { createWorldModelGraph } from "@/lib/world-model-graph";
import { createWorldModelGraphEditorData } from "@/lib/world-model-graph-editor";

export const dynamic = "force-dynamic";

export default async function WorldModelGraphPage() {
  const data = await loadWorldModelData();
  const graph = createWorldModelGraph({ beliefs: data.beliefs, evidence: data.evidence, updates: data.updates });
  const graphEditor = createWorldModelGraphEditorData({ beliefs: data.beliefs, evidence: data.evidence, updates: data.updates });

  return (
    <main className="px-4 py-4 sm:px-6 lg:px-8">
      <DataWarning message={data.error} />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/65">证据影响图谱 · 图谱工作区</h2>
        <Link
          href="/admin/world-model/evidence"
          className="inline-flex min-h-9 items-center rounded-md border border-line bg-white px-3 text-sm font-semibold text-ink hover:border-moss hover:text-moss"
        >
          证据库
        </Link>
      </div>
      <WorldModelGraphView graph={graph} editor={graphEditor} mode="workspace" />
    </main>
  );
}
