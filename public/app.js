/* global window, document, fetch, localStorage, matchMedia, URLSearchParams, AbortController */

const $ = (id) => document.getElementById(id);

const els = {
  loginView: $("login-view"),
  loginError: $("login-error"),
  loginErrorText: $("login-error-text"),

  appView: $("app-view"),
  sidebar: $("sidebar"),
  scrim: $("scrim"),
  themeToggle: $("theme-toggle"),
  newNote: $("new-note"),
  mobileNew: $("mobile-new"),
  openSidebar: $("open-sidebar"),
  backToList: $("back-to-list"),
  search: $("search"),
  noteCount: $("note-count"),
  listSort: $("list-sort"),
  noteList: $("note-list"),
  listPlaceholder: $("list-placeholder"),
  placeholderTitle: $("placeholder-title"),
  placeholderSub: $("placeholder-sub"),
  placeholderAction: $("placeholder-action"),

  userAvatar: $("user-avatar"),
  userAvatarFallback: $("user-avatar-fallback"),
  userName: $("user-name"),
  userLogin: $("user-login"),
  logoutForm: document.querySelector(".logout-form"),

  editorView: $("editor-view"),
  emptyView: $("empty-view"),
  emptyNew: $("empty-new"),
  titleInput: $("note-title"),
  contentInput: $("note-content"),
  noteDate: $("note-date"),
  noteChars: $("note-chars"),
  noteLines: $("note-lines"),
  cursorInfo: $("cursor-info"),
  pinNote: $("pin-note"),
  deleteNote: $("delete-note"),
  saveStatus: $("save-status"),
  saveLabel: $("save-label"),

  confirmDialog: $("confirm-dialog"),
  toast: $("toast"),
  toastText: $("toast-text"),
};

const MOBILE_QUERY = matchMedia("(max-width: 860px)");
const SVG_NS = "http://www.w3.org/2000/svg";

const AUTH_ERRORS = {
  state: "로그인 요청이 만료되었습니다. 다시 시도해 주세요.",
  denied: "GitHub 로그인이 취소되었습니다.",
  exchange: "GitHub 인증에 실패했습니다. 잠시 후 다시 시도해 주세요.",
  profile: "GitHub 프로필을 불러오지 못했습니다. 다시 시도해 주세요.",
  config: "로그인 설정이 완료되지 않았습니다. 운영자에게 문의해 주세요.",
  server: "로그인 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  expired: "세션이 만료되었습니다. 다시 로그인해 주세요.",
  network: "서버에 연결할 수 없습니다. 네트워크를 확인한 뒤 새로고침해 주세요.",
};

const SAVE_LABELS = {
  saved: "저장됨",
  pending: "저장 대기",
  saving: "저장 중…",
  error: "저장 실패 · 다시 시도",
};

const SKELETON_HTML = Array.from({ length: 4 })
  .map(
    () =>
      '<div class="note-skeleton" aria-hidden="true">' +
      '<span class="sk-line sk-1"></span>' +
      '<span class="sk-line sk-2"></span>' +
      '<span class="sk-line"></span>' +
      "</div>",
  )
  .join("");

const state = {
  user: null,
  notes: [],
  current: null,
  query: "",
  loading: false,
  dirty: false,
  saveState: null,
  saveTimer: null,
  noteRequest: 0,
  creating: false,
  sessionHandled: false,
};

const fullDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

let saveChain = Promise.resolve(true);
let toastTimer = null;
let searchTimer = null;
let listController = null;

/* --------------------------------------------------------------------------
   Utilities
   -------------------------------------------------------------------------- */

function isMac() {
  const platform = navigator.userAgentData?.platform || navigator.platform || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

function setupShortcutLabels() {
  const mac = isMac();
  document.querySelectorAll("[data-mod]").forEach((el) => {
    el.textContent = mac ? "⌘" : "Ctrl";
  });
  document.querySelectorAll("[data-alt]").forEach((el) => {
    el.textContent = mac ? "⌥" : "Alt";
  });
}

function createIcon(name, className) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", className || "icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `#${name}`);
  svg.appendChild(use);
  return svg;
}

function displayTitle(title) {
  return title.trim() || "제목 없음";
}

function excerptOf(text) {
  return text.replace(/\s+/g, " ").trim().slice(0, 180);
}

