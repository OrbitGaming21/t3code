// @effect-diagnostics nodeBuiltinImport:off - Fixtures exercise the native updater filesystem boundary.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { expect, it, vi } from "vite-plus/test";
import { decodeLocalInstallerManifest, LocalInstaller } from "./localInstaller.ts";

async function fixture() {
  const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-local-installer-"));
  const artifact = "local.dmg";
  const contents = "installer contents";
  const manifest = {
    version: "0.0.200",
    artifact,
    sha256: NodeCrypto.createHash("sha256").update(contents).digest("hex"),
    changes: ["Smaller menu dropdown"],
  };
  await NodeFSP.writeFile(NodePath.join(directory, artifact), contents);
  await NodeFSP.writeFile(NodePath.join(directory, "latest.json"), JSON.stringify(manifest));
  return {
    directory,
    manifest,
    async [Symbol.asyncDispose]() {
      await NodeFSP.rm(directory, { recursive: true, force: true });
    },
  };
}

function fakeHost() {
  return {
    stage: vi.fn(
      async (_artifact: string, version: string) => `/Applications/.staged-${version}.app`,
    ),
    swapAndRelaunch: vi.fn(async () => {}),
  };
}

it("offers a completed local build, stages it, and swaps it in on request", async () => {
  await using data = await fixture();
  const host = fakeHost();
  const updater = new LocalInstaller(data.directory, "0.0.100", host);
  const available = vi.fn();
  const downloaded = vi.fn();
  updater.on("update-available", available);
  updater.on("update-downloaded", downloaded);
  await updater.checkForUpdates();
  expect(available).toHaveBeenCalledWith({
    version: "0.0.200",
    releaseNotes: "- Smaller menu dropdown",
  });
  expect(host.stage).not.toHaveBeenCalled();
  await updater.downloadUpdate();
  expect(host.stage).toHaveBeenCalledWith(
    NodePath.join(await NodeFSP.realpath(data.directory), data.manifest.artifact),
    "0.0.200",
  );
  expect(downloaded).toHaveBeenCalledWith({ version: "0.0.200" });
  expect(host.swapAndRelaunch).not.toHaveBeenCalled();
  await updater.install();
  expect(host.swapAndRelaunch).toHaveBeenCalledWith("/Applications/.staged-0.0.200.app", "0.0.200");
});

it("refuses to stage a tampered installer", async () => {
  await using data = await fixture();
  const host = fakeHost();
  const updater = new LocalInstaller(data.directory, "0.0.100", host);
  await updater.checkForUpdates();
  await NodeFSP.writeFile(NodePath.join(data.directory, data.manifest.artifact), "tampered");
  await expect(updater.downloadUpdate()).rejects.toThrow("checksum");
  await expect(updater.install()).rejects.toThrow("Prepare");
  expect(host.stage).not.toHaveBeenCalled();
  expect(host.swapAndRelaunch).not.toHaveBeenCalled();
});

it("does not offer the installed build or an older local build", async () => {
  await using data = await fixture();
  for (const current of ["0.0.200", "0.0.300"]) {
    const updater = new LocalInstaller(data.directory, current, fakeHost());
    const available = vi.fn();
    const unchanged = vi.fn();
    updater.on("update-available", available);
    updater.on("update-not-available", unchanged);
    await updater.checkForUpdates();
    expect(available).not.toHaveBeenCalled();
    expect(unchanged).toHaveBeenCalledOnce();
  }
});

it("rejects manifests that escape the local installer directory", async () => {
  await using data = await fixture();
  for (const artifact of ["../other.dmg", "/other.dmg", "..\\other.dmg", "other.app"]) {
    expect(() => decodeLocalInstallerManifest({ ...data.manifest, artifact })).toThrow();
  }
});
