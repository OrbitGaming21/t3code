import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off - This standalone watcher uses Node filesystem events and timers.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import Plist from "plist";

const root = NodePath.resolve(NodeURL.fileURLToPath(new URL("..", import.meta.url)));
const updateDirectory = NodePath.join(root, ".t3", "local-updates");

export function isLocalBuildInput(file: string) {
  return (
    /^(apps\/(desktop|server|web)\/|packages\/|scripts\/|package\.json$|pnpm-(lock|workspace)\.yaml$|tsconfig\.base\.json$)/.test(
      file,
    ) &&
    !/(^|\/)(node_modules|dist|dist-electron|target|\.generated|\.git)\//.test(file) &&
    !/\.(test|spec)\.[^.]+$|\.md$/.test(file)
  );
}

export async function sourceFingerprint(checkout: string) {
  const files = NodeChildProcess.execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: checkout, maxBuffer: 32 * 1024 * 1024 },
  )
    .toString()
    .split("\0")
    .filter(isLocalBuildInput)
    .sort();
  const hash = NodeCrypto.createHash("sha256");
  for (const file of files) {
    let contents;
    try {
      contents = await NodeFSP.readFile(NodePath.join(checkout, file));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (NodePath.basename(file) === "package.json") {
      const manifest = JSON.parse(contents.toString());
      delete manifest.version;
      delete manifest.buildVersion;
      contents = Buffer.from(JSON.stringify(manifest));
    }
    hash.update(file).update("\0").update(contents).update("\0");
  }
  return hash.digest("hex");
}

export async function publishLocalInstaller(
  directory: string,
  artifactPath: string,
  version: string,
  fingerprint: string,
  changes: string[],
) {
  const artifact = `T3-Code-local-${version}.dmg`;
  const hash = NodeCrypto.createHash("sha256");
  for await (const chunk of NodeFS.createReadStream(artifactPath)) hash.update(chunk);
  const sha256 = hash.digest("hex");
  await NodeFSP.mkdir(directory, { recursive: true });
  const destination = NodePath.join(directory, artifact);
  await NodeFSP.copyFile(artifactPath, `${destination}.tmp`);
  await NodeFSP.rename(`${destination}.tmp`, destination);
  await NodeFSP.writeFile(
    NodePath.join(directory, "latest.json.tmp"),
    JSON.stringify({ version, artifact, sha256, fingerprint, changes }),
  );
  await NodeFSP.rename(
    NodePath.join(directory, "latest.json.tmp"),
    NodePath.join(directory, "latest.json"),
  );
  const installers = (await NodeFSP.readdir(directory))
    .filter((file) => /^T3-Code-local-0\.0\.\d+\.dmg$/.test(file))
    .sort((left, right) => right.localeCompare(left, "en", { numeric: true }));
  for (const file of installers.slice(3)) await NodeFSP.rm(NodePath.join(directory, file));
}

