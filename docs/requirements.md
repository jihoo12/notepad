# 메모장 웹 애플리케이션 요구사항 명세서

| 항목 | 내용 |
| --- | --- |
| 문서 버전 | 1.0 |
| 작성일 | 2026-11-11 |
| 상태 | 구현 완료 (v1.0) |
| 대상 시스템 | Cloudflare Workers 기반 개인 메모장 |
| 인증 방식 | GitHub OAuth 2.0 |
| 저장소 | Cloudflare D1 (SQLite) |

---

## 1. 개요

### 1.1 목적

GitHub 계정만 있으면 별도 회원가입 없이 바로 사용할 수 있는, 빠르고 군더더기 없는 개인 메모장 웹 서비스를 만든다. 메모는 작성자 본인만 조회·수정·삭제할 수 있으며, 모든 변경은 자동으로 저장된다.

### 1.2 배경

기존 메모 도구는 회원가입 절차가 번거롭거나, 기능이 과도하게 많아 "빠르게 한 줄 적는" 용도에 부적합한 경우가 많다. 본 시스템은 다음 세 가지에 집중한다.

1. **즉시 시작** — GitHub OAuth 로그인 한 번으로 시작
2. **잃지 않는 기록** — 입력 후 자동 저장, 명시적 저장 버튼 불필요
3. **빠른 탐색** — 제목·본문 통합 검색, 최근 수정순/고정 우선 정렬

### 1.3 범위 요약

| 구분 | 내용 |
| --- | --- |
| 포함 | GitHub OAuth 로그인/로그아웃, 세션 관리, 메모 CRUD, 자동 저장, 검색, 고정, 반응형 UI, 다크 모드 |
| 제외 | 회원가입/비밀번호, 공유·협업, 폴더/태그, 첨부파일, 리치 텍스트, 오프라인 동기화, 네이티브 앱 |

---

## 2. 사용자 및 사용 시나리오

### 2.1 사용자 정의

| 사용자 | 설명 | 주요 니즈 |
| --- | --- | --- |
| 개인 사용자 | GitHub 계정을 보유한 개발자·일반 사용자 | 로그인 후 빠르게 메모를 남기고, 나중에 검색해서 다시 찾기 |
| 운영자 | 서비스를 배포·운영하는 관리자 | GitHub OAuth 앱과 Cloudflare 리소스 설정, 안전한 비밀 관리 |

### 2.2 핵심 사용자 스토리

| ID | 스토리 | 우선순위 |
| --- | --- | --- |
| US-01 | 사용자는 GitHub 계정으로 로그인하여 자신의 메모 목록을 볼 수 있다. | Must |
| US-02 | 사용자는 새 메모를 만들고 제목과 본문을 작성할 수 있다. | Must |
| US-03 | 사용자는 작성 중인 메모가 자동 저장되어 유실되지 않기를 원한다. | Must |
| US-04 | 사용자는 제목이나 본문 내용으로 메모를 검색할 수 있다. | Should |
| US-05 | 사용자는 중요한 메모를 목록 상단에 고정할 수 있다. | Should |
| US-06 | 사용자는 더 이상 필요 없는 메모를 삭제할 수 있다. | Must |
| US-07 | 사용자는 다른 사람의 메모에 절대 접근할 수 없어야 한다. | Must |
| US-08 | 사용자는 모바일에서도 편하게 메모를 작성할 수 있다. | Should |
| US-09 | 사용자는 자신의 테마(라이트/다크)를 선택할 수 있다. | Could |
| US-10 | 사용자는 키보드 단축키로 빠르게 메모를 작성할 수 있다. | Could |

---

## 3. 기능 요구사항

우선순위는 MoSCoW(Must / Should / Could)를 따른다.

### 3.1 인증 및 세션

