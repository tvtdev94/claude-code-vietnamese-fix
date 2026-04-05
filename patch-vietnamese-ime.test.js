import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import https from "https";
import { execSync } from "child_process";
import { patchContentJs, patchContentBinary, PATCH_MARKER } from "./patch-vietnamese-ime.js";

const MIN_VERSION = "2.0.64";

// --- Version discovery ---

function getVersions(minVersion) {
  const [minMajor, minMinor, minPatch] = minVersion.split(".").map(Number);
  const versions = new Set();

  try {
    const out = execSync("npm view @anthropic-ai/claude-code versions --json").toString();
    JSON.parse(out).forEach((v) => versions.add(v));
  } catch {
    console.error("Failed to fetch versions from npm, using fallback.");
    ["2.0.64", "2.1.38"].forEach((v) => versions.add(v));
  }

  // For binary tests: also check GCS for latest version
  if (ONLY_PLATFORM && ONLY_PLATFORM !== "js") {
    try {
      const gcsLatest = execSync(
        "curl -s https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/latest"
      ).toString().trim();
      if (gcsLatest && !versions.has(gcsLatest)) {
        console.log("Adding latest GCS version:", gcsLatest);
        versions.add(gcsLatest);
      }
    } catch {
      console.warn("Failed to fetch latest GCS version.");
    }
  }

  return Array.from(versions).filter((v) => {
    const [maj, min, pat] = v.split(".").map(Number);
    if (maj > minMajor) return true;
    if (maj === minMajor) {
      if (min > minMinor) return true;
      if (min === minMinor) return pat >= minPatch;
    }
    return false;
  });
}

const ONLY_VERSION = process.env.ONLY_VERSION;
const ONLY_PLATFORM = process.env.ONLY_PLATFORM;
const VERSIONS = ONLY_VERSION ? ONLY_VERSION.split(",") : getVersions(MIN_VERSION);

if (ONLY_VERSION) {
  console.log("Running tests ONLY for versions:", ONLY_VERSION);
} else {
  console.log("Running tests for all versions from", MIN_VERSION);
}
if (ONLY_PLATFORM) {
  console.log("Running tests ONLY for platform:", ONLY_PLATFORM);
}

const CACHE_DIR = path.join(process.cwd(), ".test-cache");

// --- Downloader helpers ---

