// @effect-diagnostics nodeBuiltinImport:off - Native updater adapter streams disk images with Node.
import * as NodeFS from "node:fs";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeEvents from "node:events";
import * as NodeChildProcess from "node:child_process";
import * as NodeOS from "node:os";
import * as NodeUtil from "node:util";

const execFile = NodeUtil.promisify(NodeChildProcess.execFile);

export interface LocalInstallerManifest {
  version: string;
  artifact: string;
  sha256: string;
  changes: string[];
}

export function decodeLocalInstallerManifest(value: unknown): LocalInstallerManifest {
  if (typeof value !== "object" || value === null)
    throw new Error("Invalid local update manifest.");
  const manifest = value as Record<string, unknown>;
  if (
    typeof manifest.version !== "string" ||
    !/^0\.0\.\d+$/.test(manifest.version) ||
    typeof manifest.artifact !== "string" ||
    NodePath.basename(manifest.artifact) !== manifest.artifact ||
    !manifest.artifact.endsWith(".dmg") ||
    manifest.artifact.includes("\\") ||
    typeof manifest.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
    !Array.isArray(manifest.changes) ||
    !manifest.changes.every((item) => typeof item === "string")
  )
    throw new Error("Invalid local update manifest.");
  return manifest as unknown as LocalInstallerManifest;
}

export interface LocalInstallerHost {
  /** Copies the app out of a verified disk image next to the installed app; returns its path. */
  stage(artifactPath: string, version: string): Promise<string>;
  /** Hands the swap to a process that outlives this app, then quits. */
  swapAndRelaunch(stagedApp: string, version: string): Promise<void>;
}

export class LocalInstaller extends NodeEvents.EventEmitter {
  private available: LocalInstallerManifest | null = null;
  private staged: { manifest: LocalInstallerManifest; app: string } | null = null;

  private readonly directory: string;
  private readonly currentVersion: string;
  private readonly host: LocalInstallerHost;
  constructor(directory: string, currentVersion: string, host: LocalInstallerHost) {
    super();
    this.directory = directory;
    this.currentVersion = currentVersion;
    this.host = host;
  }

  async checkForUpdates() {
    const manifest = decodeLocalInstallerManifest(
      JSON.parse(await NodeFSP.readFile(NodePath.join(this.directory, "latest.json"), "utf8")),
    );
    const current = /^0\.0\.(\d+)$/.exec(this.currentVersion);
    if (current && Number(manifest.version.slice(4)) <= Number(current[1])) {
      this.emit("update-not-available");
      return;
    }
    this.available = manifest;
    this.emit("update-available", {
      version: manifest.version,
      releaseNotes: manifest.changes.map((item) => `- ${item}`).join("\n"),
    });
  }

  private async verify(manifest: LocalInstallerManifest) {
    const directory = await NodeFSP.realpath(this.directory);
    const artifact = NodePath.join(directory, manifest.artifact);
    if ((await NodeFSP.realpath(artifact)) !== artifact)
      throw new Error("Local update installer must stay inside its update directory.");
    const hash = NodeCrypto.createHash("sha256");
    for await (const chunk of NodeFS.createReadStream(artifact)) hash.update(chunk);
    const digest = hash.digest("hex");
    if (digest !== manifest.sha256)
      throw new Error("Local update installer failed its checksum check.");
    return artifact;
  }

  async downloadUpdate() {
    const manifest = this.available;
    if (!manifest) throw new Error("No local update is ready.");
    const app = await this.host.stage(await this.verify(manifest), manifest.version);
    this.staged = { manifest, app };
    this.emit("update-downloaded", { version: manifest.version });
  }

  async install() {
    if (!this.staged) throw new Error("Prepare the local update before installing it.");
    await this.host.swapAndRelaunch(this.staged.app, this.staged.manifest.version);
  }
}

// Waits for the app to exit, swaps bundles (restoring on failure), then reopens whichever is in place.
const SWAP_SCRIPT = `
pid="$1"; target="$2"; staged="$3"; backup="$4"
i=0
while kill -0 "$pid" 2>/dev/null; do
  i=$((i+1)); [ "$i" -gt 120 ] && { rm -rf "$staged"; exit 1; }
  sleep 0.5
done
rm -rf "$backup"
if mv "$target" "$backup"; then
  mv "$staged" "$target" || mv "$backup" "$target"
fi
open "$target"
`;

export function macLocalInstallerHost(input: {
  readonly appBundle: string;
  readonly directory: string;
  readonly pid: number;
  readonly quit: () => void;
}): LocalInstallerHost {
  const stagedPath = (version: string) =>
    NodePath.join(NodePath.dirname(input.appBundle), `.T3 Code Update-${version}.app`);
  return {
    async stage(artifactPath, version) {
      const mountpoint = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-local-update-"));
      const staged = stagedPath(version);
      try {
        await execFile("/usr/bin/hdiutil", [
          "attach",
          "-nobrowse",
          "-readonly",
          "-noautoopen",
          "-mountpoint",
          mountpoint,
          artifactPath,
        ]);
        try {
          const bundle = (await NodeFSP.readdir(mountpoint)).find((name) => name.endsWith(".app"));
          if (!bundle) throw new Error("The local update contains no app.");
          await NodeFSP.rm(staged, { recursive: true, force: true });
          await execFile("/usr/bin/ditto", [NodePath.join(mountpoint, bundle), staged]);
        } finally {
          await execFile("/usr/bin/hdiutil", ["detach", mountpoint, "-force"]).catch(() => {});
        }
      } finally {
        await NodeFSP.rm(mountpoint, { recursive: true, force: true }).catch(() => {});
      }
      return staged;
    },
    async swapAndRelaunch(stagedApp, version) {
      const backups = NodePath.join(input.directory, "backups");
      // Keep only the backup this update creates; app bundles are hundreds of megabytes.
      await NodeFSP.rm(backups, { recursive: true, force: true });
      await NodeFSP.mkdir(backups, { recursive: true });
      const backup = NodePath.join(
        backups,
        `${NodePath.basename(input.appBundle, ".app")}-before-${version}.app`,
      );
      NodeChildProcess.spawn(
        "/bin/sh",
        [
          "-c",
          SWAP_SCRIPT,
          "t3-local-update",
          String(input.pid),
          input.appBundle,
          stagedApp,
          backup,
        ],
        { detached: true, stdio: "ignore" },
      ).unref();
      input.quit();
    },
  };
}
