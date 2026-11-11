# 메모장 (Notepad)

GitHub 계정으로 로그인하는 개인 메모장입니다. Cloudflare Workers에서 실행되고, 메모는 D1(SQLite)에 사용자별로 안전하게 저장됩니다.

- **요구사항 명세서**: [docs/requirements.md](docs/requirements.md)
- **스택**: Cloudflare Workers · Static Assets · D1 · Hono · TypeScript · Vanilla JS
- **인증**: GitHub OAuth 2.0 (Authorization Code Flow, `read:user`)

## 주요 기능

- GitHub OAuth 로그인 / 로그아웃, 30일 세션
- 메모 생성·조회·수정·삭제 (UUID 기반, 사용자별 완전 격리)
- 입력 중지 0.7초 후 자동 저장, 저장 상태 실시간 표시
- 제목+본문 통합 검색 (250ms 디바운스, 이전 요청 취소)
- 메모 고정, 최근 수정순 정렬
- 반응형 UI(모바일 드로어), 라이트/다크 테마
- 키보드 단축키: `Ctrl/⌘+Alt+N` 새 메모, `Ctrl/⌘+S` 저장, `Ctrl/⌘+K` 검색, `Esc` 닫기
- 삭제 확인 대화상자, 토스트 오류 안내, 세션 만료 처리
- CSP 및 보안 헤더, HttpOnly 세션 쿠키, OAuth state 검증, Origin 기반 CSRF 방어

## 프로젝트 구조

```text
.
├── docs/requirements.md      # 요구사항 명세서
├── migrations/0001_init.sql  # D1 스키마
├── public/                   # 정적 프런트엔드 (빌드 단계 없음)
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   ├── theme.js
│   ├── _headers              # CSP 등 정적 자산 헤더
│   └── favicon.svg
├── src/
│   ├── index.ts              # Worker 진입점, 보안 헤더, /api/me, /api/health
│   ├── middleware.ts         # Origin 검사, 세션 인증
│   ├── routes/auth.ts        # GitHub OAuth, 로그아웃, 개발용 로그인
│   ├── routes/notes.ts       # 메모 CRUD API
│   ├── lib/                  # 세션·GitHub·검증·암호 유틸
│   └── types.ts
├── test/                     # Vitest 단위 테스트
├── wrangler.jsonc
└── package.json
```

## 로컬 실행

### 1. 준비물

- Node.js 20 이상, npm
- Cloudflare 계정 (실제 배포 시)
- GitHub 계정

```bash
npm install
```

### 2. 환경 변수

```bash
cp .dev.vars.example .dev.vars
```

`.dev.vars`는 `wrangler dev`에서만 읽히며 git에 커밋되지 않습니다.

