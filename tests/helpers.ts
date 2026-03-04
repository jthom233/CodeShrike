import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";

/**
 * Create a unique temporary directory for an isolated test database.
 * Pass the returned path as `projectPath` to any handle* tool.
 */
export function createTestDir(): string {
  return mkdtempSync(path.join(tmpdir(), "codeshrike-test-"));
}

/**
 * Remove the temporary directory and all its contents.
 */
export function cleanTestDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Create a minimal valid PNG file (8-byte signature only) at the given path
 * for screenshot tests that need a real file on disk.
 */
export function createFakePng(filePath: string): void {
  // PNG magic bytes + minimal IHDR chunk to make it a non-zero file
  const pngSignature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  writeFileSync(filePath, pngSignature);
}

/** Parse the MCP tool response envelope to get the data object. */
export function parseResult(result: {
  content: Array<{ type: string; text: string }>;
}): unknown {
  return JSON.parse(result.content[0].text);
}
