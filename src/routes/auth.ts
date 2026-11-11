import { Hono } from "hono";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { exchangeCode, fetchGitHubProfile, GitHubAuthError } from "../lib/github";
import { randomToken, timingSafeEqual } from "../lib/crypto";
import {
  createSession,
  deleteExpiredSessions,
  deleteSession,
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  upsertUser,
} from "../lib/session";
import { checkOrigin } from "../middleware";
import type { AppEnv } from "../types";

export const authRoutes = new Hono<AppEnv>();

function isHttps(url: string): boolean {
  return new URL(url).protocol === "https:";
}

function oauthRedirectUri(url: string, configured?: string): string {
  return configured?.trim() || `${new URL(url).origin}/auth/callback`;
}

function fail(c: Context<AppEnv>, reason: string) {
  return c.redirect(`/?auth_error=${encodeURIComponent(reason)}`, 302);
}

/** 1단계: state를 발급하고 GitHub 인증 화면으로 보냅니다. */
authRoutes.get("/login", (c) => {
  const clientId = c.env.GITHUB_CLIENT_ID;
  const clientSecret = c.env.GITHUB_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("[auth] GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET is not configured");
    return fail(c, "config");
  }

  const state = randomToken(24);
  setCookie(c, OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: isHttps(c.req.url),
    sameSite: "Lax",
    path: "/",
    maxAge: 10 * 60,
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: oauthRedirectUri(c.req.url, c.env.GITHUB_REDIRECT_URI),
    scope: "read:user",
    state,
  });

  return c.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`, 302);
});

/** 2단계: state 검증 → code 교환 → 프로필 조회 → 세션 생성. */
authRoutes.get("/callback", async (c) => {
  const state = c.req.query("state");
  const code = c.req.query("code");
  const storedState = getCookie(c, OAUTH_STATE_COOKIE);
  deleteCookie(c, OAUTH_STATE_COOKIE, { path: "/" });

  if (c.req.query("error")) {
    return fail(c, "denied");
  }

  if (!state || !storedState || !timingSafeEqual(state, storedState)) {
    console.error("[auth] OAuth state validation failed");
    return fail(c, "state");
  }

  if (!code) {
    console.error("[auth] OAuth callback is missing code");
    return fail(c, "state");
  }

  const clientId = c.env.GITHUB_CLIENT_ID;
  const clientSecret = c.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error("[auth] OAuth credentials are not configured");
    return fail(c, "config");
  }

  try {
    const accessToken = await exchangeCode(
      clientId,
      clientSecret,
      code,
      oauthRedirectUri(c.req.url, c.env.GITHUB_REDIRECT_URI),
    );
    const profile = await fetchGitHubProfile(accessToken);
    const user = await upsertUser(c.env.DB, profile);
    const { token } = await createSession(c.env.DB, user.id);

    try {
      await deleteExpiredSessions(c.env.DB);
    } catch (cleanupError) {
      console.error("[auth] expired session cleanup failed", cleanupError);
    }

    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      secure: isHttps(c.req.url),
      sameSite: "Lax",
      path: "/",
      maxAge: SESSION_TTL_SECONDS,
    });

    return c.redirect("/", 302);
  } catch (error) {
    if (error instanceof GitHubAuthError) {
      console.error(`[auth] GitHub ${error.stage} failed: ${error.message}`);
      return fail(c, error.stage === "exchange" ? "exchange" : "profile");
    }
    console.error("[auth] unexpected callback error", error);
    return fail(c, "server");
  }
});

/** 로그아웃: 서버 세션과 쿠키를 모두 제거합니다. */
authRoutes.post("/logout", checkOrigin, async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await deleteSession(c.env.DB, token);
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.redirect("/", 302);
});

/**
 * 로컬 개발 전용 로그인. `DEV_LOGIN=true` 이고 호스트가 localhost일 때만 동작합니다.
 * 운영 환경에서는 404를 반환합니다.
 */
authRoutes.get("/dev", async (c) => {
  const hostname = new URL(c.req.url).hostname;
  const isLocalHost =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]";

  if (c.env.DEV_LOGIN !== "true" || !isLocalHost) {
    return c.notFound();
  }

  const requested = (c.req.query("login") ?? "").trim();
  const login = /^[A-Za-z0-9-]{1,39}$/.test(requested) ? requested : "dev-user";

  let hash = 2166136261;
  for (const char of login) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  const githubId = -1_000_000 - (hash >>> 0);

  const user = await upsertUser(c.env.DB, {
    id: githubId,
    login,
    name: "개발 사용자",
    avatar_url: null,
  });
  const { token } = await createSession(c.env.DB, user.id);

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isHttps(c.req.url),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });

  return c.redirect("/", 302);
});
