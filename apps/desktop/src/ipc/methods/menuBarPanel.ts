import { DEFAULT_USAGE_DISPLAY_SETTINGS, type DesktopMenuBarSummary } from "@t3tools/contracts";

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });

type MenuBarProject = NonNullable<DesktopMenuBarSummary["projects"]>[number];
type MenuBarProjectStatus = MenuBarProject["status"];

export const menuBarProjectKey = (project: MenuBarProject) =>
  `${project.environment ?? ""}\u0000${project.name}`;

/** Projects whose agents finished since the dropdown was last opened. */
export function nextUnseenFinished(
  previous: ReadonlyMap<string, MenuBarProjectStatus>,
  unseen: ReadonlySet<string>,
  projects: readonly MenuBarProject[],
): Set<string> {
  const next = new Set<string>();
  for (const project of projects) {
    const key = menuBarProjectKey(project);
    const before = previous.get(key);
    const finished = project.status === "completed" || project.status === "failed";
    if (finished && (unseen.has(key) || before === "working" || before === "attention")) {
      next.add(key);
    }
  }
  return next;
}

export function menuBarTitle(projects: readonly MenuBarProject[], unseenFinished: number) {
  const needs = projects.filter((project) => project.status === "attention").length;
  const working = projects.filter((project) => project.status === "working").length;
  const parts = [
    needs ? `${needs} ${needs === 1 ? "needs" : "need"} you` : null,
    unseenFinished ? `${unseenFinished} done` : null,
    !needs && !unseenFinished && working ? `${working} working` : null,
  ].filter((part) => part !== null);
  return parts.length ? `T3 Code · ${parts.join(" · ")}` : "T3 Code";
}