async function downloadUrl(url) {
  for (let retry = 0; retry < 2; retry++) {
    try {
      return await new Promise((resolve, reject) => {
        https.get(url, (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} for ${url}`));
            return;
          }
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => resolve(Buffer.concat(chunks).toString("latin1")));
        }).on("error", reject);
      });
    } catch (err) {
      if (retry === 1) throw err;
      console.warn(`Attempt ${retry + 1} failed: ${err.message}`);
    }
  }
}

async function downloadJs(version) {
  const urls = [
    `https://cdn.jsdelivr.net/npm/@anthropic-ai/claude-code@${version}/cli.js`,
    `https://unpkg.com/@anthropic-ai/claude-code@${version}/cli.js`,
  ];
  for (const url of urls) {
    try {
      return await downloadUrl(url);
    } catch (e) {
      if (url === urls[urls.length - 1]) throw e;
    }
  }
}

async function downloadBinary(version, platform) {
  const ext = platform.startsWith("win") ? ".exe" : "";
  const url = `https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/${version}/${platform}/claude${ext}`;
  try {
    return await downloadUrl(url);
  } catch (e) {
    if (e.message.includes("404")) {
      const err = new Error("RESULT_IGNORED: 404 not found");
      err.code = "404";
      throw err;
    }
    throw e;
  }
}

// --- JS patch tests ---

describe("Claude Code Vietnamese Patch", () => {
  describe.skipIf(ONLY_PLATFORM && ONLY_PLATFORM !== "js")("JS (cli.js) patch", () => {
    const JS_CACHE_DIR = path.join(CACHE_DIR, "js");
    if (!fs.existsSync(JS_CACHE_DIR)) fs.mkdirSync(JS_CACHE_DIR, { recursive: true });

    it.concurrent.each(VERSIONS)(
      "should patch cli.js v%s and run --help",
      async (v) => {
        const filePath = path.join(JS_CACHE_DIR, `cli-${v}.js`);
        const patchedPath = path.join(JS_CACHE_DIR, `cli-${v}-patched.js`);

        let content;
        if (!fs.existsSync(filePath)) {
          content = await downloadJs(v);
          fs.writeFileSync(filePath, content, "latin1");
        } else {
          content = fs.readFileSync(filePath, "latin1");
        }

        let result;
        try {
          result = patchContentJs(content);
          if (result.success && result.content) {
            fs.writeFileSync(patchedPath, result.content, "latin1");
            try {
              execSync(`node "${patchedPath}" --help`, { stdio: "pipe" });
              console.log(`[OK] JS v${v} patched and runs --help`);
            } catch (e) {
              throw new Error(`Execution test failed: ${e.stderr?.toString() || e.message}`);
            }
          }
        } catch (e) {
          result = { success: false, message: e.message };
        }

        expect(result.success, `JS patch failed v${v}: ${result?.message}`).toBe(true);
      },
      300_000
    );
  });

  // --- Binary patch tests ---

  const BINARY_PLATFORMS = [
    "darwin-arm64",
    "darwin-x64",
    "linux-x64",
    "linux-arm64",
    "linux-x64-musl",
    "linux-arm64-musl",
    "win32-x64",
    "win32-arm64",
  ].filter((p) => !ONLY_PLATFORM || ONLY_PLATFORM === p);

  describe.runIf(BINARY_PLATFORMS.length > 0).each(BINARY_PLATFORMS)(
    "Binary patch on %s",
    (platform) => {
      const BIN_CACHE_DIR = path.join(CACHE_DIR, platform);
      if (!fs.existsSync(BIN_CACHE_DIR)) fs.mkdirSync(BIN_CACHE_DIR, { recursive: true });

      it.each(VERSIONS)(
        `should patch binary v%s on ${platform}`,
        async (v) => {
          const ext = platform.startsWith("win") ? ".exe" : "";
          const filePath = path.join(BIN_CACHE_DIR, `claude-${v}${ext}`);
          const patchedPath = path.join(BIN_CACHE_DIR, `claude-${v}-patched${ext}`);

          let content;
          if (!fs.existsSync(filePath)) {
            try {
              content = await downloadBinary(v, platform);
              fs.writeFileSync(filePath, content, "latin1");
            } catch (e) {
              if (e.code === "404") {
                console.log(`RESULT_IGNORED: ${v}:${platform}`);
                return;
              }
              throw e;
            }
          } else {
            content = fs.readFileSync(filePath, "latin1");
          }

          let result;
          try {
            result = patchContentBinary(content);
            if (result.success && result.content) {
              fs.writeFileSync(patchedPath, result.content, "latin1");
              if (!platform.startsWith("win")) fs.chmodSync(patchedPath, 0o755);

              // Run --help if platform matches current OS
              const currentPlatform = `${process.platform}-${process.arch}`;
              let normalized = currentPlatform;
              if (normalized.startsWith("linux-")) {
                try {
                  if (execSync("ldd --version", { stdio: "pipe" }).toString().includes("musl")) {
                    normalized += "-musl";
                  }
                } catch {}
              }

              if (platform === normalized) {
                try {
                  execSync(`"${patchedPath}" --help`, { stdio: "pipe" });
                  console.log(`[OK] Binary ${platform} v${v} runs --help`);
                } catch (e) {
                  throw new Error(`Execution test failed: ${e.stderr?.toString() || e.message}`);
                }
              }
            }
          } catch (e) {
            result = { success: false, message: e.message };
          }

          expect(result.success, `Binary patch failed ${platform} v${v}: ${result?.message}`).toBe(true);
        },
        300_000
      );
    }
  );
});
