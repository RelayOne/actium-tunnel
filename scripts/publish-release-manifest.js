/**
 * publish-release-manifest.js
 *
 * Called by the GitHub Actions release workflow after all platform builds complete.
 * Collects the update signatures from GitHub release assets and writes a
 * latest.json manifest to Cloudflare R2 for the update server to serve.
 *
 * Required env vars:
 *   RELEASE_TAG          - e.g. "v0.2.0"
 *   GITHUB_TOKEN         - GitHub token with release read access
 *   CF_R2_ACCESS_KEY     - Cloudflare R2 access key
 *   CF_R2_SECRET_KEY     - Cloudflare R2 secret key
 *   CF_R2_BUCKET         - R2 bucket name
 *   CF_R2_ENDPOINT       - R2 endpoint URL
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const {
  RELEASE_TAG,
  GITHUB_TOKEN,
  CF_R2_ACCESS_KEY,
  CF_R2_SECRET_KEY,
  CF_R2_BUCKET,
  CF_R2_ENDPOINT,
} = process.env;

if (!RELEASE_TAG || !GITHUB_TOKEN) {
  console.error("Missing RELEASE_TAG or GITHUB_TOKEN");
  process.exit(1);
}

const version = RELEASE_TAG.replace(/^v/, "");
const REPO = "actium/tunnel";

// Platform mapping: Tauri artifact suffix → platform key
const PLATFORM_MAP = {
  "aarch64.dmg.tar.gz": "darwin-aarch64",
  "x86_64.dmg.tar.gz": "darwin-x86_64",
  "x86_64-setup.nsis.zip": "windows-x86_64",
  "amd64.AppImage.tar.gz": "linux-x86_64",
};

async function main() {
  console.log(`Publishing update manifest for ${RELEASE_TAG}...`);

  // Fetch release from GitHub API
  const releaseRes = await fetch(
    `https://api.github.com/repos/${REPO}/releases/tags/${RELEASE_TAG}`,
    {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github.v3+json",
      },
    }
  );

  if (!releaseRes.ok) {
    console.error(`Failed to fetch release: ${releaseRes.status}`);
    process.exit(1);
  }

  const release = await releaseRes.json();
  const assets = release.assets || [];

  // Build platforms object
  const platforms = {};

  for (const [suffix, platformKey] of Object.entries(PLATFORM_MAP)) {
    // Find the artifact and its .sig file
    const artifact = assets.find((a) => a.name.endsWith(suffix));
    const sigFile = assets.find((a) => a.name.endsWith(`${suffix}.sig`));

    if (!artifact) {
      console.warn(`  No artifact found for ${platformKey} (suffix: ${suffix})`);
      continue;
    }

    let signature = "";
    if (sigFile) {
      // Download the signature file content
      const sigRes = await fetch(sigFile.browser_download_url);
      signature = await sigRes.text();
    } else {
      console.warn(`  No signature file for ${platformKey}`);
    }

    platforms[platformKey] = {
      signature: signature.trim(),
      url: artifact.browser_download_url,
    };

    console.log(`  ${platformKey}: ${artifact.name}`);
  }

  if (Object.keys(platforms).length === 0) {
    console.error("No platform artifacts found in release!");
    process.exit(1);
  }

  // Build the manifest
  const manifest = {
    version,
    notes: release.body || "",
    pub_date: release.published_at || new Date().toISOString(),
    platforms,
  };

  console.log(`\nManifest for v${version}:`);
  console.log(JSON.stringify(manifest, null, 2));

  // Upload to R2
  if (CF_R2_ACCESS_KEY && CF_R2_SECRET_KEY && CF_R2_BUCKET && CF_R2_ENDPOINT) {
    const s3 = new S3Client({
      region: "auto",
      endpoint: CF_R2_ENDPOINT,
      credentials: {
        accessKeyId: CF_R2_ACCESS_KEY,
        secretAccessKey: CF_R2_SECRET_KEY,
      },
    });

    await s3.send(
      new PutObjectCommand({
        Bucket: CF_R2_BUCKET,
        Key: "tunnel/latest.json",
        Body: JSON.stringify(manifest),
        ContentType: "application/json",
      })
    );

    console.log("\nUploaded to R2: tunnel/latest.json");
  } else {
    console.log("\nR2 credentials not set — writing manifest to stdout only.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
