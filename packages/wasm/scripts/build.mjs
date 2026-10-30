// build compiles Ant's wasm command into ant.wasm, with the wasm_exec.js of the Go that built it.
// ANT_DIR names the checkout of github.com/ant-src/ant; the default is the sibling of this repo.
import { execFileSync } from "node:child_process";
import { copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const antDir = resolve(process.env.ANT_DIR ?? join(pkg, "../../../ant"));

execFileSync("go", ["build", "-trimpath", "-ldflags=-s -w", "-o", join(pkg, "ant.wasm"), "./wasm"], {
  cwd: antDir,
  env: { ...process.env, GOOS: "js", GOARCH: "wasm" },
  stdio: "inherit",
});
const goroot = execFileSync("go", ["env", "GOROOT"], { cwd: antDir, encoding: "utf8" }).trim();
copyFileSync(join(goroot, "lib/wasm/wasm_exec.js"), join(pkg, "wasm_exec.js"));
console.log(`built ant.wasm from ${antDir}`);
