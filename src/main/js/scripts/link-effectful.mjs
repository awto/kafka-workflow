import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packages = ["cc", "debugger", "serialization", "core", "transducers"];
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const jsRoot = path.resolve(scriptDir, "..");

function exec(command, args, options = {}) {
  execFileSync(command, args, {
    stdio: "inherit",
    ...options
  });
}

function gitRoot() {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: jsRoot,
    encoding: "utf8"
  }).trim();
}

const explicitRepo = process.env.EFFECTFUL_REPO;
const effectfulRepo = explicitRepo
  ? path.resolve(explicitRepo)
  : path.resolve(gitRoot(), "..", "eff");

if (!existsSync(path.join(effectfulRepo, "package.json"))) {
  if (explicitRepo) {
    throw new Error(`EFFECTFUL_REPO does not point to a package: ${effectfulRepo}`);
  }
  console.log(`No sibling effectful repo at ${effectfulRepo}; keeping installed @effectful packages.`);
  process.exit(0);
}

for (const name of packages) {
  const packageDir = path.join(effectfulRepo, "packages", name);
  if (!existsSync(path.join(packageDir, "package.json"))) {
    throw new Error(`Missing @effectful/${name} package at ${packageDir}`);
  }
  exec("npm", ["link"], { cwd: packageDir });
}

exec("npm", ["link", ...packages.map((name) => `@effectful/${name}`)], {
  cwd: jsRoot
});
