export interface GitHubProfile {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

export class GitHubAuthError extends Error {
  readonly stage: "exchange" | "profile";

  constructor(stage: "exchange" | "profile", message: string) {
    super(message);
    this.name = "GitHubAuthError";
    this.stage = stage;
  }
}

interface TokenResponse {
  access_token?: unknown;
  error?: unknown;
  error_description?: unknown;
}

/** GitHub OAuth authorization code를 access token으로 교환합니다. */
export async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<string> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
  });

  let response: Response;
  try {
    response = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "notepad-worker",
      },
      body,
    });
  } catch (error) {
    throw new GitHubAuthError("exchange", `GitHub token request failed: ${String(error)}`);
  }

  if (!response.ok) {
    throw new GitHubAuthError("exchange", `GitHub token endpoint returned ${response.status}`);
  }

  const data = (await response.json().catch(() => ({}))) as TokenResponse;
  if (typeof data.access_token !== "string" || data.access_token.length === 0) {
    const description =
      typeof data.error_description === "string" ? data.error_description : "no access_token";
    throw new GitHubAuthError("exchange", description);
  }

  return data.access_token;
}

/** GitHub API에서 로그인 사용자의 최소 프로필만 가져옵니다. */
export async function fetchGitHubProfile(accessToken: string): Promise<GitHubProfile> {
  let response: Response;
  try {
    response = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "notepad-worker",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
  } catch (error) {
    throw new GitHubAuthError("profile", `GitHub profile request failed: ${String(error)}`);
  }

  if (!response.ok) {
    throw new GitHubAuthError("profile", `GitHub profile endpoint returned ${response.status}`);
  }

  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (
    !data ||
    typeof data.id !== "number" ||
    typeof data.login !== "string" ||
    data.login.length === 0
  ) {
    throw new GitHubAuthError("profile", "GitHub profile payload is missing required fields");
  }

  return {
    id: data.id,
    login: data.login,
    name: typeof data.name === "string" ? data.name : null,
    avatar_url: typeof data.avatar_url === "string" ? data.avatar_url : null,
  };
}
