export interface AuthResult {
  valid: boolean;
  organizationId: string;
  workspaceId: string;
  reason?: string;
}

/**
 * Validates an API key against the Actium portal database.
 * In production, this would call the Actium API or query the database directly.
 */
export async function validateApiKey(
  apiKey: string,
  workspaceId: string
): Promise<AuthResult> {
  if (!apiKey || !workspaceId) {
    return {
      valid: false,
      organizationId: "",
      workspaceId: "",
      reason: "Missing API key or workspace ID",
    };
  }

  // TODO: Replace with actual Actium portal API call
  // This would typically:
  // 1. Look up the API key in the database
  // 2. Check it's not expired or revoked
  // 3. Verify it has tunnelEnabled = true
  // 4. Verify the workspace ID matches the key's scope
  // 5. Return the organization ID for the key

  try {
    const response = await fetch(
      `${getPortalApiUrl()}/internal/tunnel/validate`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Secret": getInternalSecret(),
        },
        body: JSON.stringify({ apiKey, workspaceId }),
      }
    );

    if (!response.ok) {
      return {
        valid: false,
        organizationId: "",
        workspaceId,
        reason: `Portal returned HTTP ${response.status}`,
      };
    }

    const data = (await response.json()) as {
      valid: boolean;
      organizationId?: string;
      reason?: string;
    };

    return {
      valid: data.valid,
      organizationId: data.organizationId ?? "",
      workspaceId,
      reason: data.reason,
    };
  } catch (err) {
    console.error("[auth] Failed to validate API key:", err);
    return {
      valid: false,
      organizationId: "",
      workspaceId,
      reason: "Failed to reach portal for validation",
    };
  }
}

function getPortalApiUrl(): string {
  return process.env.PORTAL_API_URL ?? "http://localhost:3000/api";
}

function getInternalSecret(): string {
  return process.env.INTERNAL_SECRET ?? "";
}