**GitHub OAuth를 실제로 테스트하려면** [GitHub OAuth App](https://github.com/settings/developers)을 만들고 값을 채웁니다.

| 설정 | 값 |
| --- | --- |
| Homepage URL | `http://localhost:8787` |
| Authorization callback URL | `http://localhost:8787/auth/callback` |

```dotenv
GITHUB_CLIENT_ID=발급받은_클라이언트_ID
GITHUB_CLIENT_SECRET=발급받은_클라이언트_시크릿
DEV_LOGIN=true
```

**OAuth 앱 없이 UI만 확인하려면** `DEV_LOGIN=true`만 두고 브라우저에서 <http://localhost:8787/auth/dev> 를 엽니다. 개발용 로그인은 `localhost` + `DEV_LOGIN=true`일 때만 동작하며, 그 외 환경에서는 404를 반환합니다.

### 3. DB 마이그레이션 및 개발 서버

```bash
npm run db:migrate:local
npm run dev
```

<http://localhost:8787> 접속 → GitHub로 계속하기 또는 `/auth/dev`로 로그인.

### 4. 검사

```bash
npm run typecheck
npm test
```

## Cloudflare Workers 배포

### 1. 로그인 및 D1 생성

```bash
npx wrangler login
npx wrangler d1 create notepad-db
```

출력된 `database_id`를 `wrangler.jsonc`의 `d1_databases[0].database_id`에 붙여넣습니다. 현재 값은 로컬 개발용 자리표시자(`00000000-...`)입니다.

### 2. 원격 마이그레이션

```bash
npm run db:migrate:remote
```

### 3. GitHub OAuth App 설정

GitHub OAuth App을 하나 더 만들거나 기존 앱의 콜백 URL을 배포 주소로 변경합니다.

| 설정 | 값 |
| --- | --- |
| Homepage URL | `https://notepad.<your-subdomain>.workers.dev` |
| Authorization callback URL | `https://notepad.<your-subdomain>.workers.dev/auth/callback` |

커스텀 도메인을 쓴다면 그 도메인 기준으로 등록합니다.

### 4. 시크릿 주입 및 배포

```bash
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
npm run deploy
```

`GITHUB_CLIENT_ID`는 공개 값이지만, 설정을 한 곳으로 모으기 위해 시크릿으로 관리합니다. `GITHUB_REDIRECT_URI`는 선택 사항이며, 지정하지 않으면 요청 오리진 기준 `/auth/callback`을 사용합니다.

### 5. 배포 확인

```bash
curl https://notepad.<your-subdomain>.workers.dev/api/health
# {"ok":true,"service":"notepad","db":"up","time":"..."}
```

> `wrangler.jsonc`의 `vars.DEV_LOGIN`은 `"false"`입니다. `.dev.vars`는 배포되지 않으므로 운영 환경에서 개발용 로그인이 켜지지 않습니다.

## 환경 변수

| 이름 | 필수 | 설명 |
| --- | --- | --- |
| `GITHUB_CLIENT_ID` | 예 | GitHub OAuth App 클라이언트 ID |
| `GITHUB_CLIENT_SECRET` | 예 | GitHub OAuth App 클라이언트 시크릿 (시크릿으로 주입) |
| `GITHUB_REDIRECT_URI` | 아니오 | 콜백 URL 강제 지정 (미지정 시 요청 오리진 사용) |
| `DEV_LOGIN` | 아니오 | `"true"` + localhost에서만 개발용 로그인 활성화 |

## API 요약

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/auth/login` | GitHub 인증 시작 |
| GET | `/auth/callback` | OAuth 콜백, 세션 생성 |
| POST | `/auth/logout` | 세션 삭제 |
| GET | `/auth/dev` | 개발 전용 로그인 (localhost) |
| GET | `/api/health` | 상태 확인 (인증 불필요) |
| GET | `/api/me` | 현재 사용자 |
| GET | `/api/notes?q=` | 메모 목록/검색 (최대 200개) |
| POST | `/api/notes` | 메모 생성 |
| GET | `/api/notes/:id` | 메모 조회 |
| PATCH | `/api/notes/:id` | 메모 수정/고정 |
| DELETE | `/api/notes/:id` | 메모 삭제 |

자세한 요청·응답 형식은 [요구사항 명세서 6장](docs/requirements.md#6-api-명세)을 참고하세요.

## 데이터 모델

- `users`: GitHub 사용자 (`github_id` 유니크)
- `sessions`: 세션 토큰의 SHA-256 해시, 만료 시각 (30일)
- `notes`: UUID, 사용자 FK, 제목(최대 200자), 본문(최대 100,000자), 고정 여부, 생성/수정 시각

모든 쿼리는 `user_id`로 제한되며, 다른 사용자의 메모 ID를 알아도 404만 반환합니다.

## 보안 메모

- 세션 쿠키: `HttpOnly; SameSite=Lax; Path=/; Max-Age=30일` (+ HTTPS에서 `Secure`)
- OAuth `state`: 256비트 난수, 10분 만료 HttpOnly 쿠키로 검증 후 즉시 삭제
- 세션 원문은 저장하지 않고 SHA-256 해시만 D1에 저장
- 상태 변경 API는 `Origin` 헤더를 검증하고, 쿠키는 `SameSite=Lax`
- CSP, `X-Frame-Options`, `nosniff`, HSTS, Referrer-Policy 적용
- React/프레임워크 없이 `textContent` 기반 DOM 생성으로 사용자 입력을 HTML로 해석하지 않음
- GitHub scope는 `read:user` 최소 권한만 사용

## 알려진 제한

- 실시간 협업/동시 편집 충돌 해결은 지원하지 않습니다(마지막 저장 우선).
- 목록은 최대 200개, 사용자당 메모는 최대 1,000개입니다.
- 검색은 SQLite `instr` 기반이며 전문 검색(FTS) 인덱스를 사용하지 않습니다.
- 페이지네이션, 폴더, 태그, 공유, 오프라인 모드는 v1.0 범위가 아닙니다.
- Rate limiting은 Cloudflare 대시보드에서 추가 설정하는 것을 권장합니다.

## 문제 해결

| 증상 | 확인 사항 |
| --- | --- |
| `database_id` 오류 | `wrangler.jsonc`에 실제 D1 ID를 넣었는지 확인 |
| 로그인 후 `auth_error=config` | `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` 시크릿 설정 여부 |
| 로그인 후 `auth_error=state` | 쿠키 차단, 콜백 URL 불일치, 10분 초과 여부 |
| `auth_error=exchange` | GitHub OAuth App의 callback URL과 접속 도메인 일치 여부 |
| 개발용 로그인 404 | `DEV_LOGIN=true` + `http://localhost:8787` 사용 여부 |
| 배포 후 DB 오류 | `npm run db:migrate:remote` 실행 여부 |

## 라이선스

저장소의 [LICENSE](LICENSE)를 따릅니다.
