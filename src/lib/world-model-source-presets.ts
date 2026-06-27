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
  },
  {
    id: "google-news-query",
    name: "Google News Query RSS",
    description: "Query-driven Google News RSS for category-neutral belief and hypothesis evidence search.",
    kind: "RSS",
    url: "https://news.google.com/rss/search?q={query}&hl=en-US&gl=US&ceid=US:en",
    adapter: "rss_query",
    credentialRef: undefined,
    credibility: 0.66,
    enabled: true,
    autoConfirm: false,
    autoConfirmThreshold: 0.88
  },
  {
    id: "github-repository-query",
    name: "GitHub Repository Query",
    description: "GitHub repository search API for open-source adoption, release, and ecosystem signals.",
    kind: "GITHUB",
    url: "https://api.github.com/search/repositories?q={query}&sort=updated&order=desc&per_page=10",
    adapter: "github_repositories",
    credentialRef: undefined,
    credibility: 0.64,
    enabled: true,
    autoConfirm: false,
    autoConfirmThreshold: 0.88
  },
  {
    id: "huggingface-model-query",
    name: "Hugging Face Model Query",
    description: "Hugging Face model search API for model release, download, and ecosystem adoption signals.",
    kind: "HUGGING_FACE",
    url: "https://huggingface.co/api/models?search={query}&limit=10&sort=lastModified&direction=-1",
    adapter: "huggingface_models",
    credentialRef: undefined,
    credibility: 0.66,
    enabled: true,
    autoConfirm: false,
    autoConfirmThreshold: 0.88
  },
  {
    id: "gdelt-doc-query",
    name: "GDELT Document Query",
    description: "GDELT document API for global news and event observations tied to belief and hypothesis queries.",
    kind: "GDELT",
    url: "https://api.gdeltproject.org/api/v2/doc/doc?query={query}&mode=ArtList&format=json&maxrecords=10",
    adapter: "gdelt_doc_articles",
    credentialRef: undefined,
    credibility: 0.58,
    enabled: true,
    autoConfirm: false,
    autoConfirmThreshold: 0.9
  },
  {
    id: "polymarket-query",
    name: "Polymarket Query",
    description: "Polymarket public market search for prediction market questions and liquidity-backed signals.",
    kind: "PREDICTION_MARKET",
    url: "https://gamma-api.polymarket.com/markets?search={query}&limit=10&active=true&closed=false",
    adapter: "polymarket_markets",
    credentialRef: undefined,
    credibility: 0.6,
    enabled: true,
    autoConfirm: false,
    autoConfirmThreshold: 0.9
  },
  {
    id: "reddit-public-query",
    name: "Reddit Public Query",
    description: "Public Reddit search pages for weak social discussion signals that should remain review-first.",
    kind: "SOCIAL",
    url: "https://www.reddit.com/search/?q={query}&sort=new",
    adapter: "public_social_search",
    credentialRef: undefined,
    credibility: 0.42,
    enabled: true,
    autoConfirm: false,
    autoConfirmThreshold: 0.95
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
