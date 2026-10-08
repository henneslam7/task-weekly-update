// Hennes's block of the team Excel sheet (week of 2026-10-05). Job tasks only. Used as the test fixture; the same
// data is applied to the live workspace through the MCP tools after the owner approves the diff.
export type FixtureRow = {
  initiative: string;
  requester: string;
  priority: "P1" | "P2" | "P3";
  statusLabel: "To Start" | "On track" | "At risk" | "Blocked" | "Done";
  progressThisWeek: string;
  progressPct: number;
  nextSteps: string;
  release: { date: string; type: "target" | "actual" } | { note: string } | null;
  blocker: string;
  supportNeeded: string;
  lastUpdated: string;
  queueOrder: number;
};

export const FIXTURE_WEEK = "2026-10-05";
export const FIXTURE_OWNER_SHORT = "Hennes";
export const FIXTURE_OWNER_FULL = "Hennes Lam";

export const FIXTURE: FixtureRow[] = [
  {
    initiative: "PPL One Pager Fast Checkout flow",
    requester: "Sajin / Esther / Nicholas",
    priority: "P1",
    statusLabel: "To Start",
    progressThisWeek: "0% complete. Not started.",
    progressPct: 0,
    nextSteps: "Start after PPL Pass (Pass Gifting) is done.",
    release: { date: "2026-11-01", type: "target" },
    blocker: "Out of resources. Queued after PPL Pass.",
    supportNeeded: "",
    lastUpdated: "2026-10-05",
    queueOrder: 1,
  },
  {
    initiative: "PPL Pass (Pass Gifting)",
    requester: "Sajin / Esther / Nicholas",
    priority: "P1",
    statusLabel: "Blocked",
    progressThisWeek: "10% complete. Started designing the Gifting page; first draft in progress.",
    progressPct: 10,
    nextSteps: "Continue designing the Gifting page; finalise once all requirements are confirmed this week.",
    release: { date: "2026-10-30", type: "target" },
    blocker:
      "Out of resources and time is tight. Requirements still to be confirmed; can be resolved quickly once they are.",
    supportNeeded: "",
    lastUpdated: "2026-10-05",
    queueOrder: 2,
  },
  {
    initiative: "ST sub-domain",
    requester: "Jayme",
    priority: "P1",
    statusLabel: "On track",
    progressThisWeek: "90% complete. Sub-domain work done, ready for deployment.",
    progressPct: 90,
    nextSteps: "Deploy on 6 Oct, then upload the other 11 articles.",
    release: { date: "2026-10-06", type: "actual" },
    blocker: "",
    supportNeeded: "",
    lastUpdated: "2026-10-05",
    queueOrder: 3,
  },
  {
    initiative: "Aerotel Pages Minor Revamp",
    requester: "Aerotel Commercial (Helen, Jessica) / Agnes",
    priority: "P2",
    statusLabel: "At risk",
    progressThisWeek: "10% complete.",
    progressPct: 10,
    nextSteps: "Start after the P1 projects are completed.",
    release: { date: "2026-12-01", type: "target" },
    blocker: "Out of resources. Queued behind the P1 projects.",
    supportNeeded: "",
    lastUpdated: "2026-10-05",
    queueOrder: 4,
  },
  {
    initiative: "PPF pages revamp & update",
    requester: "Juliana",
    priority: "P2",
    statusLabel: "To Start",
    progressThisWeek: "0% complete.",
    progressPct: 0,
    nextSteps: "Start after the P1 projects are completed.",
    release: { date: "2026-11-16", type: "target" },
    blocker: "Out of resources. Queued behind the P1 projects.",
    supportNeeded: "",
    lastUpdated: "2026-10-05",
    queueOrder: 5,
  },
  {
    initiative: "Adobe Staff Discount campaign",
    requester: "Esther",
    priority: "P2",
    statusLabel: "To Start",
    progressThisWeek: "0% complete.",
    progressPct: 0,
    nextSteps: "Share comments and reply to Esther by 16 Oct.",
    release: { date: "2026-10-30", type: "target" },
    blocker: "",
    supportNeeded: "",
    lastUpdated: "2026-10-05",
    queueOrder: 6,
  },
  {
    initiative: "WeChat Mini Program 11.11 Campaign Page build-up",
    requester: "Stephen",
    priority: "P2",
    statusLabel: "At risk",
    progressThisWeek: "60% complete.",
    progressPct: 60,
    nextSteps: "Resume after the three P1 projects are completed.",
    release: { date: "2026-10-18", type: "target" },
    blocker: "Out of resources. Queued behind the P1 projects.",
    supportNeeded: "",
    lastUpdated: "2026-10-05",
    queueOrder: 7,
  },
];

/** The expected cells (what the sheet shows), in column order, per fixture row. */
export const EXPECTED_CELLS: string[][] = [
  ["Hennes", "Sajin / Esther / Nicholas", "PPL One Pager Fast Checkout flow", "P1", "To Start", "0% complete. Not started.", "0%", "Start after PPL Pass (Pass Gifting) is done.", "(Target Date: 11/1/2026)", "Out of resources. Queued after PPL Pass.", "05/10/2026"],
  ["Hennes", "Sajin / Esther / Nicholas", "PPL Pass (Pass Gifting)", "P1", "Blocked", "10% complete. Started designing the Gifting page; first draft in progress.", "10%", "Continue designing the Gifting page; finalise once all requirements are confirmed this week.", "(Target Date: 10/30/2026)", "Out of resources and time is tight. Requirements still to be confirmed; can be resolved quickly once they are.", "05/10/2026"],
  ["Hennes", "Jayme", "ST sub-domain", "P1", "On track", "90% complete. Sub-domain work done, ready for deployment.", "90%", "Deploy on 6 Oct, then upload the other 11 articles.", "06/10/2026", "", "05/10/2026"],
  ["Hennes", "Aerotel Commercial (Helen, Jessica) / Agnes", "Aerotel Pages Minor Revamp", "P2", "At risk", "10% complete.", "10%", "Start after the P1 projects are completed.", "(Target Date: 12/1/2026)", "Out of resources. Queued behind the P1 projects.", "05/10/2026"],
  ["Hennes", "Juliana", "PPF pages revamp & update", "P2", "To Start", "0% complete.", "0%", "Start after the P1 projects are completed.", "(Target Date: 11/16/2026)", "Out of resources. Queued behind the P1 projects.", "05/10/2026"],
  ["Hennes", "Esther", "Adobe Staff Discount campaign", "P2", "To Start", "0% complete.", "0%", "Share comments and reply to Esther by 16 Oct.", "(Target Date: 10/30/2026)", "", "05/10/2026"],
  ["Hennes", "Stephen", "WeChat Mini Program 11.11 Campaign Page build-up", "P2", "At risk", "60% complete.", "60%", "Resume after the three P1 projects are completed.", "(Target Date: 10/18/2026)", "Out of resources. Queued behind the P1 projects.", "05/10/2026"],
];
