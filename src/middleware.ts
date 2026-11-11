import { createMiddleware } from "hono/factory";
import { deleteCookie, getCookie } from "hono/cookie";
import { getSessionUser, SESSION_COOKIE } from "./lib/session";
import type { AppEnv } from "./types";

/**
 * 상태 변경 요청의 Origin이 현재 오리진과 같은지 확인합니다.
 * SameSite=Lax 쿠키와 함께 CSRF 방어 계층을 이룹니다.
 */
export const checkOrigin = createMiddleware<AppEnv>(async (c, next) => {
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const origin = c.req.header("Origin");
    if (origin) {
      let sameOrigin = false;
      try {
        sameOrigin = new URL(origin).origin === new URL(c.req.url).origin;
      } catch {
        sameOrigin = false;
      }
      if (!sameOrigin) {
        return c.json(
          { error: "csrf", message: "요청 출처를 확인할 수 없습니다." },
          403,
        );
      }
    }
  }
  await next();
});

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    return c.json({ error: "unauthorized", message: "로그인이 필요합니다." }, 401);
  }

  const user = await getSessionUser(c.env.DB, token);
  if (!user) {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.json(
      { error: "session_expired", message: "세션이 만료되었습니다. 다시 로그인해 주세요." },
      401,
    );
  }

  c.set("user", user);
  await next();
});