function timeAgo(iso) {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return "";
  const diff = Math.floor((Date.now() - time) / 1000);

  if (diff < 60) return "방금 전";
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 172800) return "어제";
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}일 전`;

  const date = new Date(iso);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat("ko-KR", {
    year: sameYear ? undefined : "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function formatFullDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return fullDateFormatter.format(date);
}

function sortNotes() {
  state.notes.sort((a, b) => {
    const pinned = Number(b.pinned) - Number(a.pinned);
    if (pinned !== 0) return pinned;
    return String(b.updatedAt).localeCompare(String(a.updatedAt));
  });
}

function showToast(message) {
  els.toastText.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    els.toast.hidden = true;
  }, 4200);
}

function setSaveStatus(status) {
  if (state.saveState === status) return;
  state.saveState = status;
  els.saveStatus.className = `save-status is-${status}`;
  els.saveLabel.textContent = SAVE_LABELS[status] || SAVE_LABELS.saved;
  els.saveStatus.title = status === "error" ? "클릭하여 다시 저장" : "지금 저장";
}

/* --------------------------------------------------------------------------
   API
   -------------------------------------------------------------------------- */

async function api(path, options = {}) {
  const { skipAuthRedirect = false, ...init } = options;
  const headers = {
    Accept: "application/json",
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...(init.headers || {}),
  };

  let response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    const networkError = new Error("네트워크 오류");
    networkError.cause = error;
    throw networkError;
  }

  if (response.status === 401) {
    if (!skipAuthRedirect) handleSessionExpired();
    const error = new Error("unauthorized");
    error.status = 401;
    throw error;
  }

  if (!response.ok) {
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const error = new Error(payload?.message || "요청을 처리하지 못했습니다.");
    error.status = response.status;
    error.code = payload?.error;
    throw error;
  }

  if (response.status === 204) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/* --------------------------------------------------------------------------
   Auth views
   -------------------------------------------------------------------------- */

function showLogin(reason) {
  state.user = null;
  state.current = null;
  state.notes = [];
  state.loading = false;
  closeSidebar();
  els.appView.hidden = true;
  els.loginView.hidden = false;
  els.appView.classList.remove("is-editing");
  document.title = "로그인 · 메모장";

  const message = reason ? AUTH_ERRORS[reason] : null;
  if (message) {
    els.loginErrorText.textContent = message;
    els.loginError.hidden = false;
  } else {
    els.loginError.hidden = true;
  }
}

function showApp() {
  els.loginView.hidden = true;
  els.appView.hidden = false;
  els.appView.classList.remove("is-editing");
  document.title = "메모장";

  const user = state.user;
  const name = (user.name || "").trim() || user.login;
  els.userName.textContent = name;
  els.userLogin.textContent = `@${user.login}`;

  const initial = Array.from(name)[0] || "?";
  els.userAvatarFallback.textContent = initial;

  if (user.avatarUrl) {
    els.userAvatar.src = user.avatarUrl;
    els.userAvatar.alt = `${name} 프로필 사진`;
    els.userAvatar.hidden = false;
    els.userAvatarFallback.hidden = true;
    els.userAvatar.onerror = () => {
      els.userAvatar.hidden = true;
      els.userAvatarFallback.hidden = false;
    };
  } else {
    els.userAvatar.hidden = true;
    els.userAvatarFallback.hidden = false;
  }

  renderEditor();
}

function handleSessionExpired() {
  if (state.sessionHandled) return;
  state.sessionHandled = true;
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  state.dirty = false;
  showLogin("expired");
}

/* --------------------------------------------------------------------------
   Theme
   -------------------------------------------------------------------------- */

function applyTheme(theme, persist) {
  document.documentElement.dataset.theme = theme;
  const nextLabel = theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환";
  els.themeToggle.setAttribute("aria-label", nextLabel);
  els.themeToggle.title = nextLabel;
  if (persist) {
    try {
      localStorage.setItem("notepad-theme", theme);
    } catch {
      /* 저장할 수 없는 환경은 무시합니다. */
    }
  }
}

function setupTheme() {
  const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  applyTheme(current, false);
  els.themeToggle.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next, true);
  });

  const media = matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener?.("change", (event) => {
    let stored = null;
    try {
      stored = localStorage.getItem("notepad-theme");
    } catch {
      stored = null;
    }
    if (!stored) applyTheme(event.matches ? "dark" : "light", false);
  });
}

/* --------------------------------------------------------------------------
   Sidebar / responsive
   -------------------------------------------------------------------------- */

function openSidebar() {
  els.sidebar.classList.add("is-open");
  if (MOBILE_QUERY.matches) els.scrim.hidden = false;
}

function closeSidebar() {
  els.sidebar.classList.remove("is-open");
  els.scrim.hidden = true;
}

/* --------------------------------------------------------------------------
   Note list
   -------------------------------------------------------------------------- */

function renderSkeletons() {
  els.noteList.innerHTML = SKELETON_HTML;
  els.listPlaceholder.hidden = true;
  els.noteCount.textContent = "불러오는 중…";
}

function buildNoteItem(note) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "note-item";
  button.dataset.id = note.id;
  if (state.current && state.current.id === note.id) {
    button.classList.add("is-active");
    button.setAttribute("aria-current", "true");
  }

  const top = document.createElement("span");
  top.className = "note-item-top";

  const title = document.createElement("span");
  title.className = "note-item-title";
  const titleText = displayTitle(note.title);
  title.textContent = titleText;
  if (titleText === "제목 없음") title.classList.add("is-untitled");
  top.appendChild(title);

  if (note.pinned) {
    top.appendChild(createIcon("i-pin-solid", "note-item-pin"));
    button.title = "고정된 메모";
  }

  const excerpt = document.createElement("span");
  excerpt.className = "note-item-excerpt";
  const excerptText = excerptOf(note.excerpt || "");
  excerpt.textContent = excerptText || "내용 없음";
  if (!excerptText) excerpt.classList.add("is-empty");

  const time = document.createElement("span");
  time.className = "note-item-time";
  time.textContent = timeAgo(note.updatedAt);

  button.append(top, excerpt, time);
  return button;
}

function renderList() {
  els.noteList.classList.remove("is-loading");

  if (state.loading) {
    if (!state.notes.length) {
      renderSkeletons();
      return;
    }
    els.noteList.classList.add("is-loading");
  }

  if (!state.notes.length) {
    els.noteList.innerHTML = "";
    els.listPlaceholder.hidden = false;
    const searchQuery = state.query;
    if (searchQuery) {
      els.placeholderTitle.textContent = "검색 결과가 없습니다";
      els.placeholderSub.textContent = `“${searchQuery}”와 일치하는 메모가 없어요.`;
      els.placeholderAction.textContent = "검색 지우기";
    } else {
      els.placeholderTitle.textContent = "아직 메모가 없습니다";
      els.placeholderSub.textContent = "첫 메모를 만들어 보세요.";
      els.placeholderAction.textContent = "새 메모";
    }
    els.noteCount.textContent = "0개";
    els.listSort.textContent = searchQuery ? "검색 결과" : "최근 수정순";
    return;
  }

  els.listPlaceholder.hidden = true;
  const fragment = document.createDocumentFragment();
  for (const note of state.notes) fragment.appendChild(buildNoteItem(note));
  els.noteList.replaceChildren(fragment);

  els.noteCount.textContent = `${state.notes.length}개`;
  els.listSort.textContent = state.query
    ? "검색 결과"
    : state.notes.some((note) => note.pinned)
      ? "고정 우선"
      : "최근 수정순";
}

function updateActiveListItem() {
  const note = state.current;
  if (!note) return;
  const item = els.noteList.querySelector(`.note-item[data-id="${note.id}"]`);
  if (!item) return;

  const title = item.querySelector(".note-item-title");
  if (title) {
    const titleText = displayTitle(note.title);
    title.textContent = titleText;
    title.classList.toggle("is-untitled", titleText === "제목 없음");
  }

  const excerpt = item.querySelector(".note-item-excerpt");
  if (excerpt) {
    const excerptText = excerptOf(note.content);
    excerpt.textContent = excerptText || "내용 없음";
    excerpt.classList.toggle("is-empty", !excerptText);
  }

  const time = item.querySelector(".note-item-time");
  if (time) time.textContent = timeAgo(note.updatedAt);
}

function syncNoteToList(note) {
  const listItem = {
    id: note.id,
    title: note.title,
    excerpt: note.content.slice(0, 180),
    pinned: note.pinned,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };

  const index = state.notes.findIndex((item) => item.id === note.id);
  if (index >= 0) state.notes[index] = listItem;
  else state.notes.push(listItem);

  sortNotes();
  const scrollTop = els.noteList.scrollTop;
  renderList();
  els.noteList.scrollTop = scrollTop;
}

async function loadNotes() {
  if (listController) listController.abort();
  const controller = new AbortController();
  listController = controller;

  state.loading = true;
  renderList();

  try {
    const query = state.query;
    const suffix = query ? `?q=${encodeURIComponent(query)}` : "";
    const data = await api(`/api/notes${suffix}`, { signal: controller.signal });
    if (controller.signal.aborted) return;
    state.notes = Array.isArray(data?.notes) ? data.notes : [];
    state.loading = false;
    renderList();
  } catch (error) {
    if (error.name === "AbortError") return;
    if (error.status === 401) return;
    state.loading = false;
    renderList();
    showToast("메모 목록을 불러오지 못했습니다.");
  }
}

/* --------------------------------------------------------------------------
   Editor
   -------------------------------------------------------------------------- */

function updateStats() {
  const content = els.contentInput.value;
  els.noteChars.textContent = `${content.length.toLocaleString("ko-KR")}자`;
  els.noteLines.textContent = `${content.split("\n").length.toLocaleString("ko-KR")}줄`;
  updateCursor();
}

function updateMeta() {
  if (!state.current) {
    els.noteDate.textContent = "";
    return;
  }
  els.noteDate.textContent = formatFullDate(state.current.updatedAt);
  els.noteDate.title = "마지막 수정";
  updateStats();
}

function updateCursor() {
  if (!state.current || document.activeElement !== els.contentInput) {
    els.cursorInfo.textContent = "";
    return;
  }
  const position = els.contentInput.selectionStart || 0;
  const before = els.contentInput.value.slice(0, position);
  const line = (before.match(/\n/g) || []).length + 1;
  const column = position - before.lastIndexOf("\n");
  els.cursorInfo.textContent = `${line}줄 ${column}열`;
}

function updatePinButton() {
  const pinned = Boolean(state.current?.pinned);
  els.pinNote.setAttribute("aria-pressed", String(pinned));
  els.pinNote.querySelector("span").textContent = pinned ? "고정됨" : "고정";
}

function renderEditor() {
  const note = state.current;
  if (!note) {
    els.editorView.hidden = true;
    els.emptyView.hidden = false;
    els.appView.classList.remove("is-editing");
    els.titleInput.value = "";
    els.contentInput.value = "";
    return;
  }

  els.editorView.hidden = false;
  els.emptyView.hidden = true;
  els.appView.classList.add("is-editing");

  els.titleInput.value = note.title;
  els.contentInput.value = note.content;
  els.contentInput.scrollTop = 0;
  els.contentInput.setSelectionRange(0, 0);

  updatePinButton();
  updateMeta();
  setSaveStatus("saved");

  if (MOBILE_QUERY.matches) els.titleInput.blur();
}

function scheduleSave(delay) {
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    saveNow();
  }, typeof delay === "number" ? delay : 700);
}

function markDirty() {
  state.dirty = true;
  setSaveStatus("pending");
  scheduleSave();
}

function onTitleInput() {
  if (!state.current) return;
  state.current.title = els.titleInput.value;
  markDirty();
  updateActiveListItem();
}

function onContentInput() {
  if (!state.current) return;
  state.current.content = els.contentInput.value;
  markDirty();
  updateStats();
  updateActiveListItem();
}

function saveNow() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;

  if (!state.current || !state.dirty) return Promise.resolve(true);

  const task = saveChain.then(async () => {
    if (!state.current || !state.dirty) return true;

    const id = state.current.id;
    const payload = {
      title: els.titleInput.value,
      content: els.contentInput.value,
    };

    state.dirty = false;
    setSaveStatus("saving");

    try {
      const data = await api(`/api/notes/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      if (!data?.note || state.current?.id !== id) return true;

      state.current.updatedAt = data.note.updatedAt;
      state.current.pinned = data.note.pinned;

      if (state.dirty) {
        setSaveStatus("pending");
        scheduleSave(350);
      } else {
        state.current.title = data.note.title;
        state.current.content = data.note.content;
        syncNoteToList(state.current);
        updateMeta();
        setSaveStatus("saved");
      }

      return true;
    } catch (error) {
      if (error.status === 401) return false;
      if (state.current?.id === id) {
        state.dirty = true;
        setSaveStatus("error");
      }
      showToast(error.code ? error.message : "메모를 저장하지 못했습니다. 다시 시도해 주세요.");
      return false;
    }
  });

  saveChain = task.catch(() => false);
  return task;
}

