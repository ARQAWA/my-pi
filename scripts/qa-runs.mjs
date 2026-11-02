// Run selection for the status reader (qa-status.mjs).
export const levelOf = (r) => r.status !== "completed" ? "pending"
	: r.conclusion === "success" ? "green"
	: ["failure", "timed_out", "startup_failure", "action_required"].includes(r.conclusion) ? "red" : "info";
const newest = (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id;

export const workflowRuns = (runs, workflow) => runs.filter((r) => r.path?.split("@")[0] === `.github/workflows/${workflow}`).sort(newest);

// The three newest push runs for each delivery workflow.
export const DELIVERY_WORKFLOWS = [["release tests", "tests.yml", "release"], ["pcli", "pcli.yml", "pcli"]];
export const deliveryRuns = (runs, workflow, branch) => workflowRuns(runs, workflow)
	.filter((r) => r.head_branch === branch && r.event === "push").slice(0, 3);
