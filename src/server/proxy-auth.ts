import crypto from "node:crypto";

export const proxyHeaderNames = {
  timestamp: "x-worldmodel-timestamp",
  bodyHash: "x-worldmodel-body-sha256",
  signature: "x-worldmodel-signature"
} as const;

export type ProxySignatureInput = {
  secret: string;
  method: string;
  path: string;
  timestamp: string;
  bodyHash: string;
};

export type ProxyVerificationInput = {
  secret: string;
  method: string;
  path: string;
  bodyHash: string;
  headers: Headers;
  nowSeconds?: number;
  maxAgeSeconds?: number;
};

export type ProxyVerificationResult =
  | { ok: true }
  | { ok: false; reason: "MISSING" | "TIMESTAMP" | "BODY_HASH" | "SIGNATURE" | "SECRET" };

export function createBodyHash(body: string | ArrayBuffer | Uint8Array) {
  const hash = crypto.createHash("sha256");
  if (typeof body === "string") {
    hash.update(body);
  } else if (body instanceof ArrayBuffer) {
    hash.update(new Uint8Array(body));
  } else {
    hash.update(body);
  }
  return hash.digest("base64url");
}

function canonicalPayload(input: ProxySignatureInput) {
  return [input.method.toUpperCase(), input.path, input.timestamp, input.bodyHash].join("\n");
}

export function createProxySignature(input: ProxySignatureInput) {
  return crypto.createHmac("sha256", input.secret).update(canonicalPayload(input)).digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

export function verifyProxySignature(input: ProxyVerificationInput): ProxyVerificationResult {
  if (!input.secret || input.secret.length < 16) {
    return { ok: false, reason: "SECRET" };
  }

  const timestamp = input.headers.get(proxyHeaderNames.timestamp);
  const headerBodyHash = input.headers.get(proxyHeaderNames.bodyHash);
  const signature = input.headers.get(proxyHeaderNames.signature);

  if (!timestamp || !headerBodyHash || !signature) {
    return { ok: false, reason: "MISSING" };
  }
  if (headerBodyHash !== input.bodyHash) {
    return { ok: false, reason: "BODY_HASH" };
  }

  const timestampSeconds = Number(timestamp);
  const nowSeconds = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxAgeSeconds = input.maxAgeSeconds ?? 300;
  if (!Number.isFinite(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > maxAgeSeconds) {
    return { ok: false, reason: "TIMESTAMP" };
  }

  const expected = createProxySignature({ ...input, timestamp });
  if (!safeEqual(signature, expected)) {
    return { ok: false, reason: "SIGNATURE" };
  }

  return { ok: true };
}

export function getProxySecret() {
  const secret = process.env.WORLDMODEL_PROXY_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("WORLDMODEL_PROXY_SECRET must be configured with at least 16 characters.");
  }
  return secret;
}

export function pathWithSearch(url: string | URL) {
  const parsed = typeof url === "string" ? new URL(url) : url;
  return `${parsed.pathname}${parsed.search}`;
}