async function flushSave() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;

  if (!state.current || !state.dirty) return true;

  let ok = await saveNow();
  if (!ok) return false;

  for (let attempt = 0; attempt < 2 && state.dirty; attempt += 1) {
    ok = await saveNow();
    if (!ok) return false;
  }

  return !state.dirty;
}

/* --------------------------------------------------------------------------
   Note actions
   -------------------------------------------------------------------------- */

async function selectNote(id) {
  if (state.current && state.current.id === id) {
    closeSidebar();
    return;
  }

  const ok = await flushSave();
  if (!ok) return;

  const requestId = ++state.noteRequest;
  try {
    const data = await api(`/api/notes/${encodeURIComponent(id)}`);
    if (requestId !== state.noteRequest) return;

    state.current = data.note;
    state.dirty = false;
    setSaveStatus("saved");
    renderEditor();
    renderList();
    closeSidebar();
  } catch (error) {
    if (error.status === 401) return;
    if (error.status === 404) {
      showToast("메모를 찾을 수 없습니다.");
      await loadNotes();
      return;
    }
    showToast("메모를 불러오지 못했습니다.");
  }
}

async function createNote() {
  if (state.creating) return;

  const ok = await flushSave();
  if (!ok) return;

  state.creating = true;
  els.newNote.disabled = true;
  els.mobileNew.disabled = true;
  els.emptyNew.disabled = true;

  try {
    const data = await api("/api/notes", {
      method: "POST",
      body: JSON.stringify({ title: "", content: "" }),
    });

    if (!data?.note) throw new Error("메모 응답이 올바르지 않습니다.");

    const wasSearching = Boolean(state.query);
    state.current = data.note;
    state.dirty = false;
    state.query = "";
    els.search.value = "";
    state.noteRequest += 1;

    const listItem = {
      id: data.note.id,
      title: "",
      excerpt: "",
      pinned: false,
      createdAt: data.note.createdAt,
      updatedAt: data.note.updatedAt,
    };

    if (wasSearching) {
      await loadNotes();
    } else {
      state.notes.unshift(listItem);
      sortNotes();
      renderList();
    }

    renderEditor();
    closeSidebar();
    els.titleInput.focus();
  } catch (error) {
    if (error.status !== 401) {
      showToast(error.code ? error.message : "새 메모를 만들지 못했습니다.");
    }
  } finally {
    state.creating = false;
    els.newNote.disabled = false;
    els.mobileNew.disabled = false;
    els.emptyNew.disabled = false;
  }
}

