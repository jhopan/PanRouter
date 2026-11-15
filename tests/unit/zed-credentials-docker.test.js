/**
 * Zed IDE credential reader — Docker short-circuit.
 *
 * Inside a container the OS keychain belongs to the host and the keychain CLIs
 * (security / secret-tool / powershell) do not exist, so the reader must report
 * that instead of shelling out to a missing binary.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/oauth/utils/dockerDetect.js", () => ({
  isRunningInDocker: vi.fn(() => true),
}));

import { isRunningInDocker } from "../../src/lib/oauth/utils/dockerDetect.js";
import {
  readZedIdeCredentials,
  ZED_KEYCHAIN_DOCKER_ERROR,
} from "../../src/lib/oauth/utils/zedCredentials.js";

beforeEach(() => {
  isRunningInDocker.mockReturnValue(true);
});

describe("readZedIdeCredentials in Docker", () => {
  it("short-circuits with found:false and a keychain-unavailable message", async () => {
    const result = await readZedIdeCredentials();

    expect(result.found).toBe(false);
    expect(result.error).toBe(ZED_KEYCHAIN_DOCKER_ERROR);
    expect(result.error).toMatch(/keychain/i);
    expect(result.error).toMatch(/Docker/i);
    expect(result.credentialsUrl).toBeTruthy();
    expect(isRunningInDocker).toHaveBeenCalled();
  });
});