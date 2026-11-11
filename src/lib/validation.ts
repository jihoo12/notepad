export const LIMITS = {
  title: 200,
  content: 100_000,
  notesPerUser: 1_000,
  list: 200,
  search: 100,
} as const;

export type Parsed<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(error: string, message: string): Parsed<never> {
  return { ok: false, error, message };
}

function validateTitle(value: unknown): Parsed<string> {
  if (typeof value !== "string") {
    return fail("invalid_title", "제목은 문자열이어야 합니다.");
  }
  if (value.length > LIMITS.title) {
    return fail("title_too_long", `제목은 ${LIMITS.title}자까지 입력할 수 있습니다.`);
  }
  return { ok: true, value };
}

function validateContent(value: unknown): Parsed<string> {
  if (typeof value !== "string") {
    return fail("invalid_content", "본문은 문자열이어야 합니다.");
  }
  if (value.length > LIMITS.content) {
    return fail(
      "content_too_long",
      `본문은 ${LIMITS.content.toLocaleString("ko-KR")}자까지 입력할 수 있습니다.`,
    );
  }
  return { ok: true, value };
}

export interface NoteCreateInput {
  title: string;
  content: string;
}

export function parseNoteCreate(input: unknown): Parsed<NoteCreateInput> {
  if (!isRecord(input)) {
    return fail("invalid_body", "요청 본문이 올바르지 않습니다.");
  }

  const title = validateTitle(input.title ?? "");
  if (!title.ok) return title;

  const content = validateContent(input.content ?? "");
  if (!content.ok) return content;

  return { ok: true, value: { title: title.value, content: content.value } };
}

export interface NotePatchInput {
  title?: string;
  content?: string;
  pinned?: boolean;
}

export function parseNotePatch(input: unknown): Parsed<NotePatchInput> {
  if (!isRecord(input)) {
    return fail("invalid_body", "요청 본문이 올바르지 않습니다.");
  }

  const patch: NotePatchInput = {};

  if ("title" in input) {
    const title = validateTitle(input.title);
    if (!title.ok) return title;
    patch.title = title.value;
  }

  if ("content" in input) {
    const content = validateContent(input.content);
    if (!content.ok) return content;
    patch.content = content.value;
  }

  if ("pinned" in input) {
    if (typeof input.pinned !== "boolean") {
      return fail("invalid_pinned", "고정 값은 boolean이어야 합니다.");
    }
    patch.pinned = input.pinned;
  }

  if (Object.keys(patch).length === 0) {
    return fail("empty_patch", "변경할 내용이 없습니다.");
  }

  return { ok: true, value: patch };
}

export function normalizeSearchQuery(value: string | undefined): string {
  return (value ?? "").trim().slice(0, LIMITS.search);
}
