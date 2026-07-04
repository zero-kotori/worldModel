import { spawn } from "node:child_process";
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
  queries?: string[];
};

export type SourceAdapter = {
  kind: ObservationSourceKind;
  fetch(source: AdapterSourceConfig): Promise<RawObservation[]>;
};

export type AdapterDependencies = {
  fetchText?: (url: string) => Promise<string>;
  fetchImpl?: typeof fetch;
  fallbackFetchText?: (url: string) => Promise<string>;
  preferFallbackFetch?: boolean;
  env?: Record<string, string | undefined>;
};

const DEFAULT_SOURCE_FETCH_TIMEOUT_MS = 30_000;
const DEFAULT_SOURCE_USER_AGENT = "worldModel/0.1 local evidence collector";

type FetchTextWithFallbackOptions = {
  fetchImpl?: typeof fetch;
  fallbackFetchText?: (url: string) => Promise<string>;
  preferFallbackFetch?: boolean;
};

function networkErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : "";
  return `${message} ${cause}`.toLowerCase();
}

function shouldUseFallbackFetch(error: unknown) {
  const message = networkErrorMessage(error);
  if (/fetch failed \d{3} for /.test(message)) return false;
  if (message.startsWith("fetch failed ")) return true;
  return (
    message.includes("fetch failed") ||
    message.includes("connect timeout") ||
    message.includes("connection refused") ||
    message.includes("networkerror") ||
    message.includes("econnreset") ||
    message.includes("etimedout")
  );
}

function isExplicitHttpFailure(error: unknown) {
  const message = networkErrorMessage(error);
  return (
    /fetch failed \d{3} for /.test(message) ||
    /response status code does not indicate success: \d{3}/.test(message) ||
    /returned error: \d{3}/.test(message)
  );
}

function defaultFallbackFetchText() {
  return process.platform === "win32" ? systemFetchText : undefined;
}

export function createPowershellFetchInvocation(url: string) {
  const timeoutSeconds = Math.ceil(DEFAULT_SOURCE_FETCH_TIMEOUT_MS / 1000);
  const script = [
    "$ProgressPreference = 'SilentlyContinue';",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;",
    `$response = Invoke-WebRequest -Uri $env:WORLDMODEL_FETCH_URL -UseBasicParsing -TimeoutSec ${timeoutSeconds} -Headers @{`,
    `  'User-Agent' = '${DEFAULT_SOURCE_USER_AGENT}';`,
    "  'Accept' = 'application/rss+xml, application/json, text/html, */*'",
    "};",
    "[Console]::Write($response.Content)"
  ].join(" ");
  return {
    command: "powershell.exe",
    args: ["-NoProfile", "-NonInteractive", "-Command", script],
    env: {
      ...process.env,
      WORLDMODEL_FETCH_URL: url
    }
  };
}

export async function powershellFetchText(url: string): Promise<string> {
  const timeoutSeconds = Math.ceil(DEFAULT_SOURCE_FETCH_TIMEOUT_MS / 1000);
  const invocation = createPowershellFetchInvocation(url);
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, { windowsHide: true, env: invocation.env });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`System fetch timed out after ${timeoutSeconds} seconds for ${url}`));
    }, DEFAULT_SOURCE_FETCH_TIMEOUT_MS + 1000);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8"));
        return;
      }
      reject(new Error(`System fetch failed ${code} for ${url}: ${Buffer.concat(stderr).toString("utf8").trim()}`));
    });
  });
}

function createCurlFetchInvocation(url: string) {
  const timeoutSeconds = Math.ceil(DEFAULT_SOURCE_FETCH_TIMEOUT_MS / 1000);
  return {
    command: "curl.exe",
    args: [
      "-L",
      "--fail",
      "--silent",
      "--show-error",
      "--max-time",
      String(timeoutSeconds),
      "-A",
      DEFAULT_SOURCE_USER_AGENT,
      "-H",
      "Accept: application/rss+xml, application/json, text/html, */*",
      url
    ]
  };
}

