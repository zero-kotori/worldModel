import { XMLParser } from "fast-xml-parser";
import type { ObservationSourceKind } from "@/server/services/types";

export type RawObservation = {
  title: string;
  content: string;
  url?: string;
  author?: string;
  publishedAt?: Date;
  sourceMetadata?: Record<string, unknown>;
};

export type AdapterSourceConfig = {
  name: string;
  adapter: string;
  url?: string;
  credentialRef?: string;
};

export type SourceAdapter = {
  kind: ObservationSourceKind;
  fetch(source: AdapterSourceConfig): Promise<RawObservation[]>;
};

export type AdapterDependencies = {
  fetchText?: (url: string) => Promise<string>;
};

async function defaultFetchText(url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Fetch failed ${response.status} for ${url}`);
  }
  return response.text();
}

function textValue(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "object" && "#text" in value) return String((value as { "#text": unknown })["#text"]).trim();
  return String(value).trim();
}

function arrayValue<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function parseRssObservations(xml: string): RawObservation[] {
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml) as {
    rss?: { channel?: { item?: unknown | unknown[] } };
    feed?: { entry?: unknown | unknown[] };
  };
  const rssItems = arrayValue(parsed.rss?.channel?.item as Record<string, unknown> | Record<string, unknown>[] | undefined);
  const atomEntries = arrayValue(parsed.feed?.entry as Record<string, unknown> | Record<string, unknown>[] | undefined);
  const items = rssItems.length > 0 ? rssItems : atomEntries;

  return items.map((item) => {
    const linkValue = item.link;
    const url =
      typeof linkValue === "object" && linkValue !== null && "@_href" in linkValue
        ? String((linkValue as { "@_href": unknown })["@_href"])
        : textValue(linkValue);
    const publishedAtText = textValue(item.pubDate ?? item.published ?? item.updated);
    const publishedAt = publishedAtText ? new Date(publishedAtText) : undefined;

    return {
      title: textValue(item.title) || "Untitled observation",
      content: textValue(item.description ?? item.summary ?? item.content),
      url: url || undefined,
      author: textValue(item.author ?? item.creator) || undefined,
      publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : undefined,
      sourceMetadata: { adapter: "RSS" }
    };
  });
}

function stripHtml(html: string) {
  return html
    .replaceAll(/<head[\s\S]*?<\/head>/gi, " ")
    .replaceAll(/<script[\s\S]*?<\/script>/gi, " ")
    .replaceAll(/<style[\s\S]*?<\/style>/gi, " ")
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function titleFromHtml(html: string) {
  return html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replaceAll(/\s+/g, " ").trim();
}

function createFetchAdapter(kind: ObservationSourceKind, dependencies: AdapterDependencies): SourceAdapter {
  const fetchText = dependencies.fetchText ?? defaultFetchText;
  return {
    kind,
    async fetch(source) {
      if (!source.url) return [];
      const text = await fetchText(source.url);
      return [
        {
          title: titleFromHtml(text) ?? source.name,
          content: stripHtml(text),
          url: source.url,
          sourceMetadata: { adapter: kind }
        }
      ];
    }
  };
}

export function createSourceAdapter(kind: ObservationSourceKind, dependencies: AdapterDependencies = {}): SourceAdapter {
  const fetchText = dependencies.fetchText ?? defaultFetchText;

  if (kind === "RSS") {
    return {
      kind,
      async fetch(source) {
        if (!source.url) return [];
        return parseRssObservations(await fetchText(source.url));
      }
    };
  }

  if (kind === "WEB_PAGE") {
    return createFetchAdapter(kind, dependencies);
  }

  if (kind === "MANUAL" || kind === "SOCIAL") {
    return {
      kind,
      async fetch() {
        return [];
      }
    };
  }

  return createFetchAdapter(kind, dependencies);
}

export const supportedSourceKinds: ObservationSourceKind[] = [
  "MANUAL",
  "RSS",
  "WEB_PAGE",
  "SEARCH",
  "GITHUB",
  "HUGGING_FACE",
  "GDELT",
  "PREDICTION_MARKET",
  "SOCIAL"
];
