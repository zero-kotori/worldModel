import { NextResponse, type NextRequest } from "next/server";

const headerNames = {
  timestamp: "x-worldmodel-timestamp",
  bodyHash: "x-worldmodel-body-sha256",
  signature: "x-worldmodel-signature"
};

function base64Url(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sign(secret: string, payload: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return base64Url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)));
}

async function verifyRequest(request: NextRequest) {
  const secret = process.env.WORLDMODEL_PROXY_SECRET;
  if (!secret || secret.length < 16) return false;

  const timestamp = request.headers.get(headerNames.timestamp);
  const bodyHash = request.headers.get(headerNames.bodyHash);
  const signature = request.headers.get(headerNames.signature);
  if (!timestamp || !bodyHash || !signature) return false;

  const timestampSeconds = Number(timestamp);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(timestampSeconds) || Math.abs(nowSeconds - timestampSeconds) > 300) return false;

  const path = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  const payload = [request.method.toUpperCase(), path, timestamp, bodyHash].join("\n");
  return signature === (await sign(secret, payload));
}

export async function middleware(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  if (await verifyRequest(request)) {
    return NextResponse.next();
  }

  return new NextResponse("Unauthorized", { status: 401 });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt).*)"]
};