async function curlFetchText(url: string): Promise<string> {
  const timeoutSeconds = Math.ceil(DEFAULT_SOURCE_FETCH_TIMEOUT_MS / 1000);
  const invocation = createCurlFetchInvocation(url);
  return new Promise((resolve, reject) => {
    const child = spawn(invocation.command, invocation.args, { windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Curl fetch timed out after ${timeoutSeconds} seconds for ${url}`));
    }, DEFAULT_SOURCE_FETCH_TIMEOUT_MS + 1000);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString("utf8"));
        return;
      }
      reject(new Error(`Curl fetch failed ${code} for ${url}: ${Buffer.concat(stderr).toString("utf8").trim()}`));
    });
  });
}

async function systemFetchText(url: string): Promise<string> {
  let lastError: unknown;
  try {
    return await curlFetchText(url);
  } catch (error) {
    lastError = error;
  }
  try {
    return await powershellFetchText(url);
  } catch (error) {
    lastError = error;
  }
  throw lastError;
}

export async function fetchTextWithFallback(url: string, options: FetchTextWithFallbackOptions = {}) {
  const fallbackFetchText = options.fallbackFetchText ?? defaultFallbackFetchText();
  let preferredFallbackError: unknown;
  if (options.preferFallbackFetch && fallbackFetchText) {
    try {
      return await fallbackFetchText(url);
    } catch (error) {
      if (isExplicitHttpFailure(error)) throw error;
      preferredFallbackError = error;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_SOURCE_FETCH_TIMEOUT_MS);
  try {
    const fetchImpl = options.fetchImpl ?? fetch;
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        "user-agent": DEFAULT_SOURCE_USER_AGENT,
        accept: "application/rss+xml, application/json, text/html, */*"
      }
    });
    if (!response.ok) {
      throw new Error(`Fetch failed ${response.status} for ${url}`);
    }
    return response.text();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Source fetch timed out after ${DEFAULT_SOURCE_FETCH_TIMEOUT_MS / 1000} seconds for ${url}`, {
        cause: error
      });
    }
    if (fallbackFetchText && shouldUseFallbackFetch(error)) {
      try {
        return await fallbackFetchText(url);
      } catch (fallbackError) {
        throw new Error(
          `Primary fetch failed and system fallback failed for ${url}: ${
            fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          }`,
          { cause: fallbackError }
        );
      }
    }
    if (preferredFallbackError) {
      throw new Error(
        `System fetch failed and primary fetch failed for ${url}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: preferredFallbackError }
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function recordArrayValue(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = objectValue(item);
    return record ? [record] : [];
  });
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function flexibleNumberField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : undefined;
}

function booleanField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "boolean" ? value : undefined;
}

function rawArrayField(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key];
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function arrayStringField(record: Record<string, unknown>, key: string): string[] {
  return rawArrayField(record, key)
    .map((item) => (typeof item === "string" || typeof item === "number" ? String(item).trim() : ""))
    .filter(Boolean);
}

function numericArrayField(record: Record<string, unknown>, key: string): number[] {
  return rawArrayField(record, key)
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
}

function dateField(record: Record<string, unknown>, key: string) {
  const value = stringField(record, key);
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function gdeltDateField(record: Record<string, unknown>, key: string) {
  const value = stringField(record, key);
  if (!value) return undefined;
  const matched = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!matched) return dateField(record, key);
  const [, year, month, day, hour, minute, second] = matched;
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
}

function contentFromParts(parts: Array<string | number | undefined>) {
  return parts
    .map((part) => (part === undefined ? "" : String(part).trim()))
    .filter(Boolean)
    .join(" ");
}

function parseJsonResponse(text: string, sourceName: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(`Failed to parse JSON response for ${sourceName}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function preferFallbackFetchForSource(dependencies: AdapterDependencies) {
  return dependencies.preferFallbackFetch ?? (process.platform === "win32" && !dependencies.fetchImpl && !dependencies.fallbackFetchText);
}

function createFetchAdapter(kind: ObservationSourceKind, dependencies: AdapterDependencies): SourceAdapter {
  const fetchText =
    dependencies.fetchText ??
    ((url: string) =>
      fetchTextWithFallback(url, {
        fetchImpl: dependencies.fetchImpl,
        fallbackFetchText: dependencies.fallbackFetchText,
        preferFallbackFetch: preferFallbackFetchForSource(dependencies)
      }));
  return {
    kind,
    async fetch(source) {
      if (!source.url) return [];
      const sourceUrl = source.url;
      const queries = source.queries?.filter(Boolean) ?? [];
      const querySource = sourceUrl.includes("{query}");
      const urls =
        querySource && queries.length > 0
          ? queries.map((query) => ({ url: sourceUrl.replaceAll("{query}", encodeURIComponent(query)), query }))
          : querySource
            ? []
            : [{ url: sourceUrl, query: undefined }];
      const fetchOne = async (item: (typeof urls)[number]): Promise<RawObservation> => {
        const text = await fetchText(item.url);
        return {
          title: titleFromHtml(text) ?? source.name,
          content: stripHtml(text),
          url: item.url,
          sourceMetadata: { adapter: kind, query: item.query }
        };
      };

      if (!querySource) {
        return Promise.all(urls.map(fetchOne));
      }

      const results = await Promise.allSettled(urls.map(fetchOne));
      const observations = results
        .filter((result): result is PromiseFulfilledResult<RawObservation> => result.status === "fulfilled")
        .map((result) => result.value);
      if (observations.length > 0 || urls.length === 0) return observations;

      const firstError = results.find((result): result is PromiseRejectedResult => result.status === "rejected")?.reason;
      const reason = firstError instanceof Error ? firstError.message : String(firstError);
      throw new Error(`All ${urls.length} query fetches failed for ${source.name}: ${reason}`);
    }
  };
}

function queryUrls(sourceUrl: string, queries: string[]) {
  const querySource = sourceUrl.includes("{query}");
  if (!querySource) return [{ url: sourceUrl, query: undefined }];
  return queries.length > 0 ? queries.map((query) => ({ url: sourceUrl.replaceAll("{query}", encodeURIComponent(query)), query })) : [];
}

async function fetchQueryRssObservations(
  source: AdapterSourceConfig,
  fetchText: (url: string) => Promise<string>
): Promise<RawObservation[]> {
  if (!source.url) return [];
  const queries = source.queries?.filter(Boolean) ?? [];
  const urls = queryUrls(source.url, queries);

  if (!source.url.includes("{query}")) {
    return parseRssObservations(await fetchText(source.url));
  }

  const fetchOne = async (item: (typeof urls)[number]): Promise<RawObservation[]> =>
    parseRssObservations(await fetchText(item.url)).map((observation) => ({
      ...observation,
      sourceMetadata: { ...observation.sourceMetadata, query: item.query }
    }));
  const results = await Promise.allSettled(urls.map(fetchOne));
  const observations = results
    .filter((result): result is PromiseFulfilledResult<RawObservation[]> => result.status === "fulfilled")
    .flatMap((result) => result.value);
  if (observations.length > 0 || urls.length === 0 || results.some((result) => result.status === "fulfilled")) return observations;

  const firstError = results.find((result): result is PromiseRejectedResult => result.status === "rejected")?.reason;
  const reason = firstError instanceof Error ? firstError.message : String(firstError);
  throw new Error(`All ${urls.length} query RSS fetches failed for ${source.name}: ${reason}`);
}

const defaultQueryUrlTemplates: Partial<Record<ObservationSourceKind, string>> = {
  GITHUB: "https://api.github.com/search/repositories?q={query}&sort=updated&order=desc&per_page=10",
  HUGGING_FACE: "https://huggingface.co/api/models?search={query}&limit=10&sort=lastModified&direction=-1",
  GDELT: "https://api.gdeltproject.org/api/v2/doc/doc?query={query}&mode=ArtList&format=json&maxrecords=10",
  PREDICTION_MARKET: "https://gamma-api.polymarket.com/markets?search={query}&limit=10&active=true&closed=false"
};

function platformQueryUrls(kind: ObservationSourceKind, source: AdapterSourceConfig) {
  const queries = source.queries?.filter(Boolean) ?? [];
  if (source.url) return queryUrls(source.url, queries);
  const template = defaultQueryUrlTemplates[kind];
  if (!template || queries.length === 0) return [];
  return queries.map((query) => ({ url: template.replaceAll("{query}", encodeURIComponent(query)), query }));
}

function parseGithubSearchObservations(text: string, query: string | undefined): RawObservation[] {
  const parsed = objectValue(parseJsonResponse(text, "GitHub"));
  const items = recordArrayValue(parsed?.items);
  return items.flatMap((item) => {
    const fullName = stringField(item, "full_name");
    if (!fullName) return [];
    const owner = objectValue(item.owner);
    const stars = numberField(item, "stargazers_count");
    return [
      {
        title: `GitHub: ${fullName}`,
        content: contentFromParts([stringField(item, "description") ?? fullName, stars === undefined ? undefined : `Stars: ${stars}`]),
        url: stringField(item, "html_url") ?? `https://github.com/${fullName}`,
        author: stringField(owner ?? {}, "login"),
        publishedAt: dateField(item, "updated_at"),
        sourceMetadata: { adapter: "GITHUB", query, source: "github_repositories", ...(stars === undefined ? {} : { stars }) }
      }
    ];
  });
}

function parseHuggingFaceModelObservations(text: string, query: string | undefined): RawObservation[] {
  const parsed = parseJsonResponse(text, "Hugging Face");
  const items = Array.isArray(parsed) ? recordArrayValue(parsed) : recordArrayValue(objectValue(parsed)?.models);
  return items.flatMap((item) => {
    const modelId = stringField(item, "modelId") ?? stringField(item, "id");
    if (!modelId) return [];
    const tags = Array.isArray(item.tags) ? item.tags.filter((tag): tag is string => typeof tag === "string") : [];
    const downloads = numberField(item, "downloads");
    const likes = numberField(item, "likes");
    return [
      {
        title: `Hugging Face: ${modelId}`,
        content: contentFromParts([
          stringField(item, "pipeline_tag") ? `Pipeline: ${stringField(item, "pipeline_tag")}` : undefined,
          tags.length > 0 ? `Tags: ${tags.join(", ")}` : undefined,
          downloads === undefined ? undefined : `Downloads: ${downloads}`,
          likes === undefined ? undefined : `Likes: ${likes}`
        ]),
        url: `https://huggingface.co/${modelId}`,
        publishedAt: dateField(item, "lastModified"),
        sourceMetadata: {
          adapter: "HUGGING_FACE",
          query,
          source: "huggingface_models",
          ...(downloads === undefined ? {} : { downloads }),
          ...(likes === undefined ? {} : { likes })
        }
      }
    ];
  });
}

function parseGdeltArticleObservations(text: string, query: string | undefined): RawObservation[] {
  const parsed = objectValue(parseJsonResponse(text, "GDELT"));
  const articles = recordArrayValue(parsed?.articles);
  return articles.flatMap((article) => {
    const title = stringField(article, "title");
    if (!title) return [];
    const domain = stringField(article, "domain");
    const country = stringField(article, "sourceCountry");
    return [
      {
        title,
        content: contentFromParts([title, domain ? `Source: ${domain}` : undefined, country ? `Country: ${country}` : undefined]),
        url: stringField(article, "url"),
        publishedAt: gdeltDateField(article, "seendate"),
        sourceMetadata: { adapter: "GDELT", query, source: "gdelt_doc_articles", ...(domain ? { domain } : {}) }
      }
    ];
  });
}

function parsePredictionMarketObservations(
  text: string,
  query: string | undefined,
  sourceAdapter = "prediction"
): RawObservation[] {
  const parsed = parseJsonResponse(text, "prediction market");
  if (sourceAdapter === "polymarket_events") {
    return parsePolymarketEventObservations(parsed, query);
  }

  const markets = Array.isArray(parsed) ? recordArrayValue(parsed) : recordArrayValue(objectValue(parsed)?.markets);
  const isPolymarketMarkets = sourceAdapter === "polymarket_markets";
  return markets.flatMap((market) => {
    const question = stringField(market, "question") ?? stringField(market, "title");
    if (!question) return [];
    const slug = stringField(market, "slug");
    const volume = isPolymarketMarkets ? flexibleNumberField(market, "volume") : numberField(market, "volume");
    const liquidity = isPolymarketMarkets ? flexibleNumberField(market, "liquidity") : numberField(market, "liquidity");
    const outcomes = isPolymarketMarkets ? arrayStringField(market, "outcomes") : [];
    const outcomePrices = isPolymarketMarkets ? numericArrayField(market, "outcomePrices") : [];
    const outcomeSummary =
      outcomes.length > 0
        ? outcomes
            .map((outcome, index) => `${outcome}${outcomePrices[index] === undefined ? "" : ` ${outcomePrices[index]}`}`)
            .join(", ")
        : undefined;
    const active = booleanField(market, "active");
    const closed = booleanField(market, "closed");
    const archived = booleanField(market, "archived");
    return [
      {
        title: `${isPolymarketMarkets ? "Polymarket" : "Prediction market"}: ${question}`,
        content: contentFromParts([
          stringField(market, "description") ?? question,
          outcomeSummary,
          volume === undefined ? undefined : `Volume: ${volume}`,
          liquidity === undefined ? undefined : `Liquidity: ${liquidity}`
        ]),
        url: stringField(market, "url") ?? (slug ? `https://polymarket.com/event/${slug}` : undefined),
        publishedAt: dateField(market, "endDate"),
        sourceMetadata: {
          adapter: "PREDICTION_MARKET",
          query,
          source: isPolymarketMarkets ? "polymarket_markets" : "prediction_markets",
          ...(isPolymarketMarkets && stringField(market, "id") ? { marketId: stringField(market, "id") } : {}),
          ...(isPolymarketMarkets && stringField(market, "conditionId") ? { conditionId: stringField(market, "conditionId") } : {}),
          ...(isPolymarketMarkets && (stringField(market, "questionID") ?? stringField(market, "questionId"))
            ? { questionId: stringField(market, "questionID") ?? stringField(market, "questionId") }
            : {}),
          ...(outcomes.length > 0 ? { outcomes } : {}),
          ...(outcomePrices.length > 0 ? { outcomePrices } : {}),
          ...(volume === undefined ? {} : { volume }),
          ...(liquidity === undefined ? {} : { liquidity }),
          ...(active === undefined ? {} : { active }),
          ...(closed === undefined ? {} : { closed }),
          ...(archived === undefined ? {} : { archived })
        }
      }
    ];
  });
}

function parsePolymarketEventObservations(parsed: unknown, query: string | undefined): RawObservation[] {
  const events = Array.isArray(parsed) ? recordArrayValue(parsed) : recordArrayValue(objectValue(parsed)?.events);
  return events.flatMap((event) => {
    const title = stringField(event, "title") ?? stringField(event, "question");
    if (!title) return [];
    const slug = stringField(event, "slug");
    const volume = flexibleNumberField(event, "volume");
    const liquidity = flexibleNumberField(event, "liquidity");
    const markets = recordArrayValue(event.markets);
    const marketSummaries = markets
      .map((market) => {
        const question = stringField(market, "question") ?? stringField(market, "title");
        const outcomes = arrayStringField(market, "outcomes");
        const prices = numericArrayField(market, "outcomePrices");
        const outcomeSummary =
          outcomes.length > 0
            ? outcomes.map((outcome, index) => `${outcome}${prices[index] === undefined ? "" : ` ${prices[index]}`}`).join(", ")
            : "";
        return contentFromParts([question, outcomeSummary]);
      })
      .filter(Boolean);

    return [
      {
        title: `Polymarket: ${title}`,
        content: contentFromParts([
          stringField(event, "description") ?? title,
          markets.length > 0 ? `Markets: ${markets.length}` : undefined,
          marketSummaries.length > 0 ? marketSummaries.join(" | ") : undefined,
          volume === undefined ? undefined : `Volume: ${volume}`,
          liquidity === undefined ? undefined : `Liquidity: ${liquidity}`
        ]),
        url: stringField(event, "url") ?? (slug ? `https://polymarket.com/event/${slug}` : undefined),
        publishedAt: dateField(event, "endDate"),
        sourceMetadata: {
          adapter: "PREDICTION_MARKET",
          query,
          source: "polymarket_events",
          ...(stringField(event, "id") ? { eventId: stringField(event, "id") } : {}),
          marketCount: markets.length,
          ...(volume === undefined ? {} : { volume }),
          ...(liquidity === undefined ? {} : { liquidity })
        }
      }
    ];
  });
}

function parsePlatformObservations(kind: ObservationSourceKind, text: string, query: string | undefined, sourceAdapter?: string) {
  if (kind === "GITHUB") return parseGithubSearchObservations(text, query);
  if (kind === "HUGGING_FACE") return parseHuggingFaceModelObservations(text, query);
  if (kind === "GDELT") return parseGdeltArticleObservations(text, query);
  if (kind === "PREDICTION_MARKET") return parsePredictionMarketObservations(text, query, sourceAdapter);
  return [];
}

async function fetchPlatformQueryObservations(
  kind: ObservationSourceKind,
  source: AdapterSourceConfig,
  fetchText: (url: string) => Promise<string>
): Promise<RawObservation[]> {
  const urls = platformQueryUrls(kind, source);
  let firstError: unknown;
  let successfulFetchCount = 0;
  const observations: RawObservation[] = [];

  for (const item of urls) {
    try {
      const parsedObservations = parsePlatformObservations(kind, await fetchText(item.url), item.query, source.adapter);
      successfulFetchCount += 1;
      observations.push(...parsedObservations);
    } catch (error) {
      firstError ??= error;
    }
  }

  if (observations.length > 0 || urls.length === 0 || successfulFetchCount > 0) return observations;

  const reason = firstError instanceof Error ? firstError.message : String(firstError);
  throw new Error(`All ${urls.length} ${kind} query fetches failed for ${source.name}: ${reason}`);
}

function credentialEnvName(ref: string | undefined, suffix: string) {
  const normalized = ref?.trim().replaceAll(/[^a-zA-Z0-9_]/g, "_").toUpperCase();
  return normalized ? `${normalized}_${suffix}` : "";
}

function xBearerToken(source: AdapterSourceConfig, env: Record<string, string | undefined>) {
  const name = credentialEnvName(source.credentialRef, "BEARER_TOKEN");
  return name ? env[name]?.trim() ?? "" : "";
}

function xRecentSearchUrl(query: string) {
  return [
    `https://api.x.com/2/tweets/search/recent?query=${encodeURIComponent(query)}`,
    "max_results=10",
    "tweet.fields=created_at,author_id,lang,public_metrics,possibly_sensitive",
    "expansions=author_id",
    "user.fields=username,name"
  ].join("&");
}

function redactSecret(message: string, secret: string) {
  return secret ? message.replaceAll(secret, "[redacted]") : message;
}

function parseXRecentSearchObservations(body: unknown, query: string): RawObservation[] {
  const parsed = objectValue(body);
  const posts = recordArrayValue(parsed?.data);
  const includes = objectValue(parsed?.includes);
  const users = new Map(recordArrayValue(includes?.users).flatMap((user) => {
    const id = stringField(user, "id");
    return id ? [[id, user] as const] : [];
  }));

  return posts.flatMap((post) => {
    const id = stringField(post, "id");
    const text = stringField(post, "text");
    if (!id || !text) return [];
    const authorId = stringField(post, "author_id");
    const user = authorId ? users.get(authorId) : undefined;
    const username = user ? stringField(user, "username") : undefined;
    const metrics = objectValue(post.public_metrics);
    const retweets = metrics ? numberField(metrics, "retweet_count") : undefined;
    const replies = metrics ? numberField(metrics, "reply_count") : undefined;
    const likes = metrics ? numberField(metrics, "like_count") : undefined;
    const quotes = metrics ? numberField(metrics, "quote_count") : undefined;
    const publishedAt = dateField(post, "created_at");

    return [
      {
        title: `X: ${text}`,
        content: contentFromParts([
          text,
          username ? `@${username}` : undefined,
          likes === undefined ? undefined : `Likes: ${likes}`,
          retweets === undefined ? undefined : `Reposts: ${retweets}`,
          replies === undefined ? undefined : `Replies: ${replies}`,
          quotes === undefined ? undefined : `Quotes: ${quotes}`
        ]),
        url: username ? `https://x.com/${username}/status/${id}` : `https://x.com/i/web/status/${id}`,
        author: username,
        publishedAt,
        sourceMetadata: {
          adapter: "SOCIAL",
          query,
          source: "x_recent_search",
          tweetId: id,
          ...(authorId ? { authorId } : {}),
          ...(username ? { username } : {}),
          ...(stringField(post, "lang") ? { lang: stringField(post, "lang") } : {}),
          ...(booleanField(post, "possibly_sensitive") === undefined
            ? {}
            : { possiblySensitive: booleanField(post, "possibly_sensitive") }),
          ...(metrics ? { publicMetrics: metrics } : {})
        }
      }
    ];
  });
}

async function fetchXRecentSearchObservations(source: AdapterSourceConfig, dependencies: AdapterDependencies): Promise<RawObservation[]> {
  const token = xBearerToken(source, dependencies.env ?? process.env);
  if (!token) return [];
  const queries = source.queries?.filter(Boolean) ?? [];
  if (queries.length === 0) return [];
  const fetcher = dependencies.fetchImpl ?? fetch;
  const observations: RawObservation[] = [];

  for (const query of queries) {
    const url = xRecentSearchUrl(query);
    let response: Response;
    try {
      response = await fetcher(url, {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json"
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`X recent search failed: ${redactSecret(message, token)}`);
    }
    if (!response.ok) {
      throw new Error(`X recent search failed with status ${response.status}`);
    }
    observations.push(...parseXRecentSearchObservations(await response.json(), query));
  }

  return observations;
}

export function createSourceAdapter(kind: ObservationSourceKind, dependencies: AdapterDependencies = {}): SourceAdapter {
  const fetchText =
    dependencies.fetchText ??
    ((url: string) =>
      fetchTextWithFallback(url, {
        fetchImpl: dependencies.fetchImpl,
        fallbackFetchText: dependencies.fallbackFetchText,
        preferFallbackFetch: preferFallbackFetchForSource(dependencies)
      }));

  if (kind === "RSS") {
    return {
      kind,
      async fetch(source) {
        return fetchQueryRssObservations(source, fetchText);
      }
    };
  }

  if (kind === "GITHUB" || kind === "HUGGING_FACE" || kind === "GDELT" || kind === "PREDICTION_MARKET") {
    return {
      kind,
      async fetch(source) {
        return fetchPlatformQueryObservations(kind, source, fetchText);
      }
    };
  }

  if (kind === "WEB_PAGE") {
    return createFetchAdapter(kind, dependencies);
  }

  if (kind === "SOCIAL") {
    return {
      kind,
      async fetch(source) {
        if (source.adapter === "x_recent_search") {
          return fetchXRecentSearchObservations(source, dependencies);
        }
        if (!source.url) return [];
        return createFetchAdapter(kind, dependencies).fetch(source);
      }
    };
  }

  if (kind === "MANUAL") {
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
