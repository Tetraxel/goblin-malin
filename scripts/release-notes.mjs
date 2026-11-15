// Builds the GitHub release page text for a tag: quick install instructions, the matching CHANGELOG.md
// section, and the list of every commit since the previous tag (so work pushed straight to `main`, with no pull
// request, still shows up).
//
//   node scripts/release-notes.mjs v0.2.2 > release-notes.md
//
// Fails when CHANGELOG.md has no (or an empty) `## [x.y.z]` section for the tag: release.yml runs this before
// anything is published, so a release cannot go out without its notes. Needs the git history and tags
// (`fetch-depth: 0` in CI).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const REPO = process.env.GITHUB_REPOSITORY || "Tetraxel/goblin-malin";
const PACKAGE = "goblin-malin";

const tag = process.argv[2];
if (!tag || !/^v\d+\.\d+\.\d+/.test(tag)) {
    console.error("Usage: node scripts/release-notes.mjs v<version>");
    process.exit(1);
}
const version = tag.slice(1);

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();

/** The body of the `## [version]` section of CHANGELOG.md, without its heading. */
function changelogSection() {
    const text = readFileSync("CHANGELOG.md", "utf8").replace(/\r\n/g, "\n");
    const escaped = version.replace(/\./g, "\\.");
    const match = text.match(new RegExp(`^## \\[${escaped}\\][^\\n]*\\n([\\s\\S]*?)(?=^## \\[|(?![\\s\\S]))`, "m"));
    const body = match?.[1].trim();
    if (!body) {
        console.error(`CHANGELOG.md has no filled "## [${version}]" section. Move the [Unreleased] entries under it.`);
        process.exit(1);
    }
    // "### Added" -> "#### Added": the release page already has its own h2s.
    return body.replace(/^### /gm, "#### ");
}

/** The tag released just before this one, or "" for the very first release. */
function previousTag() {
    try {
        return git("describe", "--tags", "--abbrev=0", `${tag}^`);
    } catch {
        return "";
    }
}

/** One line per commit since the previous tag, newest first, without the release bump commits. */
function commitLines(previous) {
    const range = previous ? `${previous}..${tag}` : tag;
    const log = git("log", range, "--no-merges", "--format=%h%x09%s");
    return log
        .split("\n")
        .filter(Boolean)
        .map((line) => line.split("\t"))
        .filter(([, subject]) => !/^chore\(release\)/.test(subject))
        .map(([hash, subject]) => `- ${subject} ([\`${hash}\`](https://github.com/${REPO}/commit/${hash}))`);
}

const previous = previousTag();
const commits = commitLines(previous);

const parts = [
    `## Install

You need [Node.js](https://nodejs.org/en/download) **22 or newer**.

\`\`\`bash
npm install -g ${PACKAGE}@${version}   # or: yarn global add ${PACKAGE}@${version}
${PACKAGE}
\`\`\`

Already installed? \`npm install -g ${PACKAGE}@latest\` upgrades it. More options (pnpm, macOS, Linux) are in the [README](https://github.com/${REPO}#installation).`,
    `## What's new\n\n${changelogSection()}`,
];

if (commits.length > 0) {
    parts.push(
        `<details>\n<summary>All ${commits.length} commits in this release</summary>\n\n${commits.join("\n")}\n\n</details>`
    );
}
if (previous) {
    parts.push(`**Full Changelog**: https://github.com/${REPO}/compare/${previous}...${tag}`);
}

process.stdout.write(`${parts.join("\n\n")}\n`);
