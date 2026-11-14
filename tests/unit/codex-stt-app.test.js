import { it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(), refresh: vi.fn(), core: vi.fn(), clear: vi.fn(), mark: vi.fn(), proxy: vi.fn(),
}));

vi.mock("@/sse/services/auth.js", () => ({ extractApiKey: () => null, isValidApiKey: vi.fn(), getProviderCredentials: mocks.get, clearAccountError: mocks.clear, markAccountUnavailable: mocks.mark }));
vi.mock("@/lib/localDb", () => ({ getSettings: async () => ({}), getCustomModels: async () => [] }));
vi.mock("@/sse/services/model.js", () => ({ getModelInfo: async () => ({ provider: "codex", model: "transcribe" }) }));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: mocks.refresh }));
vi.mock("@/lib/network/connectionProxy.js", () => ({ resolveConnectionProxyConfig: mocks.proxy }));
vi.mock("open-sse/handlers/sttCore.js", () => ({ handleSttCore: mocks.core }));

import { handleStt } from "@/sse/handlers/stt.js";

const credentials = { authType: "oauth", accessToken: "initial", refreshToken: "refresh", connectionId: "one", providerSpecificData: { workspaceId: "test-account" } };

function request() {
  const form = new FormData();
  form.set("model", "cx/transcribe");
  form.set("file", new File(["test"], "a.wav"));
  return new Request("http://localhost/v1/audio/transcriptions", { method: "POST", body: form });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.get.mockResolvedValue(credentials);
  mocks.refresh.mockImplementation(async (_provider, creds, options) => ({ ...creds, accessToken: options?.force ? "retried" : "refreshed" }));
  mocks.proxy.mockResolvedValue({ source: "none", strictProxy: false });
  mocks.core.mockResolvedValue({ success: true, response: Response.json({ text: "hello" }) });
});

it("refreshes shared OAuth credentials and passes resolved proxy and cancellation through the existing STT handler", async () => {
  const req = request();
  const response = await handleStt(req);
  expect(response.status).toBe(200);
  expect(mocks.refresh).toHaveBeenCalledWith("codex", credentials);
  expect(mocks.core.mock.calls[0][0]).toMatchObject({ credentials: { accessToken: "refreshed" }, signal: req.signal, proxyOptions: { source: "none" } });
  expect(mocks.clear).toHaveBeenCalled();
});

it("retries one 401 with persisted forced refresh", async () => {
  mocks.core.mockResolvedValueOnce({ success: false, status: 401, error: "failed" });
  expect((await handleStt(request())).status).toBe(200);
  expect(mocks.refresh).toHaveBeenLastCalledWith("codex", expect.objectContaining({ accessToken: "refreshed" }), { force: true });
  expect(mocks.core).toHaveBeenCalledTimes(2);
});

it("returns client errors from Codex transcription without burning the account", async () => {
  mocks.core.mockResolvedValue({ success: false, status: 413, error: "Audio exceeds 25 MiB" });
  const response = await handleStt(request());
  expect(response.status).toBe(413);
  expect(mocks.mark).not.toHaveBeenCalled();
});