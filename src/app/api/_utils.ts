import { ZodError } from "zod";
import { shouldBypassProxyAuth } from "@/server/access-mode";
import { createBodyHash, getProxySecret, pathWithSearch, verifyProxySignature } from "@/server/proxy-auth";

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

export function jsonOk(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

export function jsonError(error: unknown) {
  if (error instanceof ZodError) {
    return Response.json({ error: "Validation failed", issues: error.issues }, { status: 400 });
  }
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof Error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  return Response.json({ error: "Unknown error" }, { status: 500 });
}

export async function readJson<T>(request: Request): Promise<T> {
  const text = await request.text();
  verifyApiRequest(request, text);
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

export function verifyApiRequest(request: Request, body = "") {
  if (shouldBypassProxyAuth()) return;

  const result = verifyProxySignature({
    secret: getProxySecret(),
    method: request.method,
    path: pathWithSearch(request.url),
    bodyHash: createBodyHash(body),
    headers: request.headers
  });

  if (!result.ok) {
    throw new HttpError("Unauthorized", 401);
  }
}
