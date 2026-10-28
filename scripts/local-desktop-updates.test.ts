// @effect-diagnostics nodeBuiltinImport:off - Fixtures verify installer publication on the native filesystem.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it } from "vite-plus/test";
import {
  isLocalBuildInput,
  publishLocalInstaller,
  sourceFingerprint,
} from "./local-desktop-updates.ts";

it("watches shipped app sources and excludes build output, docs, and test edits", () => {
  expect(isLocalBuildInput("apps/desktop/src/updates/localInstaller.ts")).toBe(true);
  expect(isLocalBuildInput("apps/web/src/index.css")).toBe(true);
  expect(isLocalBuildInput("packages/contracts/src/ipc.ts")).toBe(true);
  for (const file of [
    ".t3/local-updates/latest.json",
    "apps/web/dist/index.html",
    "apps/desktop/dist-electron/main.js",
    "apps/web/src/test.test.tsx",
    "docs/user/usage.md",
    "apps/mobile/src/index.ts",
  ])
    expect(isLocalBuildInput(file)).toBe(false);
});

it("publishes only a complete installer and retains the previous update after a failed publication", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-local-publish-"));
  try {
    const artifact = NodePath.join(directory, "build.dmg");
    const destination = NodePath.join(directory, "feed");
    await NodeFSP.writeFile(artifact, "complete build");
    await publishLocalInstaller(destination, artifact, "0.0.100", "source", ["Menu sizes"]);
    const published = await NodeFSP.readFile(NodePath.join(destination, "latest.json"), "utf8");
    const manifest = JSON.parse(published);
    expect(manifest.sha256).toBe(
      NodeCrypto.createHash("sha256")
        .update(await NodeFSP.readFile(NodePath.join(destination, manifest.artifact)))
        .digest("hex"),
    );
    await expect(
      publishLocalInstaller(
        destination,
        NodePath.join(directory, "missing.dmg"),
        "0.0.200",
        "other",
        [],
      ),
    ).rejects.toThrow();
    expect(await NodeFSP.readFile(NodePath.join(destination, "latest.json"), "utf8")).toBe(
      published,
    );
  } finally {
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});

it("retains the latest three local installers", async () => {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-local-retention-"));
  try {
    const artifact = NodePath.join(directory, "build.dmg");
    const feed = NodePath.join(directory, "feed");
    await NodeFSP.writeFile(artifact, "installer");
    for (const version of ["0.0.9", "0.0.10", "0.0.11", "0.0.12"])
      await publishLocalInstaller(feed, artifact, version, version, []);
    expect((await NodeFSP.readdir(feed)).filter((file) => file.endsWith(".dmg")).sort()).toEqual([
      "T3-Code-local-0.0.10.dmg",
      "T3-Code-local-0.0.11.dmg",
      "T3-Code-local-0.0.12.dmg",
    ]);
  } finally {
    await NodeFSP.rm(directory, { recursive: true, force: true });
  }
});

it("detects source edits while ignoring temporary build version alignment", async () => {
  const checkout = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-local-source-"));
  try {
    NodeChildProcess.execFileSync("git", ["init", "--quiet", checkout]);
    await NodeFSP.mkdir(NodePath.join(checkout, "apps/web/src"), { recursive: true });
    const source = NodePath.join(checkout, "apps/web/src/index.ts");
    const manifest = NodePath.join(checkout, "apps/web/package.json");
    await NodeFSP.writeFile(source, "original source");
    await NodeFSP.writeFile(manifest, JSON.stringify({ name: "web", version: "0.1.2" }));
    const original = await sourceFingerprint(checkout);
    await NodeFSP.writeFile(manifest, JSON.stringify({ name: "web", version: "0.0.200" }));
    expect(await sourceFingerprint(checkout)).toBe(original);
    await NodeFSP.writeFile(source, "changed source");
    expect(await sourceFingerprint(checkout)).not.toBe(original);
  } finally {
    await NodeFSP.rm(checkout, { recursive: true, force: true });
  }
});