export function menuBarPanelHtml(
  summary: DesktopMenuBarSummary,
  newlyFinished: ReadonlySet<string> = new Set(),
) {
  const display = summary.display ?? DEFAULT_USAGE_DISPLAY_SETTINGS;
  const sizes = {
    compact: { usage: 18, reset: 12, body: 11, scale: 0.6 },
    comfortable: { usage: 22, reset: 14, body: 12, scale: 0.8 },
    large: { usage: 26, reset: 17, body: 13, scale: 1 },
  };
  const size = sizes[display.menuSize];
  const projects = summary.projects;
  const projectContent =
    projects === undefined
      ? ""
      : `<section class="projects" aria-label="Project progress"><h2>Project progress</h2><div class="project-list">${projects.length ? projects.map((project) => `<a class="project" href="https://t3-menu.invalid/open-app" data-status="${project.status}"${newlyFinished.has(menuBarProjectKey(project)) ? ' data-new="true"' : ""}><div class="project-top"><strong>${escapeHtml(project.name)}</strong>${newlyFinished.has(menuBarProjectKey(project)) ? '<span class="new">New</span>' : ""}${project.duration ? `<span class="duration">${escapeHtml(project.duration)}</span>` : ""}</div><div class="project-status"><span class="status-dot"></span>${escapeHtml(project.label)}</div>${project.detail ? `<div class="detail">${escapeHtml(project.detail)}</div>` : ""}${project.environment ? `<div class="project-environment">${escapeHtml(project.environment)}</div>` : ""}</a>`).join("") : '<p class="empty">No projects yet</p>'}</div></section>`;
  const content = display.order
    .filter((section) => !display.hidden.includes(section))
    .map((section) => {
      const items = summary.items.filter(
        (item) =>
          (item.section ??
            (item.usedPercent !== undefined
              ? "limits"
              : item.action === "open-scheduled-tasks"
                ? "tasks"
                : "tokens")) === section,
      );
      if (section === "limits")
        return `<section class="quotas">${items
          .map(
            (item) => `<a class="quota" href="https://t3-menu.invalid/${item.action}">
<div class="quota-top"><span class="label">${escapeHtml(item.label)}</span><strong class="usage">${Math.round(item.usedPercent ?? 0)}% <small>used</small></strong></div>
<meter min="0" max="100" low="75" high="90" optimum="0" value="${item.usedPercent ?? 0}" aria-label="${escapeHtml(item.label)} usage"></meter>
<div class="reset">${escapeHtml(item.reset ?? "Reset time unavailable")}</div>
${item.detail ? `<div class="detail">${escapeHtml(item.detail)}</div>` : ""}</a>`,
          )
          .join(
            "",
          )}${items.length === 0 ? '<p class="empty">No provider limits available</p>' : ""}</section>`;
      return items
        .map(
          (item) =>
            `<a class="stat" href="https://t3-menu.invalid/${item.action}"><span class="label">${escapeHtml(item.label)}</span>${item.value ? `<strong class="value">${escapeHtml(item.value)}</strong>` : ""}${item.detail ? `<span class="detail">${escapeHtml(item.detail)}</span>` : ""}</a>`,
        )
        .join("");
    })
    .join("");
  return `<!doctype html>
<html lang="en" data-theme="${summary.theme ?? "system"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>T3 Code usage</title>
<style>
* { box-sizing: border-box; }
:root { --spacing-scale: ${size.scale}; --usage-size: ${size.usage}px; --reset-size: ${size.reset}px; --body-size: ${size.body}px; color-scheme: light dark; --background: light-dark(#fafafa, #1c1c1e); --card: light-dark(#fff, #252527); --text: light-dark(#202124, #f5f5f7); --muted: light-dark(#666b73, #a4a4ac); --border: light-dark(#e4e5e8, #38383b); --track: light-dark(#e9eaed, #3d3d41); --accent: light-dark(#5856d6, #a5a4ff); }
html[data-theme="light"] { color-scheme: light; }
html[data-theme="dark"] { color-scheme: dark; }
body { margin: 0; padding: calc(20px * var(--spacing-scale)); background: var(--background); color: var(--text); font: var(--body-size)/1.4 -apple-system, BlinkMacSystemFont, sans-serif; }
a { color: inherit; text-decoration: none; }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
header { display: flex; align-items: start; justify-content: space-between; gap: calc(16px * var(--spacing-scale)); margin-bottom: calc(18px * var(--spacing-scale)); }
header > div:first-child { min-width: 0; flex: 1; }
h1 { margin: 0; font-size: 17px; font-weight: 650; }
.environment { margin: 3px 0 0; max-width: 100%; color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.open { white-space: nowrap; color: var(--muted); font-size: 12px; padding: 4px 0; }
h2 { margin: 0 0 calc(10px * var(--spacing-scale)); font-size: var(--body-size); font-weight: 650; }
.projects { margin-bottom: calc(18px * var(--spacing-scale)); }
.project-list { display: grid; gap: calc(8px * var(--spacing-scale)); max-height: min(240px, 40vh); overflow-y: auto; }
.project { display: block; min-width: 0; border: 1px solid var(--border); border-radius: 8px; padding: calc(12px * var(--spacing-scale)); background: var(--card); }
.project:hover { border-color: var(--accent); }
.project-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
.project-top strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.duration { flex-shrink: 0; color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.project-status { display: flex; align-items: center; gap: 5px; margin-top: 3px; }
.status-dot { width: 6px; height: 6px; flex-shrink: 0; border-radius: 50%; background: var(--muted); }
.project[data-status="working"] .status-dot { background: var(--accent); }
.project[data-status="attention"] .status-dot { background: #d18b25; }
.project[data-status="failed"] .status-dot { background: #d65353; }
.project[data-status="completed"] .status-dot { background: #389b69; }
.project .detail { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.project[data-status="attention"] { border-color: #d18b25; background: light-dark(#fdf5e9, #33291a); }
.project[data-new="true"] { border-color: #389b69; background: light-dark(#ecf7f1, #1d2e25); }
.project[data-new="true"][data-status="failed"] { border-color: #d65353; background: light-dark(#fcefef, #352020); }
.new { flex-shrink: 0; margin-left: auto; padding: 0 6px; border-radius: 999px; background: #389b69; color: #fff; font-size: 10px; font-weight: 600; }
.project[data-status="failed"] .new { background: #d65353; }
.project-environment { color: var(--muted); font-size: 10px; margin-top: 2px; }
.quotas { display: grid; gap: calc(12px * var(--spacing-scale)); }
.quota { display: block; border: 1px solid var(--border); border-radius: 12px; padding: calc(16px * var(--spacing-scale)); background: var(--card); }
.quota:hover, .stat:hover { border-color: var(--accent); }
.quota-top { display: flex; align-items: center; justify-content: space-between; gap: calc(12px * var(--spacing-scale)); }
.label { color: var(--muted); font-size: var(--body-size); overflow-wrap: anywhere; }
.usage { font-size: var(--usage-size); font-weight: 650; letter-spacing: -1px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.usage small { font-size: 12px; font-weight: 400; letter-spacing: 0; color: var(--muted); }
meter { display: block; appearance: none; width: 100%; height: 6px; margin: calc(10px * var(--spacing-scale)) 0 calc(14px * var(--spacing-scale)); border: 0; border-radius: 6px; background: var(--track); }
meter::-webkit-meter-bar { background: var(--track); border: 0; border-radius: 6px; }
meter::-webkit-meter-optimum-value { background: var(--accent); border-radius: 6px; }
meter::-webkit-meter-suboptimum-value { background: #d18b25; border-radius: 6px; }
meter::-webkit-meter-even-less-good-value { background: #d65353; border-radius: 6px; }
.reset { font-size: var(--reset-size); font-weight: 550; font-variant-numeric: tabular-nums; }
.detail { margin-top: 3px; color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
main { display: flex; flex-direction: column; gap: calc(12px * var(--spacing-scale)); }
.stat { display: flex; flex-direction: column; gap: calc(5px * var(--spacing-scale)); min-width: 0; padding: calc(13px * var(--spacing-scale)); border: 1px solid var(--border); border-radius: 10px; background: var(--card); }
.stat { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: baseline; }
.stat .detail { grid-column: 1 / -1; }
.value { font-size: var(--reset-size); font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.empty { margin: 0; padding: calc(20px * var(--spacing-scale)) 0; color: var(--muted); }
footer { margin-top: calc(16px * var(--spacing-scale)); color: var(--muted); font-size: 11px; text-align: center; }
</style>
</head>
<body>
<header><div><h1>T3 Code</h1><p class="environment">${escapeHtml(summary.environmentLabel ?? "Usage overview")}</p></div><div><a class="open" href="https://t3-menu.invalid/open-app">Open app ↗</a><br><a class="open" aria-label="Usage display settings" href="https://t3-menu.invalid/open-usage-settings">⚙ Display settings</a></div></header>
<main>${projectContent}${content}</main>
<footer>Subscription usage · Each prompt has its own ceiling</footer>
</body></html>`;
}
