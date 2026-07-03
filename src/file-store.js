import fs from "node:fs/promises";
import path from "node:path";

export async function readJson(filePath, fallback) {
  try {
    const text = await fs.readFile(path.resolve(filePath), "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

export async function writeJson(filePath, value) {
  const resolved = path.resolve(filePath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(path.resolve(filePath)), { recursive: true });
}
