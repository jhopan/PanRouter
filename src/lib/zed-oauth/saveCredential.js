import { createProviderConnection } from "@/models";
import {
  fetchZedAuthenticatedUser,
  resolveZedOrganizationId,
} from "open-sse/shared/zedAuth.js";

/**
 * Persist one confirmed Zed credential.
 *
 * `zed` credentials are IDE sessions: validate the access token against
 * cloud.zed.dev, then save them exactly like /api/oauth/zed/import does.
 * Any other supported provider id is treated as an API key, matching the
 * upstream import route.
 *
 * Dependencies are injectable so the import route can be tested without a DB
 * or network.
 */
export async function saveZedCredential(credential, options = {}) {
  const create =
    options.createConnection || ((data) => createProviderConnection(data));
  const fetchUser = options.fetchUser || fetchZedAuthenticatedUser;
  const resolveOrganizationId =
    options.resolveOrganizationId || resolveZedOrganizationId;
  const systemId = options.systemId || credential.systemId || "";

  if (credential.provider !== "zed") {
    return create({
      provider: credential.provider,
      authType: "apikey",
      apiKey: credential.token,
      name: `Zed Import (${credential.account || credential.service})`,
      isActive: true,
    });
  }

  // Fail before persisting when the token is not a live Zed session.
  const credentials = {
    accessToken: credential.token,
    providerSpecificData: { userId: credential.account, systemId },
  };
  const userInfo = await fetchUser(credentials);
  const organizationId = resolveOrganizationId(credentials, userInfo) || "";

  const connection = await create({
    provider: "zed",
    authType: "oauth",
    accessToken: credential.token,
    refreshToken: null,
    expiresAt: null,
    email: userInfo?.email || null,
    displayName:
      userInfo?.name ||
      userInfo?.display_name ||
      userInfo?.username ||
      `Zed ${credential.account}`,
    providerSpecificData: {
      authMethod: "imported",
      userId: credential.account,
      systemId,
      organizationId,
    },
    testStatus: "active",
  });

  return connection;
}