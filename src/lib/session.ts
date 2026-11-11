import { randomToken, sha256Hex } from "./crypto";
import type { GitHubProfile } from "./github";
import type { User, UserRow } from "../types";

export const SESSION_COOKIE = "np_session";
export const OAUTH_STATE_COOKIE = "np_oauth_state";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    githubId: row.github_id,
    login: row.login,
    name: row.name,
    avatarUrl: row.avatar_url,
  };
}

/** GitHub 프로필을 users 테이블에 반영하고 로컬 사용자 행을 반환합니다. */
export async function upsertUser(db: D1Database, profile: GitHubProfile): Promise<User> {
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO users (github_id, login, name, avatar_url, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(github_id) DO UPDATE SET
         login = excluded.login,
         name = excluded.name,
         avatar_url = excluded.avatar_url,
         last_login_at = excluded.last_login_at`,
    )
    .bind(profile.id, profile.login, profile.name, profile.avatar_url, now, now)
    .run();

  const row = await db
    .prepare(
      `SELECT id, github_id, login, name, avatar_url
       FROM users WHERE github_id = ?`,
    )
    .bind(profile.id)
    .first<UserRow>();

  if (!row) throw new Error("Failed to upsert user");
  return mapUser(row);
}

/** 원문 토큰 대신 SHA-256 해시를 세션 ID로 저장합니다. */
export async function createSession(
  db: D1Database,
  userId: number,
): Promise<{ token: string; expiresAt: string }> {
  const token = randomToken(32);
  const sessionId = await sha256Hex(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString();

  await db
    .prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(sessionId, userId, now.toISOString(), expiresAt)
    .run();

  return { token, expiresAt };
}

export async function getSessionUser(db: D1Database, token: string): Promise<User | null> {
  const sessionId = await sha256Hex(token);
  const now = new Date().toISOString();

  const row = await db
    .prepare(
      `SELECT u.id, u.github_id, u.login, u.name, u.avatar_url
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?`,
    )
    .bind(sessionId, now)
    .first<UserRow>();

  return row ? mapUser(row) : null;
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  const sessionId = await sha256Hex(token);
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(sessionId).run();
}

export async function deleteExpiredSessions(db: D1Database): Promise<void> {
  await db
    .prepare("DELETE FROM sessions WHERE expires_at <= ?")
    .bind(new Date().toISOString())
    .run();
}
