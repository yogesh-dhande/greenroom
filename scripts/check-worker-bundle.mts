#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  inspectWorkerBundleSourceMap,
  type WorkerBundleSourceMap,
} from "../src/lib/worker-bundle-check";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function findSourceMaps(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = resolve(directory, entry);
    if (statSync(path).isDirectory()) files.push(...findSourceMaps(path));
    else if (entry.endsWith(".js.map")) files.push(path);
  }
  return files;
}

export function checkWorkerBundleDirectory(directory: string): string {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new Error(`Wrangler dry-run bundle directory does not exist: ${directory}`);
  }
  const maps = findSourceMaps(directory);
  if (maps.length !== 1) {
    throw new Error(`Expected one Wrangler JavaScript source map in ${directory}; found ${maps.length}`);
  }

  const sourceMap = JSON.parse(readFileSync(maps[0], "utf8")) as WorkerBundleSourceMap;
  const inspection = inspectWorkerBundleSourceMap(sourceMap);
  if (inspection.errors.length > 0) {
    throw new Error(`Unsafe Worker bundle:\n- ${inspection.errors.join("\n- ")}`);
  }
  return `Worker bundle is statically dispatched (${inspection.sources.length} mapped sources; generated dispatcher absent)`;
}

function createWorkerBundleDryRun(): string {
  const directory = mkdtempSync(join(tmpdir(), "greenroom-worker-bundle-"));
  const wranglerCli = resolve(PROJECT_ROOT, "node_modules/wrangler/bin/wrangler.js");
  const result = spawnSync(
    process.execPath,
    [
      wranglerCli,
      "deploy",
      "--dry-run",
      "--outdir",
      directory,
      "--upload-source-maps",
      "--config",
      resolve(PROJECT_ROOT, "wrangler.jsonc"),
    ],
    {
      // Wrangler auto-delegates back to OpenNext when invoked from the project
      // directory. Running its CLI from the OS temp directory inspects the
      // already-built Worker without rebuilding or uploading it.
      cwd: tmpdir(),
      encoding: "utf8",
    },
  );
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    rmSync(directory, { recursive: true, force: true });
    throw new Error(`Wrangler dry-run failed with exit code ${result.status ?? "unknown"}`);
  }
  return directory;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const suppliedDirectory = process.argv[2];
  let generatedDirectory: string | null = null;
  try {
    const directory = suppliedDirectory
      ? resolve(suppliedDirectory)
      : (generatedDirectory = createWorkerBundleDryRun());
    console.log(checkWorkerBundleDirectory(directory));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    if (generatedDirectory) rmSync(generatedDirectory, { recursive: true, force: true });
  }
}
