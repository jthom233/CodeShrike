import fs from "fs";
import path from "path";

/**
 * Copy a screenshot from sourcePath into managed storage.
 * Returns the relative path (from .codeshrike/) to the stored file.
 * If sourcePath doesn't exist, returns null and logs a warning (don't throw).
 */
export function storeScreenshot(
  projectPath: string,
  suiteId: string,
  runId: string,
  stepOrdinal: number,
  stepId: string,
  sourcePath: string
): string | null {
  if (!fs.existsSync(sourcePath)) {
    console.warn(
      `[screenshots] Source file does not exist, skipping copy: ${sourcePath}`
    );
    return null;
  }

  const ordinalPadded = String(stepOrdinal).padStart(2, "0");
  const fileName = `${ordinalPadded}-${stepId}.png`;
  const relativeDir = path.join("screenshots", suiteId, runId);
  const relativePath = path.join(relativeDir, fileName);

  const absoluteDir = path.join(projectPath, ".codeshrike", relativeDir);
  fs.mkdirSync(absoluteDir, { recursive: true });

  const absoluteDest = path.join(absoluteDir, fileName);
  fs.copyFileSync(sourcePath, absoluteDest);

  return relativePath;
}

/**
 * Get the absolute path for a stored screenshot.
 */
export function getScreenshotPath(
  projectPath: string,
  relativePath: string
): string {
  return path.join(projectPath, ".codeshrike", relativePath);
}
