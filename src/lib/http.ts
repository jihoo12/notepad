import type { Context } from "hono";

export type ErrorStatus = 400 | 401 | 403 | 404 | 422 | 500;

export function jsonError(
  c: Context,
  status: ErrorStatus,
  error: string,
  message: string,
) {
  return c.json({ error, message }, status);
}

export async function readJson(c: Context): Promise<unknown | undefined> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}
