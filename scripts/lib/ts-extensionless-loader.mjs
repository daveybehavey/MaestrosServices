import { readFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TS_EXTS = [".ts", ".tsx", ".mts", ".cts"];

export async function resolve(specifier, context, nextResolve) {
  if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    !extname(specifier)
  ) {
    const parentPath = fileURLToPath(context.parentURL);
    const candidate = join(dirname(parentPath), `${specifier}.ts`);
    try {
      readFileSync(candidate);
      return nextResolve(pathToFileURL(candidate).href, context);
    } catch {
      // Fall through to the default resolver when no .ts sibling exists.
    }
  }
  return nextResolve(specifier, context);
}