| ID | 요구사항 | 우선순위 | 인수 기준 |
| --- | --- | --- | --- |
| FR-AUTH-01 | GitHub OAuth 2.0 Authorization Code Flow로 로그인한다. | Must | `/auth/login` 접근 시 GitHub 인증 화면으로 이동하고, 승인 후 `/auth/callback`에서 세션이 생성된다. |
| FR-AUTH-02 | OAuth `state` 값을 생성하고 콜백에서 검증하여 CSRF를 방지한다. | Must | state가 없거나 쿠키 값과 다르면 로그인은 실패하고 오류 안내가 표시된다. |
| FR-AUTH-03 | 세션은 30일간 유지되며, 서버에는 토큰의 SHA-256 해시만 저장한다. | Must | DB에 원문 세션 토큰이 존재하지 않는다. 만료된 세션은 인증에 사용할 수 없다. |
| FR-AUTH-04 | 세션 쿠키는 `HttpOnly`, `SameSite=Lax`, `Path=/`, HTTPS 환경에서 `Secure`로 설정한다. | Must | 브라우저 개발자 도구에서 쿠키 속성을 확인할 수 있고, JS에서 접근할 수 없다. |
| FR-AUTH-05 | 로그아웃 시 서버 세션을 삭제하고 쿠키를 제거한다. | Must | 로그아웃 후 `/api/notes` 요청이 401을 반환한다. |
| FR-AUTH-06 | 인증되지 않은 API 요청은 401로 거부한다. | Must | 쿠키 없이 `/api/*` 호출 시 401 JSON이 반환된다. |
| FR-AUTH-07 | GitHub 인증 실패, state 만료, 설정 누락을 사용자에게 한국어로 안내한다. | Should | 로그인 화면에 원인별 오류 메시지가 표시된다. 내부 오류·비밀값은 노출되지 않는다. |
| FR-AUTH-08 | 로컬 개발 환경에서만 사용할 수 있는 개발용 로그인을 제공한다. | Could | `DEV_LOGIN=true`이고 호스트가 localhost일 때만 동작하며, 프로덕션에서는 404를 반환한다. |

### 3.2 메모 관리

| ID | 요구사항 | 우선순위 | 인수 기준 |
| --- | --- | --- | --- |
| FR-NOTE-01 | 사용자는 새 메모를 생성할 수 있다. | Must | 생성 즉시 목록 최상단에 나타나고 편집기가 열린다. |
| FR-NOTE-02 | 사용자는 자신의 메모 목록을 최근 수정순으로 조회할 수 있다. | Must | 다른 사용자의 메모는 목록에 포함되지 않는다. |
| FR-NOTE-03 | 사용자는 메모의 제목과 본문을 조회할 수 있다. | Must | 목록에서 선택하면 전체 내용이 로드된다. |
| FR-NOTE-04 | 사용자는 메모의 제목·본문을 수정할 수 있다. | Must | 입력 중지 후 약 0.7초 내 자동 저장되고 "저장됨" 상태가 표시된다. |
| FR-NOTE-05 | 사용자는 메모를 삭제할 수 있다. | Must | 확인 대화상자 승인 후 삭제되며, 목록에서 사라진다. |
| FR-NOTE-06 | 사용자는 메모를 고정하여 목록 상단에 유지할 수 있다. | Should | 고정된 메모는 수정 시각과 무관하게 고정 메모끼리 최근 수정순으로 정렬된다. |
| FR-NOTE-07 | 사용자는 제목과 본문을 대상으로 검색할 수 있다. | Should | 검색어 입력 시 서버에서 필터링된 목록이 반환된다. 대소문자(영문)를 구분하지 않는다. |
| FR-NOTE-08 | 제목이 비어 있으면 "제목 없음"으로 표시한다. | Should | 빈 제목 메모도 목록과 편집기에서 식별 가능하다. |
| FR-NOTE-09 | 메모 ID는 추측 불가능한 UUID v4를 사용한다. | Must | 순차 ID로 다른 메모를 추측할 수 없다. |
| FR-NOTE-10 | 모든 쿼리는 `user_id`로 제한하여 사용자 간 데이터를 격리한다. | Must | 타 사용자 메모 ID로 조회/수정/삭제 시 404가 반환된다. |
| FR-NOTE-11 | 제목은 200자, 본문은 100,000자, 사용자당 메모는 1,000개로 제한한다. | Should | 초과 요청은 400/422와 명확한 오류 코드를 반환한다. |
| FR-NOTE-12 | 목록 API는 최대 200개를 반환한다. | Could | 200개 초과 시 최근 수정된 메모부터 반환된다. |

### 3.3 화면 및 사용성

