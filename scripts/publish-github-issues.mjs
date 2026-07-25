import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const manifest = JSON.parse(
  readFileSync(resolve(root, "docs/backlog/manifest.json"), "utf8"),
);
const args = process.argv.slice(2);
const repoIndex = args.indexOf("--repo");
const repo = repoIndex >= 0 ? args[repoIndex + 1] : process.env.GITHUB_REPOSITORY;
const confirm = args.includes("--confirm");

if (!repo) {
  console.error("Usage: npm run publish:issues -- --repo OWNER/pinch-runway [--confirm]");
  process.exit(1);
}

function gh(commandArgs, dryRun) {
  const printable = ["gh", ...commandArgs].join(" ");
  if (dryRun) {
    console.info(printable);
    return;
  }
  execFileSync("gh", commandArgs, { stdio: "inherit", cwd: root });
}

console.info(`${confirm ? "Publishing" : "Previewing"} ${manifest.issues.length} Pinch Runway issue(s) to ${repo}.`);

for (const [label, detail] of Object.entries(manifest.label_definitions)) {
  gh(
    [
      "label",
      "create",
      label,
      "--repo",
      repo,
      "--color",
      detail.color,
      "--description",
      detail.description,
      "--force",
    ],
    !confirm,
  );
}

for (const issue of manifest.issues) {
  const commandArgs = [
    "issue",
    "create",
    "--repo",
    repo,
    "--title",
    issue.title,
    "--body-file",
    issue.body,
  ];
  for (const label of issue.labels) {
    commandArgs.push("--label", label);
  }
  gh(commandArgs, !confirm);
}

if (!confirm) {
  console.info("No GitHub state changed. Add --confirm only after reviewing this plan.");
}
