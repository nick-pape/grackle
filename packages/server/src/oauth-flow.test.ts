import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import http from "node:http";
import { createHash } from "node:crypto";
import { SESSION_COOKIE_NAME, clearSessions, clearPairing, generatePairingCode, clearOAuthState } from "@grackle-ai/auth";

// Mock logger
vi.mock("./logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  },
}));

// Mock api-key so we don't need a real file
const MOCK_API_KEY = "x".repeat(64);
vi.mock("./api-key.js", () => ({
  loadOrCreateApiKey: () => MOCK_API_KEY,
  verifyApiKey: (token: string) => token === MOCK_API_KEY,
}));

const REDIRECT_URI = "http://127.0.0.1:19876/callback";
const CODE_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CODE_CHALLENGE = createHash("sha256").update(CODE_VERIFIER).digest("base64url");

/**
 * Make an HTTP request and return response details.
 * Does NOT follow redirects — returns the redirect response itself.
 */
function request(
  server: http.Server,
  method: string,
  path: string,
  options: {
    headers?: Record<string, string>;
    body?: string;
    contentType?: string;
  } = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: addr.port,
        path,
        method,
        headers: {
          ...options.headers,
          ...(options.contentType ? { "Content-Type": options.contentType } : {}),
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        res.on("end", () => resolve({ status: res.statusCode!, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

describe("OAuth flow integration", () => {
  let server: http.Server;
  let webPort: number;

  beforeEach(async () => {
    clearSessions();
    clearPairing();
    clearOAuthState();

    // Dynamically import modules after mocks are applied
    const {
      createSession, validateSessionCookie,
      redeemPairingCode,
      registerClient, getClient,
      createAuthorizationCode, consumeAuthorizationCode,
      createRefreshToken, consumeRefreshToken,
      createOAuthAccessToken, OAUTH_ACCESS_TOKEN_TTL_MS,
    } = await import("@grackle-ai/auth");

    server = http.createServer(async (req, res) => {
      const urlParts = (req.url || "/").split("?");
      const rawPath = decodeURIComponent(urlParts[0]);
      const queryString = urlParts[1] || "";
      const addr = server.address() as { port: number };
      const webBaseUrl = `http://127.0.0.1:${addr.port}`;

      // OAuth Authorization Server Metadata
      if (rawPath === "/.well-known/oauth-authorization-server") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          issuer: webBaseUrl,
          authorization_endpoint: `${webBaseUrl}/authorize`,
          token_endpoint: `${webBaseUrl}/token`,
          registration_endpoint: `${webBaseUrl}/register`,
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
        }));
        return;
      }

      // Dynamic Client Registration
      if (rawPath === "/register" && req.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk as Buffer);
        }
        const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          redirect_uris?: string[];
          client_name?: string;
        };
        if (!parsed.redirect_uris || parsed.redirect_uris.length === 0) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_request" }));
          return;
        }
        const client = registerClient(parsed.redirect_uris, parsed.client_name);
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          client_id: client.clientId,
          redirect_uris: client.redirectUris,
          client_name: client.clientName,
        }));
        return;
      }

      // Authorize GET
      if (rawPath === "/authorize" && req.method === "GET") {
        const params = new URLSearchParams(queryString);
        const clientId = params.get("client_id") || "";
        const client = getClient(clientId);
        if (!client) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "invalid_request" }));
          return;
        }
        const cookieHeader = req.headers.cookie || "";
        const hasPaired = validateSessionCookie(cookieHeader, MOCK_API_KEY);
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(hasPaired ? "Authorize page (paired)" : "Authorize page (unpaired)");
        return;
      }

      // Authorize POST — simplified for testing
      if (rawPath === "/authorize" && req.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk as Buffer);
        }
        const formData = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
        const action = formData.get("action") || "";
        const oauthParamsStr = formData.get("oauth_params") || "";
        const pairingCodeValue = formData.get("pairing_code") || "";

        const oauthParams = new URLSearchParams(oauthParamsStr);
        const clientId = oauthParams.get("client_id") || "";
        const redirectUri = oauthParams.get("redirect_uri") || "";
        const codeChallenge = oauthParams.get("code_challenge") || "";
        const state = oauthParams.get("state") || "";
        const resource = oauthParams.get("resource") || "";

        const buildRedirect = (p: Record<string, string>): string => {
          const qs = new URLSearchParams(p);
          if (state) { qs.set("state", state); }
          return `${redirectUri}?${qs.toString()}`;
        };

        if (action === "deny") {
          res.writeHead(302, { Location: buildRedirect({ error: "access_denied" }) });
          res.end();
          return;
        }

        // Check session
        const cookieHeader = req.headers.cookie || "";
        let hasPaired = validateSessionCookie(cookieHeader, MOCK_API_KEY);
        const responseHeaders: Record<string, string> = {};

        if (!hasPaired) {
          if (!pairingCodeValue) {
            res.writeHead(400, { "Content-Type": "text/html" });
            res.end("Pairing code required");
            return;
          }
          const remoteIp = req.socket.remoteAddress || "unknown";
          if (!redeemPairingCode(pairingCodeValue, remoteIp)) {
            res.writeHead(400, { "Content-Type": "text/html" });
            res.end("Invalid pairing code");
            return;
          }
          const setCookie = createSession(MOCK_API_KEY);
          responseHeaders["Set-Cookie"] = setCookie;
          hasPaired = true;
        }

        const authCode = createAuthorizationCode(clientId, redirectUri, codeChallenge, resource);
        res.writeHead(302, { ...responseHeaders, Location: buildRedirect({ code: authCode }) });
        res.end();
        return;
      }

      // Token endpoint
      if (rawPath === "/token" && req.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk as Buffer);
        }
        const formData = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
        const grantType = formData.get("grant_type") || "";

        if (grantType === "authorization_code") {
          const code = formData.get("code") || "";
          const clientId = formData.get("client_id") || "";
          const redirectUri = formData.get("redirect_uri") || "";
          const codeVerifier = formData.get("code_verifier") || "";
          const resource = formData.get("resource") || "";

          const record = consumeAuthorizationCode(code, clientId, redirectUri, codeVerifier, resource);
          if (!record) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "invalid_grant" }));
            return;
          }

          const accessToken = createOAuthAccessToken(clientId, resource, MOCK_API_KEY);
          const refreshTokenValue = createRefreshToken(clientId, resource);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            access_token: accessToken,
            token_type: "Bearer",
            expires_in: Math.floor(OAUTH_ACCESS_TOKEN_TTL_MS / 1000),
            refresh_token: refreshTokenValue,
          }));
          return;
        }

        if (grantType === "refresh_token") {
          const refreshTokenVal = formData.get("refresh_token") || "";
          const clientId = formData.get("client_id") || "";
          const record = consumeRefreshToken(refreshTokenVal, clientId);
          if (!record) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "invalid_grant" }));
            return;
          }
          const accessToken = createOAuthAccessToken(clientId, record.resource, MOCK_API_KEY);
          const newRefreshToken = createRefreshToken(clientId, record.resource);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            access_token: accessToken,
            token_type: "Bearer",
            expires_in: Math.floor(OAUTH_ACCESS_TOKEN_TTL_MS / 1000),
            refresh_token: newRefreshToken,
          }));
          return;
        }

        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "unsupported_grant_type" }));
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    webPort = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("serves OAuth authorization server metadata", async () => {
    const res = await request(server, "GET", "/.well-known/oauth-authorization-server");
    expect(res.status).toBe(200);
    const meta = JSON.parse(res.body) as Record<string, unknown>;
    expect(meta.authorization_endpoint).toContain("/authorize");
    expect(meta.token_endpoint).toContain("/token");
    expect(meta.registration_endpoint).toContain("/register");
    expect(meta.code_challenge_methods_supported).toEqual(["S256"]);
  });

  it("registers a client via POST /register", async () => {
    const res = await request(server, "POST", "/register", {
      body: JSON.stringify({ redirect_uris: [REDIRECT_URI], client_name: "Test App" }),
      contentType: "application/json",
    });
    expect(res.status).toBe(201);
    const data = JSON.parse(res.body) as Record<string, unknown>;
    expect(data.client_id).toBeDefined();
    expect(data.redirect_uris).toEqual([REDIRECT_URI]);
    expect(data.client_name).toBe("Test App");
  });

  it("rejects registration without redirect_uris", async () => {
    const res = await request(server, "POST", "/register", {
      body: JSON.stringify({ client_name: "Bad Client" }),
      contentType: "application/json",
    });
    expect(res.status).toBe(400);
  });

  it("completes full OAuth flow with pre-paired session", async () => {
    // Step 1: Register client
    const regRes = await request(server, "POST", "/register", {
      body: JSON.stringify({ redirect_uris: [REDIRECT_URI], client_name: "Claude Code" }),
      contentType: "application/json",
    });
    const { client_id: clientId } = JSON.parse(regRes.body) as { client_id: string };

    // Step 2: Create a paired session first (simulate already-paired user)
    const pairingCode = generatePairingCode()!;
    const pairRes = await request(server, "GET", `/pair?code=${pairingCode}`);
    // This is a simplified server without static file serving for /pair, so just get the cookie
    // For this test, use the actual import to create a session directly
    const { createSession } = await import("@grackle-ai/auth");
    const setCookie = createSession(MOCK_API_KEY);
    const cookieValue = setCookie.split(";")[0];

    // Step 3: GET /authorize
    const resource = `http://127.0.0.1:7435`;
    const authUrl = `/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&code_challenge=${CODE_CHALLENGE}&code_challenge_method=S256&state=mystate&resource=${encodeURIComponent(resource)}`;
    const authPageRes = await request(server, "GET", authUrl, { headers: { Cookie: cookieValue } });
    expect(authPageRes.status).toBe(200);
    expect(authPageRes.body).toContain("paired");

    // Step 4: POST /authorize (approve)
    const oauthParams = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code_challenge: CODE_CHALLENGE,
      state: "mystate",
      resource,
    }).toString();

    const approveRes = await request(server, "POST", "/authorize", {
      headers: { Cookie: cookieValue },
      body: `action=approve&oauth_params=${encodeURIComponent(oauthParams)}`,
      contentType: "application/x-www-form-urlencoded",
    });
    expect(approveRes.status).toBe(302);

    const redirectUrl = new URL(approveRes.headers.location!);
    const authCode = redirectUrl.searchParams.get("code");
    expect(authCode).toBeDefined();
    expect(redirectUrl.searchParams.get("state")).toBe("mystate");

    // Step 5: Exchange code for tokens
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code: authCode!,
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code_verifier: CODE_VERIFIER,
      resource,
    }).toString();

    const tokenRes = await request(server, "POST", "/token", {
      body: tokenBody,
      contentType: "application/x-www-form-urlencoded",
    });
    expect(tokenRes.status).toBe(200);
    const tokens = JSON.parse(tokenRes.body) as {
      access_token: string;
      token_type: string;
      expires_in: number;
      refresh_token: string;
    };
    expect(tokens.access_token).toBeDefined();
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.expires_in).toBe(3600);
    expect(tokens.refresh_token).toBeDefined();

    // Step 6: Refresh token
    const refreshBody = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: clientId,
    }).toString();

    const refreshRes = await request(server, "POST", "/token", {
      body: refreshBody,
      contentType: "application/x-www-form-urlencoded",
    });
    expect(refreshRes.status).toBe(200);
    const newTokens = JSON.parse(refreshRes.body) as {
      access_token: string;
      refresh_token: string;
    };
    expect(newTokens.access_token).toBeDefined();
    expect(newTokens.refresh_token).toBeDefined();
    // Old refresh token should be consumed (rotation)
    expect(newTokens.refresh_token).not.toBe(tokens.refresh_token);
  });

  it("completes OAuth flow with pairing code (unpaired user)", async () => {
    // Register client
    const regRes = await request(server, "POST", "/register", {
      body: JSON.stringify({ redirect_uris: [REDIRECT_URI] }),
      contentType: "application/json",
    });
    const { client_id: clientId } = JSON.parse(regRes.body) as { client_id: string };

    // GET /authorize — no session cookie
    const resource = "http://127.0.0.1:7435";
    const authUrl = `/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&code_challenge=${CODE_CHALLENGE}&code_challenge_method=S256&resource=${encodeURIComponent(resource)}`;
    const authPageRes = await request(server, "GET", authUrl);
    expect(authPageRes.status).toBe(200);
    expect(authPageRes.body).toContain("unpaired");

    // POST /authorize with pairing code
    const pairingCode = generatePairingCode()!;
    const oauthParams = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code_challenge: CODE_CHALLENGE,
      state: "",
      resource,
    }).toString();

    const approveRes = await request(server, "POST", "/authorize", {
      body: `action=approve&oauth_params=${encodeURIComponent(oauthParams)}&pairing_code=${pairingCode}`,
      contentType: "application/x-www-form-urlencoded",
    });
    expect(approveRes.status).toBe(302);

    // Should have set a session cookie AND redirected with auth code
    expect(approveRes.headers["set-cookie"]).toBeDefined();
    const redirectUrl = new URL(approveRes.headers.location!);
    const authCode = redirectUrl.searchParams.get("code");
    expect(authCode).toBeDefined();

    // Exchange code for tokens
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code: authCode!,
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code_verifier: CODE_VERIFIER,
      resource,
    }).toString();

    const tokenRes = await request(server, "POST", "/token", {
      body: tokenBody,
      contentType: "application/x-www-form-urlencoded",
    });
    expect(tokenRes.status).toBe(200);
    const tokens = JSON.parse(tokenRes.body) as { access_token: string; refresh_token: string };
    expect(tokens.access_token).toBeDefined();
    expect(tokens.refresh_token).toBeDefined();
  });

  it("deny action redirects with access_denied error", async () => {
    const regRes = await request(server, "POST", "/register", {
      body: JSON.stringify({ redirect_uris: [REDIRECT_URI] }),
      contentType: "application/json",
    });
    const { client_id: clientId } = JSON.parse(regRes.body) as { client_id: string };

    // Create session
    const { createSession } = await import("@grackle-ai/auth");
    const setCookie = createSession(MOCK_API_KEY);
    const cookieValue = setCookie.split(";")[0];

    const oauthParams = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code_challenge: CODE_CHALLENGE,
      state: "abc",
      resource: "http://127.0.0.1:7435",
    }).toString();

    const denyRes = await request(server, "POST", "/authorize", {
      headers: { Cookie: cookieValue },
      body: `action=deny&oauth_params=${encodeURIComponent(oauthParams)}`,
      contentType: "application/x-www-form-urlencoded",
    });
    expect(denyRes.status).toBe(302);
    const redirectUrl = new URL(denyRes.headers.location!);
    expect(redirectUrl.searchParams.get("error")).toBe("access_denied");
    expect(redirectUrl.searchParams.get("state")).toBe("abc");
  });

  it("rejects token exchange with wrong code_verifier", async () => {
    const regRes = await request(server, "POST", "/register", {
      body: JSON.stringify({ redirect_uris: [REDIRECT_URI] }),
      contentType: "application/json",
    });
    const { client_id: clientId } = JSON.parse(regRes.body) as { client_id: string };

    // Create session and authorize
    const { createSession } = await import("@grackle-ai/auth");
    const setCookie = createSession(MOCK_API_KEY);
    const cookieValue = setCookie.split(";")[0];

    const resource = "http://127.0.0.1:7435";
    const oauthParams = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code_challenge: CODE_CHALLENGE,
      state: "",
      resource,
    }).toString();

    const approveRes = await request(server, "POST", "/authorize", {
      headers: { Cookie: cookieValue },
      body: `action=approve&oauth_params=${encodeURIComponent(oauthParams)}`,
      contentType: "application/x-www-form-urlencoded",
    });
    const redirectUrl = new URL(approveRes.headers.location!);
    const authCode = redirectUrl.searchParams.get("code")!;

    // Try to exchange with wrong verifier
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code: authCode,
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code_verifier: "wrong-verifier-that-does-not-match",
      resource,
    }).toString();

    const tokenRes = await request(server, "POST", "/token", {
      body: tokenBody,
      contentType: "application/x-www-form-urlencoded",
    });
    expect(tokenRes.status).toBe(400);
    const body = JSON.parse(tokenRes.body) as { error: string };
    expect(body.error).toBe("invalid_grant");
  });

  it("rejects unsupported grant_type", async () => {
    const tokenBody = new URLSearchParams({
      grant_type: "client_credentials",
    }).toString();

    const tokenRes = await request(server, "POST", "/token", {
      body: tokenBody,
      contentType: "application/x-www-form-urlencoded",
    });
    expect(tokenRes.status).toBe(400);
    const body = JSON.parse(tokenRes.body) as { error: string };
    expect(body.error).toBe("unsupported_grant_type");
  });

  it("rejects old refresh token after rotation", async () => {
    // Register and get tokens
    const regRes = await request(server, "POST", "/register", {
      body: JSON.stringify({ redirect_uris: [REDIRECT_URI] }),
      contentType: "application/json",
    });
    const { client_id: clientId } = JSON.parse(regRes.body) as { client_id: string };

    const { createSession } = await import("@grackle-ai/auth");
    const setCookie = createSession(MOCK_API_KEY);
    const cookieValue = setCookie.split(";")[0];

    const resource = "http://127.0.0.1:7435";
    const oauthParams = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code_challenge: CODE_CHALLENGE,
      state: "",
      resource,
    }).toString();

    const approveRes = await request(server, "POST", "/authorize", {
      headers: { Cookie: cookieValue },
      body: `action=approve&oauth_params=${encodeURIComponent(oauthParams)}`,
      contentType: "application/x-www-form-urlencoded",
    });
    const redirectUrl = new URL(approveRes.headers.location!);
    const authCode = redirectUrl.searchParams.get("code")!;

    // Get initial tokens
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code: authCode,
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      code_verifier: CODE_VERIFIER,
      resource,
    }).toString();
    const tokenRes = await request(server, "POST", "/token", {
      body: tokenBody,
      contentType: "application/x-www-form-urlencoded",
    });
    const tokens = JSON.parse(tokenRes.body) as { refresh_token: string };

    // Use refresh token once
    const refreshBody = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
      client_id: clientId,
    }).toString();
    const refreshRes = await request(server, "POST", "/token", {
      body: refreshBody,
      contentType: "application/x-www-form-urlencoded",
    });
    expect(refreshRes.status).toBe(200);

    // Try to reuse the old refresh token
    const replayRes = await request(server, "POST", "/token", {
      body: refreshBody,
      contentType: "application/x-www-form-urlencoded",
    });
    expect(replayRes.status).toBe(400);
    const body = JSON.parse(replayRes.body) as { error: string };
    expect(body.error).toBe("invalid_grant");
  });
});