async function togglePin() {
  if (!state.current) return;

  const ok = await flushSave();
  if (!ok) return;

  const id = state.current.id;
  const nextPinned = !state.current.pinned;
  els.pinNote.disabled = true;

  try {
    const data = await api(`/api/notes/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ pinned: nextPinned }),
    });
    if (!data?.note || state.current?.id !== id) return;

    state.current.pinned = data.note.pinned;
    state.current.updatedAt = data.note.updatedAt;
    updatePinButton();
    syncNoteToList(state.current);
    showToast(data.note.pinned ? "메모를 고정했습니다." : "고정을 해제했습니다.");
  } catch (error) {
    if (error.status !== 401) showToast("고정 상태를 변경하지 못했습니다.");
  } finally {
    els.pinNote.disabled = false;
  }
}

function askDelete() {
  const dialog = els.confirmDialog;
  if (typeof dialog.showModal !== "function") {
    return Promise.resolve(window.confirm("메모를 삭제할까요? 삭제한 메모는 복구할 수 없습니다."));
  }

  return new Promise((resolve) => {
    dialog.returnValue = "";
    const onClose = () => {
      dialog.removeEventListener("close", onClose);
      resolve(dialog.returnValue === "confirm");
    };
    dialog.addEventListener("close", onClose);
    dialog.showModal();
  });
}

async function deleteCurrent() {
  if (!state.current) return;

  const confirmed = await askDelete();
  if (!confirmed) return;

  const ok = await flushSave();
  if (!ok) return;

  const id = state.current.id;
  els.deleteNote.disabled = true;

  try {
    await api(`/api/notes/${encodeURIComponent(id)}`, { method: "DELETE" });
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    state.noteRequest += 1;
    state.current = null;
    state.dirty = false;
    state.notes = state.notes.filter((note) => note.id !== id);
    renderEditor();
    renderList();
    showToast("메모를 삭제했습니다.");
    if (MOBILE_QUERY.matches) openSidebar();
  } catch (error) {
    if (error.status !== 401) showToast("메모를 삭제하지 못했습니다.");
  } finally {
    els.deleteNote.disabled = false;
  }
}

/* --------------------------------------------------------------------------
   Search
   -------------------------------------------------------------------------- */

function onSearchInput() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const query = els.search.value.trim();
    if (query === state.query) return;
    state.query = query;
    loadNotes();
  }, 250);
}

function clearSearch() {
  clearTimeout(searchTimer);
  els.search.value = "";
  state.query = "";
  loadNotes();
}

/* --------------------------------------------------------------------------
   Events
   -------------------------------------------------------------------------- */

function bindEvents() {
  els.newNote.addEventListener("click", createNote);
  els.mobileNew.addEventListener("click", createNote);
  els.emptyNew.addEventListener("click", createNote);

  els.noteList.addEventListener("click", (event) => {
    const item = event.target.closest(".note-item");
    if (item) selectNote(item.dataset.id);
  });

  els.placeholderAction.addEventListener("click", () => {
    if (state.query) clearSearch();
    else createNote();
  });

  els.search.addEventListener("input", onSearchInput);

  els.titleInput.addEventListener("input", onTitleInput);
  els.titleInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      els.contentInput.focus();
    }
  });

  els.contentInput.addEventListener("input", onContentInput);
  els.contentInput.addEventListener("keyup", updateCursor);
  els.contentInput.addEventListener("click", updateCursor);
  els.contentInput.addEventListener("focus", updateCursor);
  els.contentInput.addEventListener("blur", () => {
    els.cursorInfo.textContent = "";
  });

  els.pinNote.addEventListener("click", togglePin);
  els.deleteNote.addEventListener("click", deleteCurrent);
  els.saveStatus.addEventListener("click", () => {
    saveNow();
  });

  els.openSidebar.addEventListener("click", openSidebar);
  els.backToList.addEventListener("click", openSidebar);
  els.scrim.addEventListener("click", closeSidebar);

  MOBILE_QUERY.addEventListener?.("change", (event) => {
    if (!event.matches) closeSidebar();
  });

  if (els.logoutForm) {
    els.logoutForm.addEventListener("submit", async (event) => {
      if (!state.dirty) return;
      event.preventDefault();
      const ok = await flushSave();
      if (ok) els.logoutForm.submit();
    });
  }

  document.addEventListener("keydown", (event) => {
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();

    if (mod && !event.altKey && key === "s") {
      event.preventDefault();
      saveNow();
      return;
    }

    if (mod && event.altKey && key === "n") {
      event.preventDefault();
      createNote();
      return;
    }

    if (mod && !event.altKey && key === "k") {
      event.preventDefault();
      openSidebar();
      els.search.focus();
      els.search.select();
      return;
    }

    if (event.key === "Escape" && els.sidebar.classList.contains("is-open")) {
      closeSidebar();
    }
  });

  window.addEventListener("beforeunload", (event) => {
    if (!state.dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && state.dirty) saveNow();
  });

  setInterval(() => {
    els.noteList.querySelectorAll(".note-item").forEach((item) => {
      const note = state.notes.find((candidate) => candidate.id === item.dataset.id);
      const time = item.querySelector(".note-item-time");
      if (note && time) time.textContent = timeAgo(note.updatedAt);
    });
  }, 60000);
}

/* --------------------------------------------------------------------------
   Boot
   -------------------------------------------------------------------------- */

async function boot() {
  setupShortcutLabels();
  setupTheme();
  bindEvents();

  const params = new URLSearchParams(window.location.search);
  const authError = params.get("auth_error");
  if (authError) {
    window.history.replaceState(null, "", window.location.pathname);
  }

  try {
    const data = await api("/api/me", { skipAuthRedirect: true });
    if (!data?.user) throw new Error("사용자 응답이 올바르지 않습니다.");
    state.user = data.user;
    showApp();
    await loadNotes();
  } catch (error) {
    if (error.status === 401) {
      showLogin(authError || null);
    } else {
      console.error(error);
      showLogin(authError || "network");
    }
  }
}

boot();
