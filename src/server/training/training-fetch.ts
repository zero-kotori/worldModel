import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type DatasetFetchContext = {
  source: string;
  dataset: string;
  config: string;
  split: string;
};

export type FetchLike = (input: URL, init?: { signal?: AbortSignal }) => Promise<Response>;
export type ExecFileLike = (
  file: string,
  args?: readonly string[],
  options?: { maxBuffer?: number }
) => Promise<{ stdout: string }>;

export type FetchFallbackOptions = {
  attempts?: number;
  httpTimeoutMs?: number;
  platform?: NodeJS.Platform;
  fetchImpl?: FetchLike;
  execFileImpl?: ExecFileLike;
};

const JSON_MAX_BUFFER_BYTES = 20 * 1024 * 1024;
const RAW_TEXT_MAX_BUFFER_BYTES = 128 * 1024 * 1024;

function messageFrom(error: unknown) {
  return error instanceof Error && error.message ? error.message : String(error);
}

export function createDatasetFetchError(context: DatasetFetchContext, cause: unknown) {
  return new Error(
    `Failed to fetch training dataset ${context.source} (${context.dataset}, config=${context.config}, split=${context.split}): ${messageFrom(cause)}`,
    { cause }
  );
}

async function fetchViaHttp(url: URL, fetchImpl: FetchLike, attempts: number, timeoutMs: number) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
      }
      return response.json();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

async function fetchTextViaHttp(url: URL, fetchImpl: FetchLike, attempts: number, timeoutMs: number) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
      }
      return response.text();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

async function fetchViaCurl(url: URL, execFileImpl: ExecFileLike) {
  const { stdout } = await execFileImpl("curl.exe", ["-L", "--fail", "--silent", "--show-error", url.toString()], {
    maxBuffer: JSON_MAX_BUFFER_BYTES
  });
  return JSON.parse(stdout);
}

async function fetchTextViaCurl(url: URL, execFileImpl: ExecFileLike) {
  const { stdout } = await execFileImpl("curl.exe", ["-L", "--fail", "--silent", "--show-error", url.toString()], {
    maxBuffer: RAW_TEXT_MAX_BUFFER_BYTES
  });
  return stdout;
}

async function fetchViaPowerShell(url: URL, execFileImpl: ExecFileLike) {
  const escapedUrl = url.toString().replaceAll("'", "''");
  const command = `(Invoke-WebRequest -Uri '${escapedUrl}' -UseBasicParsing -TimeoutSec 60).Content`;
  const { stdout } = await execFileImpl("powershell", ["-NoProfile", "-Command", command], {
    maxBuffer: JSON_MAX_BUFFER_BYTES
  });
  return JSON.parse(stdout);
}

async function fetchTextViaPowerShell(url: URL, execFileImpl: ExecFileLike) {
  const escapedUrl = url.toString().replaceAll("'", "''");
  const command = `(Invoke-WebRequest -Uri '${escapedUrl}' -UseBasicParsing -TimeoutSec 120).Content`;
  const { stdout } = await execFileImpl("powershell", ["-NoProfile", "-Command", command], {
    maxBuffer: RAW_TEXT_MAX_BUFFER_BYTES
  });
  return stdout;
}

export async function fetchJsonWithFallback(url: URL, options: FetchFallbackOptions = {}) {
  const attempts = options.attempts ?? 3;
  const httpTimeoutMs = options.httpTimeoutMs ?? 30000;
  const platform = options.platform ?? process.platform;
  const fetchImpl = options.fetchImpl ?? fetch;
  const execFileImpl = options.execFileImpl ?? execFileAsync;
  let lastError: unknown;

  try {
    return await fetchViaHttp(url, fetchImpl, attempts, httpTimeoutMs);
  } catch (error) {
    lastError = error;
  }

  if (platform === "win32") {
    try {
      return await fetchViaCurl(url, execFileImpl);
    } catch (error) {
      lastError = error;
    }
    try {
      return await fetchViaPowerShell(url, execFileImpl);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

export async function fetchTextWithFallback(url: URL, options: FetchFallbackOptions = {}) {
  const attempts = options.attempts ?? 3;
  const httpTimeoutMs = options.httpTimeoutMs ?? 30000;
  const platform = options.platform ?? process.platform;
  const fetchImpl = options.fetchImpl ?? fetch;
  const execFileImpl = options.execFileImpl ?? execFileAsync;
  let lastError: unknown;

  try {
    return await fetchTextViaHttp(url, fetchImpl, attempts, httpTimeoutMs);
  } catch (error) {
    lastError = error;
  }

  if (platform === "win32") {
    try {
      return await fetchTextViaCurl(url, execFileImpl);
    } catch (error) {
      lastError = error;
    }
    try {
      return await fetchTextViaPowerShell(url, execFileImpl);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}