| ID | 요구사항 | 우선순위 | 인수 기준 |
| --- | --- | --- | --- |
| FR-UI-01 | 데스크톱은 사이드바 + 편집기 2단, 모바일은 드로어 사이드바로 동작한다. | Should | 820px 이하에서 사이드바가 오버레이로 열리고, 메모 선택 시 닫힌다. |
| FR-UI-02 | 라이트/다크 테마를 제공하고 선택을 브라우저에 기억한다. | Could | 새로고침 후에도 선택한 테마가 유지된다. |
| FR-UI-03 | 저장 상태(저장 중/저장됨/실패)를 실시간으로 표시한다. | Must | 입력 후 상태 변화가 `aria-live` 영역에 반영된다. |
| FR-UI-04 | 메모가 없거나 검색 결과가 없을 때 빈 상태 안내를 표시한다. | Should | 각 상황에 맞는 문구와 행동 버튼이 보인다. |
| FR-UI-05 | 키보드 단축키를 제공한다. | Could | `Ctrl/⌘+Alt+N` 새 메모, `Ctrl/⌘+S` 즉시 저장, `Ctrl/⌘+K` 검색 포커스, `Esc` 드로어/대화상자 닫기. |
| FR-UI-06 | 모든 UI 문구는 한국어로 제공한다. | Should | 화면에 영어 시스템 문구가 노출되지 않는다. |
| FR-UI-07 | 로딩·오류·성공 피드백을 제공한다. | Should | 네트워크 오류 시 토스트가 표시되고 다음 입력에서 재시도할 수 있다. |
| FR-UI-08 | 파괴적 동작(삭제)은 확인 절차를 거친다. | Must | 삭제 전 확인 대화상자가 표시된다. |

### 3.4 운영

| ID | 요구사항 | 우선순위 | 인수 기준 |
| --- | --- | --- | --- |
| FR-OPS-01 | Cloudflare Workers + Static Assets로 배포한다. | Must | `wrangler deploy`로 단일 Worker에 API와 정적 자산이 배포된다. |
| FR-OPS-02 | D1 마이그레이션을 리포지토리에서 관리한다. | Must | `migrations/0001_init.sql`로 스키마를 재현할 수 있다. |
| FR-OPS-03 | 비밀값은 `wrangler secret`으로 주입한다. | Must | 저장소에 클라이언트 시크릿이 커밋되지 않는다. |
| FR-OPS-04 | 헬스체크용 엔드포인트를 제공한다. | Could | `GET /api/health`가 200과 상태 정보를 반환한다. |

---

## 4. 비기능 요구사항

### 4.1 성능

| ID | 요구사항 |
| --- | --- |
| NFR-PERF-01 | API 응답 p95는 콜드 스타트를 제외하고 300ms 이내여야 한다. |
| NFR-PERF-02 | 초기 화면 FCP는 일반 네트워크에서 1.5초 이내여야 한다. |
| NFR-PERF-03 | 자동 저장은 입력 중지 후 0.7초 디바운스로 요청 폭주를 방지한다. |
| NFR-PERF-04 | 검색 입력은 0.25초 디바운스 및 이전 요청 취소를 적용한다. |

### 4.2 보안

