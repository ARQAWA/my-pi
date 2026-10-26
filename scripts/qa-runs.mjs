// Run selection for the status reader (qa-status.mjs).
export const levelOf = (r) => r.status !== "completed" ? "pending"
	: r.conclusion === "success" ? "green"
	: ["failure", "timed_out", "startup_failure", "action_required"].includes(r.conclusion) ? "red" : "info";
const newest = (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id;

export const workflowRuns = (runs, workflow) => runs.filter((r) => r.path?.split("@")[0] === `.github/workflows/${workflow}`).sort(newest);

// The three newest scheduled or dispatched main runs of tests.yml and pcli.yml.
export const MAIN_WORKFLOWS = [["main tests", "tests.yml"], ["main pcli", "pcli.yml"]];
export const mainRuns = (runs, workflow) => workflowRuns(runs, workflow)
	.filter((r) => r.head_branch === "main" && ["schedule", "workflow_dispatch"].includes(r.event)).slice(0, 3);
