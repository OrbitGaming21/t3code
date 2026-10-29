import { describe, expect, it } from "vite-plus/test";

import { menuBarProjectKey, menuBarTitle, nextUnseenFinished } from "./menuBarPanel.ts";

type Status = "working" | "attention" | "failed" | "completed" | "idle" | "offline";
const project = (name: string, status: Status) => ({ name, status, label: status });

describe("menu bar alerts", () => {
  it("marks projects that finish while you are away until the dropdown is opened", () => {
    const working = [
      project("api", "working"),
      project("web", "attention"),
      project("docs", "idle"),
    ];
    const before = new Map(working.map((item) => [menuBarProjectKey(item), item.status]));
    const after = [
      project("api", "completed"),
      project("web", "failed"),
      project("docs", "completed"),
    ];
    const unseen = nextUnseenFinished(before, new Set(), after);
    expect([...unseen].toSorted()).toEqual(
      [menuBarProjectKey(after[0]!), menuBarProjectKey(after[1]!)].toSorted(),
    );

    const settled = new Map(after.map((item) => [menuBarProjectKey(item), item.status]));
    expect(nextUnseenFinished(settled, unseen, after)).toEqual(unseen);
    expect(nextUnseenFinished(settled, unseen, [project("api", "working")]).size).toBe(0);
  });

  it("summarizes what needs you before what is done or running", () => {
    expect(menuBarTitle([project("api", "working")], 0)).toBe("T3 Code · 1 working");
    expect(menuBarTitle([project("api", "working"), project("web", "attention")], 2)).toBe(
      "T3 Code · 1 needs you · 2 done",
    );
    expect(menuBarTitle([project("a", "attention"), project("b", "attention")], 0)).toBe(
      "T3 Code · 2 need you",
    );
    expect(menuBarTitle([project("api", "idle")], 0)).toBe("T3 Code");
  });
});