| ID | 요구사항 |
| --- | --- |
| NFR-SEC-01 | 세션 토큰은 256비트 난수이며 서버에는 해시만 저장한다. |
| NFR-SEC-02 | OAuth `state`는 1회성 쿠키(10분)로 검증하고 사용 후 삭제한다. |
| NFR-SEC-03 | 상태 변경 API는 `Origin` 헤더를 검증한다(SameSite=Lax와 함께 CSRF 방어). |
| NFR-SEC-04 | CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`를 적용한다. |
| NFR-SEC-05 | GitHub OAuth scope는 `read:user` 최소 권한만 요청한다. |
| NFR-SEC-06 | 오류 응답에 스택 트레이스, 토큰, 시크릿을 포함하지 않는다. |
| NFR-SEC-07 | 메모 본문은 서버 로그에 기록하지 않는다. |

### 4.3 접근성 및 호환성

| ID | 요구사항 |
| --- | --- |
| NFR-A11Y-01 | 주요 컨트롤에 레이블/`aria-label`을 제공하고 키보드로 조작 가능해야 한다. |
| NFR-A11Y-02 | 포커스 표시를 제거하지 않으며 색 대비는 WCAG 2.1 AA를 목표로 한다. |
| NFR-A11Y-03 | `prefers-reduced-motion`을 존중한다. |
| NFR-COMP-01 | 최신 2개 버전의 Chrome, Safari, Firefox, Edge 및 모바일 Safari/Chrome을 지원한다. |
| NFR-COMP-02 | JS 활성화 환경을 전제로 한다(SPA). |

### 4.4 데이터 및 운영

| ID | 요구사항 |
| --- | --- |
| NFR-DATA-01 | 모든 시각은 UTC ISO 8601 문자열로 저장하고 클라이언트에서 현지화한다. |
| NFR-DATA-02 | 사용자 삭제 시 세션·메모를 연쇄 삭제한다. |
| NFR-OPS-01 | Cloudflare Observability를 활성화하여 요청 오류를 추적한다. |
| NFR-OPS-02 | D1 백업/복구는 Cloudflare의 관리 기능과 마이그레이션 재실행으로 대응한다. |

---

## 5. 화면 설계

### 5.1 로그인 화면

- 브랜드 마크, 서비스명 "메모장", 한 줄 소개
- **GitHub로 계속하기** 버튼 (→ `/auth/login`)
- 개인정보/데이터 안내 문구
- OAuth 오류 발생 시 원인별 한국어 메시지
- 라이트/다크 테마 자동 대응

### 5.2 메인 화면

```text
┌───────────────────────┬──────────────────────────────────────────┐
│ 메모장          ☾     │  [고정] [삭제]              ● 저장됨      │
│ ┌───────────────────┐ │                                          │
│ │ + 새 메모      ⌘N │ │  제목                                    │
│ └───────────────────┘ │  2026년 11월 11일 · 128자                │
│ 🔍 메모 검색          │                                          │
│ 3개    최근 수정순    │  본문이 표시되는 편집 영역               │
│ ┌───────────────────┐ │                                          │
│ │ 고정된 메모     📌│ │                                          │
│ │ 미리보기…         │ │                                          │
│ │ 3분 전            │ │                                          │
│ ├───────────────────┤ │                                          │
│ │ 일반 메모         │ │                                          │
│ │ 미리보기…         │ │                                          │
│ └───────────────────┘ │                                          │
│ 👤 사용자      [⎋]    │  ⌘S 저장              12줄 · 128자        │
└───────────────────────┴──────────────────────────────────────────┘
```

### 5.3 상태 정의

| 상태 | 표현 |
| --- | --- |
| 목록 로딩 | 목록 영역 스켈레톤 |
| 메모 없음 | "아직 메모가 없습니다" + 새 메모 버튼 |
| 검색 결과 없음 | "검색 결과가 없습니다" + 검색어 지우기 |
| 메모 미선택 | 종이 일러스트 + "메모를 선택하거나 새로 시작하세요" |
| 저장 중 | 점멸 점 + "저장 중…" |
| 저장됨 | 점 + "저장됨" |
| 저장 실패 | 경고 점 + "저장 실패 · 다시 시도" (클릭 시 재시도) |
| 세션 만료 | 로그인 화면 + "세션이 만료되었습니다" |

---

## 6. API 명세

모든 API는 JSON을 사용하며 인증은 세션 쿠키 기반이다. 오류 응답 형식은 `{ "error": "code", "message": "설명" }`이다.

### 6.1 인증

| Method | Path | 설명 | 성공 응답 |
| --- | --- | --- | --- |
| GET | `/auth/login` | GitHub 인증 화면으로 302 리다이렉트 | 302 |
| GET | `/auth/callback` | code 교환, 사용자 upsert, 세션 생성 | 302 → `/` |
| POST | `/auth/logout` | 세션 삭제 후 쿠키 제거 | 302 → `/` |
| GET | `/auth/dev?login=...` | 개발 전용 로그인 (localhost + `DEV_LOGIN=true`) | 302 → `/` |

### 6.2 사용자

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/api/me` | 현재 로그인 사용자 조회 |
| GET | `/api/health` | 상태 확인 (인증 불필요) |

`GET /api/me` 응답 예시:

```json
{
  "user": {
    "id": 1,
    "login": "octocat",
    "name": "The Octocat",
    "avatarUrl": "https://avatars.githubusercontent.com/u/583231"
  }
}
```

### 6.3 메모

| Method | Path | 설명 | 요청 본문 |
| --- | --- | --- | --- |
| GET | `/api/notes?q=검색어` | 메모 목록(최대 200) | — |
| POST | `/api/notes` | 메모 생성 | `{ "title"?: string, "content"?: string }` |
| GET | `/api/notes/:id` | 메모 단건 조회 | — |
| PATCH | `/api/notes/:id` | 메모 수정 | `{ "title"?: string, "content"?: string, "pinned"?: boolean }` |
| DELETE | `/api/notes/:id` | 메모 삭제 | — |

