import type { CreateSourceInput, ObservationSourceRecord, SourcePresetRecord } from "@/server/services/types";

type SourcePresetDefinition = CreateSourceInput & {
  id: string;
  description: string;
};

export const sourcePresetDefinitions: SourcePresetDefinition[] = [
  {
    id: "hn-frontpage",
    name: "Hacker News Frontpage",
    description: "Hacker News frontpage RSS for broad technology and AI trend signals.",
    kind: "RSS",
    url: "https://hnrss.org/frontpage",
    adapter: "rss",
    credentialRef: undefined,
    credibility: 0.62,
    enabled: true,
    autoConfirm: false,
    autoConfirmThreshold: 0.86
  },
  {
    id: "hn-ai-search",
    name: "Hacker News AI Search",
    description: "Hacker News RSS search for AI, LLM, and agent discussions.",
    kind: "RSS",
    url: "https://hnrss.org/newest?q=AI+OR+LLM+OR+agent&count=50",
    adapter: "rss",
    credentialRef: undefined,
    credibility: 0.6,
    enabled: true,
    autoConfirm: false,
    autoConfirmThreshold: 0.86
  },
  {
    id: "arxiv-cs-ai",
    name: "arXiv cs.AI RSS",
    description: "arXiv Artificial Intelligence feed for research-level AI trend evidence.",
    kind: "RSS",
    url: "https://rss.arxiv.org/rss/cs.AI",
    adapter: "rss",
    credentialRef: undefined,
    credibility: 0.72,
    enabled: true,
    autoConfirm: false,
    autoConfirmThreshold: 0.88
  },
  {
    id: "arxiv-cs-cl",
    name: "arXiv cs.CL RSS",
    description: "arXiv Computation and Language feed for LLM and NLP research signals.",
    kind: "RSS",
    url: "https://rss.arxiv.org/rss/cs.CL",
    adapter: "rss",
    credentialRef: undefined,
    credibility: 0.72,
    enabled: true,
    autoConfirm: false,
    autoConfirmThreshold: 0.88
  },
  {
    id: "hf-blog",
    name: "Hugging Face Blog RSS",
    description: "Hugging Face blog RSS for model, tooling, and open-source AI ecosystem updates.",
    kind: "RSS",
    url: "https://huggingface.co/blog/feed.xml",
    adapter: "rss",
    credentialRef: undefined,
    credibility: 0.68,
    enabled: true,
    autoConfirm: false,
    autoConfirmThreshold: 0.86
  }
];

function isPresetInstalled(preset: SourcePresetDefinition, sources: ObservationSourceRecord[]) {
  return sources.some((source) => source.url === preset.url || source.name === preset.name);
}

export function listSourcePresets(sources: ObservationSourceRecord[]): SourcePresetRecord[] {
  return sourcePresetDefinitions.map((preset) => ({
    ...preset,
    installed: isPresetInstalled(preset, sources)
  }));
}

export function getSourcePreset(id: string) {
  return sourcePresetDefinitions.find((preset) => preset.id === id);
}
