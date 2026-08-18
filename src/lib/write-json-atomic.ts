import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/** Write JSON via temp file + rename so readers never see a truncated file. */
export async function writeJsonAtomic(
  filePath: string,
  value: unknown,
  mode?: number,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  const body =
    typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(tmp, body, "utf8");
  if (mode !== undefined) {
    await chmod(tmp, mode).catch(() => undefined);
  }
  await rename(tmp, filePath);
  if (mode !== undefined) {
    await chmod(filePath, mode).catch(() => undefined);
  }
}
