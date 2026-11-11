import { Hono } from "hono";
import { jsonError, readJson } from "../lib/http";
import {
  LIMITS,
  normalizeSearchQuery,
  parseNoteCreate,
  parseNotePatch,
} from "../lib/validation";
import { checkOrigin, requireAuth } from "../middleware";
import type { AppEnv, NoteListRow, NoteRow } from "../types";

export const notesRoutes = new Hono<AppEnv>();

notesRoutes.use("*", checkOrigin);
notesRoutes.use("*", requireAuth);

function toNote(row: NoteRow) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toListItem(row: NoteListRow) {
  return {
    id: row.id,
    title: row.title,
    excerpt: row.excerpt,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validId(id: string): boolean {
  return id.length > 0 && id.length <= 64;
}

/** 최근 수정순 목록. 검색어가 있으면 제목+본문을 대소문자 구분 없이 필터링합니다. */
notesRoutes.get("/", async (c) => {
  const user = c.get("user");
  const query = normalizeSearchQuery(c.req.query("q"));

  const select = `SELECT id, title, substr(content, 1, 180) AS excerpt, pinned, created_at, updated_at
                  FROM notes
                  WHERE user_id = ?`;

  const statement = query
    ? c.env.DB.prepare(
        `${select}
         AND instr(lower(title || char(10) || content), lower(?)) > 0
         ORDER BY pinned DESC, updated_at DESC
         LIMIT ?`,
      ).bind(user.id, query, LIMITS.list)
    : c.env.DB.prepare(
        `${select}
         ORDER BY pinned DESC, updated_at DESC
         LIMIT ?`,
      ).bind(user.id, LIMITS.list);

  const { results } = await statement.all<NoteListRow>();
  return c.json({ notes: results.map(toListItem) });
});

notesRoutes.post("/", async (c) => {
  const parsed = parseNoteCreate(await readJson(c));
  if (!parsed.ok) {
    return jsonError(c, 400, parsed.error, parsed.message);
  }

  const user = c.get("user");
  const countRow = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM notes WHERE user_id = ?")
    .bind(user.id)
    .first<{ count: number }>();

  if ((countRow?.count ?? 0) >= LIMITS.notesPerUser) {
    return jsonError(
      c,
      422,
      "note_limit",
      `메모는 최대 ${LIMITS.notesPerUser.toLocaleString("ko-KR")}개까지 저장할 수 있습니다.`,
    );
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO notes (id, user_id, title, content, pinned, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`,
  )
    .bind(id, user.id, parsed.value.title, parsed.value.content, now, now)
    .run();

  return c.json(
    {
      note: {
        id,
        title: parsed.value.title,
        content: parsed.value.content,
        pinned: false,
        createdAt: now,
        updatedAt: now,
      },
    },
    201,
  );
});

notesRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  if (!validId(id)) return jsonError(c, 404, "not_found", "메모를 찾을 수 없습니다.");

  const row = await c.env.DB.prepare(
    `SELECT id, title, content, pinned, created_at, updated_at
     FROM notes WHERE id = ? AND user_id = ?`,
  )
    .bind(id, c.get("user").id)
    .first<NoteRow>();

  if (!row) return jsonError(c, 404, "not_found", "메모를 찾을 수 없습니다.");
  return c.json({ note: toNote(row) });
});

notesRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  if (!validId(id)) return jsonError(c, 404, "not_found", "메모를 찾을 수 없습니다.");

  const parsed = parseNotePatch(await readJson(c));
  if (!parsed.ok) {
    return jsonError(c, 400, parsed.error, parsed.message);
  }

  const sets: string[] = [];
  const values: (string | number)[] = [];

  if (parsed.value.title !== undefined) {
    sets.push("title = ?");
    values.push(parsed.value.title);
  }
  if (parsed.value.content !== undefined) {
    sets.push("content = ?");
    values.push(parsed.value.content);
  }
  if (parsed.value.pinned !== undefined) {
    sets.push("pinned = ?");
    values.push(parsed.value.pinned ? 1 : 0);
  }

  sets.push("updated_at = ?");
  values.push(new Date().toISOString());
  values.push(id, c.get("user").id);

  const result = await c.env.DB.prepare(
    `UPDATE notes SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`,
  )
    .bind(...values)
    .run();

  if (!result.meta.changes) {
    return jsonError(c, 404, "not_found", "메모를 찾을 수 없습니다.");
  }

  const row = await c.env.DB.prepare(
    `SELECT id, title, content, pinned, created_at, updated_at
     FROM notes WHERE id = ? AND user_id = ?`,
  )
    .bind(id, c.get("user").id)
    .first<NoteRow>();

  if (!row) return jsonError(c, 404, "not_found", "메모를 찾을 수 없습니다.");
  return c.json({ note: toNote(row) });
});

notesRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!validId(id)) return jsonError(c, 404, "not_found", "메모를 찾을 수 없습니다.");

  const result = await c.env.DB.prepare("DELETE FROM notes WHERE id = ? AND user_id = ?")
    .bind(id, c.get("user").id)
    .run();

  if (!result.meta.changes) {
    return jsonError(c, 404, "not_found", "메모를 찾을 수 없습니다.");
  }

  return c.body(null, 204);
});
