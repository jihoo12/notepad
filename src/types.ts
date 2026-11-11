export interface Env {
  DB: D1Database;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  GITHUB_REDIRECT_URI?: string;
  DEV_LOGIN?: string;
}

export interface User {
  id: number;
  githubId: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: User;
  };
};

export interface UserRow {
  id: number;
  github_id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

export interface NoteRow {
  id: string;
  title: string;
  content: string;
  pinned: number;
  created_at: string;
  updated_at: string;
}

export interface NoteListRow {
  id: string;
  title: string;
  excerpt: string;
  pinned: number;
  created_at: string;
  updated_at: string;
}