목록 응답 예시:

```json
{
  "notes": [
    {
      "id": "0f8fad5b-d9cb-469f-a165-70867728950e",
      "title": "배포 체크리스트",
      "excerpt": "1. wrangler login\n2. D1 생성…",
      "pinned": true,
      "createdAt": "2026-11-11T06:00:00.000Z",
      "updatedAt": "2026-11-11T06:12:00.000Z"
    }
  ]
}
```

단건 응답 예시:

```json
{
  "note": {
    "id": "0f8fad5b-d9cb-469f-a165-70867728950e",
    "title": "배포 체크리스트",
    "content": "1. wrangler login\n2. D1 생성…",
    "pinned": true,
    "createdAt": "2026-11-11T06:00:00.000Z",
    "updatedAt": "2026-11-11T06:12:00.000Z"
  }
}
```

### 6.4 상태 코드

| 코드 | 의미 |
| --- | --- |
| 200 | 조회/수정 성공 |
| 201 | 생성 성공 |
| 204 | 삭제 성공 |
| 400 | 요청 형식/값 오류 |
| 401 | 미인증 또는 세션 만료 |
| 404 | 메모 없음 또는 접근 권한 없음 |
| 409 | (현재 미사용, 향후 동시 편집 충돌용) |
| 422 | 제한 초과(메모 개수 등) |
| 500 | 서버 오류 |

---

## 7. 데이터 모델

### 7.1 ERD 요약

```text
users 1 ───< sessions
users 1 ───< notes
```

### 7.2 테이블 정의

```sql
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  github_id     INTEGER NOT NULL UNIQUE,
  login         TEXT NOT NULL,
  name          TEXT,
  avatar_url    TEXT,
  created_at    TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,             -- SHA-256(session token)
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE notes (
  id         TEXT PRIMARY KEY,             -- UUID v4
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT '',
  content    TEXT NOT NULL DEFAULT '',
  pinned     INTEGER NOT NULL DEFAULT 0,   -- 0 | 1
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 7.3 인덱스

```sql
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
CREATE INDEX idx_notes_user_updated ON notes(user_id, updated_at DESC);
CREATE INDEX idx_notes_user_pinned ON notes(user_id, pinned);
```

---

## 8. 인증 흐름

```text
[사용자]                [Worker]                     [GitHub]
   │  GET /auth/login      │                            │
   ├──────────────────────►│ state 생성, 쿠키 저장       │
   │  302 GitHub authorize │                            │
   │◄──────────────────────┤                            │
   ├───────────────────────────────────────────────────►│
   │  GitHub 승인 후 302 /auth/callback?code=…&state=…   │
   │◄───────────────────────────────────────────────────┤
   ├──────────────────────►│ state 쿠키 검증             │
   │                       ├── POST access_token ───────►│
   │                       │◄── access_token ────────────┤
   │                       ├── GET /user ───────────────►│
   │                       │◄── GitHub 프로필 ───────────┤
   │                       │ users upsert                │
   │                       │ sessions insert(해시)       │
   │  302 / + Set-Cookie   │ state 쿠키 삭제             │
   │◄──────────────────────┤                            │
