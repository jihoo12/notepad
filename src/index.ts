import { Hono } from "hono";
import { authRoutes } from "./routes/auth";
import { notesRoutes } from "./routes/notes";
import { requireAuth } from "./middleware";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  c.header("Cross-Origin-Opener-Policy", "same-origin");
  c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  c.header("Cache-Control", "no-store");
});

app.get("/api/health", async (c) => {
  try {
    await c.env.DB.prepare("SELECT 1").first();
    return c.json({ ok: true, service: "notepad", db: "up", time: new Date().toISOString() });
  } catch {
    return c.json({ ok: false, service: "notepad", db: "down" }, 503);
  }
});

app.get("/api/me", requireAuth, (c) => {
  const { id, login, name, avatarUrl } = c.get("user");
  return c.json({ user: { id, login, name, avatarUrl } });
});

app.route("/api/notes", notesRoutes);
app.route("/auth", authRoutes);

app.notFound((c) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/api/") || path.startsWith("/auth/")) {
    return c.json({ error: "not_found", message: "요청한 경로를 찾을 수 없습니다." }, 404);
  }
  return c.text("Not Found", 404);
});

app.onError((error, c) => {
  console.error("[worker] unhandled error", error);
  return c.json(
    { error: "internal", message: "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." },
    500,
  );
});

export default app;
