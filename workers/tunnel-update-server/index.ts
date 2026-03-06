/**
 * Actium Tunnel Update Server
 *
 * Deployed to: releases.actium.io
 * Serves update manifests for the Tauri updater.
 *
 * Reads from a `tunnel/latest.json` file in Cloudflare R2.
 * Returns the manifest if an update is available, or 204 if up to date.
 */

interface Env {
  RELEASES_BUCKET: R2Bucket;
}

interface ReleaseManifest {
  version: string;
  notes: string;
  pub_date: string;
  platforms: Record<
    string,
    {
      signature: string;
      url: string;
    }
  >;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    // Health check
    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }

    // Path: /tunnel/{target}/{arch}/{current_version}
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 4 || parts[0] !== "tunnel") {
      return new Response("Not found", { status: 404 });
    }

    const [, target, arch, currentVersion] = parts;
    const platformKey = `${target}-${arch}`;

    // Load the latest release manifest from R2
    const object = await env.RELEASES_BUCKET.get("tunnel/latest.json");
    if (!object) {
      return new Response(null, { status: 204 });
    }

    const manifest: ReleaseManifest = await object.json();
    const platformRelease = manifest.platforms[platformKey];

    if (!platformRelease) {
      // No build for this platform
      return new Response(null, { status: 204 });
    }

    // Compare semver — if current >= latest, no update needed
    if (semverGte(currentVersion, manifest.version)) {
      return new Response(null, { status: 204 });
    }

    // Return the full manifest (Tauri updater expects this shape)
    return new Response(JSON.stringify(manifest), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300", // 5 min cache
      },
    });
  },
} satisfies ExportedHandler<Env>;

/**
 * Simple semver comparison: returns true if a >= b
 */
function semverGte(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return true;
    if (va < vb) return false;
  }
  return true; // equal
}
