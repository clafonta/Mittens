import { readFileSync } from "node:fs";

/** Package version, read from package.json (works from src/ and dist/). */
export const VERSION = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version;