function run(command: string, args: string[], env = process.env) {
  return new Promise<void>((resolveRun, reject) => {
    const child = NodeChildProcess.spawn(command, args, { cwd: root, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0 ? resolveRun() : reject(new Error(`${command} failed (${signal ?? code}).`)),
    );
  });
}

async function main() {
  if (Effect.runSync(HostProcess.Platform) !== "darwin")
    throw new Error("Local desktop installers currently require macOS.");
  const once = process.argv.includes("--once");
  if (process.argv.includes("--install") || process.argv.includes("--uninstall")) {
    const home = Effect.runSync(HostProcess.HomeDirectory);
    const label = `codes.t3.local-updates.${NodeCrypto.createHash("sha256").update(root).digest("hex").slice(0, 12)}`;
    const agents = NodePath.join(home, "Library", "LaunchAgents");
    const plistPath = NodePath.join(agents, `${label}.plist`);
    const domain = `gui/${process.getuid!()}`;
    if (process.argv.includes("--uninstall")) {
      await run("launchctl", ["bootout", domain, plistPath]);
      await NodeFSP.rm(plistPath);
      console.log("[local-updates] Background watcher removed. Existing installers are kept.");
      return;
    }
    await NodeFSP.mkdir(agents, { recursive: true });
    await NodeFSP.mkdir(updateDirectory, { recursive: true });
    const log = NodePath.join(updateDirectory, "watcher.log");
    await NodeFSP.writeFile(
      plistPath,
      Plist.build({
        Label: label,
        ProgramArguments: [
          process.execPath,
          NodePath.join(root, "scripts", "local-desktop-updates.ts"),
        ],
        WorkingDirectory: root,
        RunAtLoad: true,
        KeepAlive: true,
        ThrottleInterval: 30,
        EnvironmentVariables: {
          PATH: `${NodePath.join(root, "node_modules", ".bin")}:${NodePath.join(home, ".cargo", "bin")}:${process.env.PATH ?? "/usr/bin:/bin"}`,
        },
        StandardOutPath: log,
        StandardErrorPath: log,
      }),
    );
    await run("launchctl", ["bootstrap", domain, plistPath]);
    console.log(`[local-updates] Background watcher installed. Build log: ${log}`);
    return;
  }
  await NodeFSP.mkdir(updateDirectory, { recursive: true });
  const configPath = NodePath.join(updateDirectory, "local-updates.json");
  await NodeFSP.writeFile(configPath, JSON.stringify({ directory: updateDirectory }));
  let published: string | undefined;
  try {
    published = JSON.parse(
      await NodeFSP.readFile(NodePath.join(updateDirectory, "latest.json"), "utf8"),
    ).fingerprint;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let building = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = new Set<string>();
  const build = async () => {
    if (building) return;
    building = true;
    let output: string | undefined;
    const batch = [...changed];
    changed.clear();
    try {
      const fingerprint = await sourceFingerprint(root);
      if (fingerprint === published) return;
      const version = `0.0.${Date.now()}`;
      output = NodePath.join(updateDirectory, "builds", version);
      console.log(`[local-updates] Building ${version}.`);
      await run(
        process.execPath,
        [
          "scripts/build-desktop-artifact.ts",
          "--platform",
          "mac",
          "--target",
          "dmg",
          "--arch",
          Effect.runSync(HostProcess.Architecture),
          "--build-version",
          version,
          "--output-dir",
          output,
        ],
        {
          ...process.env,
          T3CODE_DESKTOP_SIGNED: "false",
          T3CODE_DESKTOP_LOCAL_UPDATE_CONFIG: configPath,
        },
      );
      if ((await sourceFingerprint(root)) !== fingerprint) {
        console.log(
          "[local-updates] Source changed during the build; rebuilding before offering an update.",
        );
        changed.add("Source changed during build");
        return;
      }
      const artifact = (await NodeFSP.readdir(output)).find((file) => file.endsWith(".dmg"));
      if (!artifact) throw new Error("The build produced no macOS installer.");
      const changes = batch.length
        ? batch.slice(0, 20).map((file) => `Updated ${file}`)
        : ["Latest changes from this checkout"];
      await publishLocalInstaller(
        updateDirectory,
        NodePath.join(output, artifact),
        version,
        fingerprint,
        changes,
      );
      published = fingerprint;

      console.log(
        `[local-updates] Ready: ${NodePath.join(updateDirectory, `T3-Code-local-${version}.dmg`)}\n[local-updates] Install the first build once. Later builds appear in the app’s Update button.`,
      );
    } finally {
      if (output) await NodeFSP.rm(output, { recursive: true, force: true });
      building = false;
      if (!once && changed.size) schedule();
    }
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void build().catch((error) =>
        console.error(
          "[local-updates] Build failed; the previous update is still available.",
          error,
        ),
      );
    }, 30_000);
  };
  if (once) return build();
  const watcher = NodeFS.watch(root, { recursive: true }, (_event, filename) => {
    if (!filename || !isLocalBuildInput(filename)) return;
    changed.add(filename);
    if (!building) schedule();
  });
  watcher.on("error", (error) => {
    console.error(error);
    process.exitCode = 1;
    watcher.close();
  });
  console.log(
    "[local-updates] Watching this checkout. Changes build after 30 seconds without edits.",
  );
  await build().catch((error) => console.error("[local-updates] Initial build failed.", error));
}

if (import.meta.main)
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
