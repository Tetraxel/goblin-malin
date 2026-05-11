import { readFileSync, writeFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf8"));
const repoUrl = pkg.repository.url
  .replace(/^git\+/, "")
  .replace(/\.git$/, "");
const rawBase =
  repoUrl.replace("github.com", "raw.githubusercontent.com") + "/main/";

const original = readFileSync("./README.md", "utf8");

const patched = original
  // markdown: ![alt](relative/path)
  .replace(
    /!\[([^\]]*)\]\((?!https?:\/\/)([^)]+)\)/g,
    (_, alt, path) => `![${alt}](${rawBase}${path.replace(/\\/g, "/")})`
  )
  // html: <img src="relative/path"
  .replace(
    /<img(\s[^>]*?)src="(?!https?:\/\/)([^"]+)"/g,
    (_, attrs, path) => `<img${attrs}src="${rawBase}${path.replace(/\\/g, "/")}"`
  );

writeFileSync("./README.md", patched);
console.log("README patched for npm publish");