```

세션 쿠키: `np_session=<base64url 32bytes>; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000[; Secure]`

---

## 9. 오류 처리

| 상황 | 사용자 경험 | 서버 동작 |
| --- | --- | --- |
| OAuth state 불일치/만료 | 로그인 화면에 재시도 안내 | `/`로 리다이렉트 + `auth_error=state` |
| GitHub 토큰 교환 실패 | 로그인 실패 안내 | `auth_error=exchange`, 상세는 서버 로그만 |
| GitHub 프로필 조회 실패 | 로그인 실패 안내 | `auth_error=profile` |
| 환경변수 누락 | 설정 오류 안내 | `auth_error=config` |
| 세션 만료(API 401) | 로그인 화면 전환 | 401 JSON |
| 네트워크/저장 실패 | "저장 실패 · 다시 시도" | 상태 유지, 다음 입력/클릭 시 재시도 |
| 메모 없음/타인 메모 | 목록 갱신 | 404 JSON |
| 입력 길이 초과 | 필드 오류 안내 | 400 JSON |

---

## 10. 제약 및 가정

- Cloudflare 계정, D1 데이터베이스, GitHub OAuth App이 필요하다.
- 실제 배포 도메인의 콜백 URL을 GitHub OAuth App에 등록해야 한다.
- D1은 리전 분산 읽기 복제를 제공하지만 쓰기는 단일 프라이머리에 집중된다. 개인 메모 규모에서는 충분하다.
- 동시 편집 충돌 해결(버전 벡터, CRDT)은 범위에서 제외한다. 마지막 저장이 우선한다.
- 200개 목록 제한 및 페이지네이션 미구현은 v1.0의 의도된 제약이다.
- 이메일·조직 정보는 수집하지 않는다(`read:user`만 사용).

### 10.1 위험 요소

| 위험 | 영향 | 대응 |
| --- | --- | --- |
| OAuth 시크릿 유출 | 계정 탈취 가능 | `wrangler secret` 사용, 저장소 커밋 금지, 유출 시 즉시 재발급 |
| GitHub 장애 | 신규 로그인 불가 | 기존 세션은 유지(30일), 오류 안내 |
| 세션 쿠키 탈취 | 계정 접근 | HttpOnly/Secure, 해시 저장, 로그아웃 시 즉시 무효화 |
| 대량 요청 | 비용/가용성 | Cloudflare Rate Limiting 도입 검토(향후) |
| D1 용량 초과 | 저장 실패 | 사용자당 메모/본문 제한, 모니터링 |

---

## 11. 인수 테스트 시나리오

| ID | 시나리오 | 기대 결과 |
| --- | --- | --- |
| AC-01 | 로그인하지 않고 `/` 접속 | 로그인 화면 표시 |
| AC-02 | "GitHub로 계속하기" 클릭 → 승인 | 메인 화면 진입, 사용자 정보 표시 |
| AC-03 | state 쿠키 삭제 후 콜백 접근 | 로그인 실패 안내 |
| AC-04 | 새 메모 생성 후 제목/본문 입력 | 0.7초 내 자동 저장, "저장됨" 표시 |
| AC-05 | 새로고침 후 메모 확인 | 내용 유지 |
| AC-06 | 검색어 입력 | 제목/본문이 일치하는 메모만 표시 |
| AC-07 | 메모 고정 | 목록 최상단으로 이동, 새로고침 후 유지 |
| AC-08 | 메모 삭제 → 취소 | 메모 유지 |
| AC-09 | 메모 삭제 → 확인 | 목록에서 제거, DB에서 삭제 |
| AC-10 | A 사용자 메모 ID로 B 사용자가 조회/수정/삭제 | 모두 404 |
| AC-11 | 세션 쿠키 없이 `/api/notes` 호출 | 401 |
| AC-12 | 로그아웃 후 뒤로가기/API 호출 | 로그인 화면, 401 |
| AC-13 | 820px 이하 뷰포트 | 드로어 사이드바, 메모 선택 시 닫힘 |
| AC-14 | 다크 모드 전환 후 새로고침 | 테마 유지 |
| AC-15 | `DEV_LOGIN=true` + localhost에서 `/auth/dev` | 개발 계정으로 로그인 |
| AC-16 | 프로덕션에서 `/auth/dev` 접근 | 404 |

---

## 12. 향후 확장

1. 메모 버전 기록 및 복원
2. 태그·폴더·즐겨찾기
3. Markdown 미리보기 및 리치 텍스트
4. 오프라인 편집(IndexedDB) + 동기화
5. 메모 내보내기(Markdown/JSON)와 가져오기
6. 공유 링크(읽기 전용)
7. 페이지네이션/무한 스크롤
8. Rate Limiting 및 감사 로그
9. 다국어(영어) 지원
10. PWA 설치 및 단축키 커스터마이징

---

## 13. 용어

| 용어 | 설명 |
| --- | --- |
| Worker | Cloudflare의 서버리스 실행 단위 |
| D1 | Cloudflare의 SQLite 기반 서버리스 데이터베이스 |
| OAuth state | 인증 요청과 콜백을 연결하는 1회성 난수 |
| 세션 토큰 | 로그인 상태를 증명하는 무작위 문자열(쿠키에 저장) |
| 자동 저장 | 입력 디바운스 후 서버에 변경 사항을 반영하는 동작 |
