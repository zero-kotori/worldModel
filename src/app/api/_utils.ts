import { ZodError } from "zod";

export function jsonOk(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

export function jsonError(error: unknown) {
  if (error instanceof ZodError) {
    return Response.json({ error: "Validation failed", issues: error.issues }, { status: 400 });
  }
  if (error instanceof Error) {
    return Response.json({ error: error.message }, { status: 400 });
  }
  return Response.json({ error: "Unknown error" }, { status: 500 });
}

export async function readJson<T>(request: Request): Promise<T> {
  const text = await request.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}
