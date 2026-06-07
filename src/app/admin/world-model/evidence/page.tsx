import { Check, RotateCcw, Zap } from "lucide-react";
import {
  applyEvidenceUpdateAction,
  confirmEvidenceAction,
  rollbackUpdateAction
} from "@/app/admin/world-model/actions";
import { loadWorldModelData } from "@/app/admin/world-model/data";
import { Field, SelectField, TextAreaField } from "@/components/world-model/Field";
import { DataWarning, EmptyState, PageSection } from "@/components/world-model/PageSection";

export const dynamic = "force-dynamic";

export default async function EvidencePage() {
  const data = await loadWorldModelData();

  return (
    <main className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <DataWarning message={data.error} />
      <PageSection title="确认证据">
        <form action={confirmEvidenceAction} className="grid gap-3 rounded-md border border-line bg-white p-4 lg:grid-cols-4">
          <Field label="观察 ID" name="observationId" required />
          <Field label="假设 ID（逗号分隔）" name="hypothesisIds" required />
          <SelectField
            label="方向"
            name="direction"
            options={["SUPPORTS", "OPPOSES", "MIXED", "NEUTRAL"].map((value) => ({ value, label: value }))}
          />
          <Field label="相关性" name="relevance" type="number" step="0.01" min="0" max="1" defaultValue="0.8" />
          <Field label="似然比" name="likelihoodRatio" type="number" step="0.01" min="0.01" defaultValue="1.5" />
          <Field label="置信度" name="confidence" type="number" step="0.01" min="0" max="1" defaultValue="0.7" />
          <TextAreaField label="解释" name="rationale" required />
          <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md bg-moss px-3 text-sm font-semibold text-white">
            <Check size={16} /> 确认
          </button>
        </form>
      </PageSection>
      <PageSection title="证据库">
        {data.evidence.length === 0 ? (
          <EmptyState label="暂无证据" />
        ) : (
          <div className="grid gap-3">
            {data.evidence.map((evidence) => (
              <div key={evidence.id} className="rounded-md border border-line bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold">{evidence.title}</h2>
                    <p className="text-xs text-ink/55">
                      {evidence.status} · {evidence.confirmationMode} · 可信度 {evidence.credibility.toFixed(2)}
                    </p>
                  </div>
                  <form action={applyEvidenceUpdateAction}>
                    <input type="hidden" name="evidenceId" value={evidence.id} />
                    <button className="inline-flex min-h-9 items-center gap-2 rounded-md bg-berry px-3 text-sm font-semibold text-white">
                      <Zap size={16} /> 应用更新
                    </button>
                  </form>
                </div>
                <div className="mt-3 overflow-x-auto">
                  <table className="min-w-full text-left text-sm">
                    <thead className="text-xs text-ink/50">
                      <tr>
                        <th className="py-2">假设 ID</th>
                        <th className="py-2">方向</th>
                        <th className="py-2">似然比</th>
                        <th className="py-2">解释</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evidence.links.map((link) => (
                        <tr key={link.id} className="border-t border-line">
                          <td className="py-2 pr-3 font-mono text-xs">{link.hypothesisId}</td>
                          <td className="py-2 pr-3">{link.direction}</td>
                          <td className="py-2 pr-3">{link.likelihoodRatio.toFixed(2)}</td>
                          <td className="py-2 pr-3">{link.rationale}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </PageSection>
      <PageSection title="更新回滚">
        <div className="grid gap-3 rounded-md border border-line bg-white p-4">
          <form action={rollbackUpdateAction} className="grid gap-3 lg:grid-cols-[1fr_auto]">
            <Field label="更新事件 ID" name="eventId" required />
            <button className="inline-flex min-h-9 items-center justify-center gap-2 rounded-md border border-line px-3 text-sm font-semibold text-ink">
              <RotateCcw size={16} /> 回滚
            </button>
          </form>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="text-xs text-ink/50">
                <tr>
                  <th className="py-2">事件 ID</th>
                  <th className="py-2">状态</th>
                  <th className="py-2">证据 ID</th>
                </tr>
              </thead>
              <tbody>
                {data.updates.map((event) => (
                  <tr key={event.id} className="border-t border-line">
                    <td className="py-2 pr-3 font-mono text-xs">{event.id}</td>
                    <td className="py-2 pr-3">{event.status}</td>
                    <td className="py-2 pr-3 font-mono text-xs">{event.evidenceId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </PageSection>
    </main>
  );
}
