const RESTORE_PATH = "/api/automation/worker/restore";
const DEFAULT_PORT = "3100";
const DEFAULT_STARTUP_DELAY_MS = 500;
const DEFAULT_RETRY_DELAY_MS = 1_000;
const DEFAULT_MAX_ATTEMPTS = 5;
const MIN_PROXY_SECRET_LENGTH = 16;
const proxyHeaderNames = {
  timestamp: "x-worldmodel-timestamp",
  bodyHash: "x-worldmodel-body-sha256",
  signature: "x-worldmodel-signature"
} as const;

type StartupRestoreEnv = NodeJS.ProcessEnv;

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function base64Url(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sha256Base64Url(body: string) {
  return base64Url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)));
}

async function hmacSha256Base64Url(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return base64Url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

function pathWithSearch(url: string) {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

export function startupRestoreUrl(env: StartupRestoreEnv = process.env) {
  const configured = env.WORLDMODEL_STARTUP_RESTORE_URL?.trim();
  if (configured) return configured;
  const port = env.PORT?.trim() || DEFAULT_PORT;
  return `http://127.0.0.1:${port}${RESTORE_PATH}`;
}

export function shouldScheduleStartupRestore(env: StartupRestoreEnv = process.env) {
  if (env.NEXT_RUNTIME !== "nodejs") return false;
  if (env.WORLDMODEL_STARTUP_RESTORE === "off") return false;
  if (!env.WORLDMODEL_DATABASE_URL) return false;
  if (env.WORLDMODEL_ACCESS_MODE === "standalone") return true;
  return (env.WORLDMODEL_PROXY_SECRET?.length ?? 0) >= MIN_PROXY_SECRET_LENGTH;
}

async function startupRestoreHeaders(url: string, env: StartupRestoreEnv = process.env) {
  if (env.WORLDMODEL_ACCESS_MODE === "standalone") return undefined;

  const secret = env.WORLDMODEL_PROXY_SECRET;
  if (!secret || secret.length < MIN_PROXY_SECRET_LENGTH) return undefined;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const bodyHash = await sha256Base64Url("");
  const payload = ["POST", pathWithSearch(url), timestamp, bodyHash].join("\n");
  const signature = await hmacSha256Base64Url(secret, payload);
  return {
    [proxyHeaderNames.timestamp]: timestamp,
    [proxyHeaderNames.bodyHash]: bodyHash,
    [proxyHeaderNames.signature]: signature
  };
}

async function postStartupRestore(url: string, attempts: number, retryDelayMs: number) {
  let lastError = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const headers = await startupRestoreHeaders(url);
      const response = await fetch(url, headers ? { method: "POST", headers } : { method: "POST" });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }
  console.error(`自动化守护进程启动恢复失败：${lastError}`);
}

export function register() {
  if (!shouldScheduleStartupRestore()) return;

  const url = startupRestoreUrl();
  const delayMs = positiveInt(process.env.WORLDMODEL_STARTUP_RESTORE_DELAY_MS, DEFAULT_STARTUP_DELAY_MS);
  const retryDelayMs = positiveInt(process.env.WORLDMODEL_STARTUP_RESTORE_RETRY_DELAY_MS, DEFAULT_RETRY_DELAY_MS);
  const attempts = positiveInt(process.env.WORLDMODEL_STARTUP_RESTORE_ATTEMPTS, DEFAULT_MAX_ATTEMPTS);
  setTimeout(() => {
    void postStartupRestore(url, attempts, retryDelayMs);
  }, delayMs);
}
