import { z } from "zod";
import type { History } from "./history.js";
import type { Hooks } from "./hooks.js";
import type { Store } from "./store.js";

/** The parts of Mimic's in-memory state that a reset can clear. */
export const ResetPart = z.enum(["state", "tags", "hooks", "history"]);
export type ResetPart = z.infer<typeof ResetPart>;
export const RESET_PARTS = ResetPart.options;

export interface ResetResult {
  /** The parts that were reset (everything not kept). */
  reset: ResetPart[];
  /** Services whose live mode, scenario or delay went back to their files. */
  services: string[];
  /** The tag filter in force before the reset, if it was cleared. */
  tags: string[];
  /** How many history entries were cleared. */
  history: number;
}

/**
 * Puts Mimic back the way it started, in one go: live state (modes, default
 * scenarios, delays), the tag filter, hook state (ctx.state and ctx.shared)
 * and request history. Files on disk are never touched. `keep` leaves parts
 * alone, e.g. ["history"] to look at requests after a reset.
 */
export function resetAll(deps: { store: Store; history: History; hooks: Hooks }, keep: readonly ResetPart[] = []): ResetResult {
  const { store, history, hooks } = deps;
  const kept = new Set(keep);
  const result: ResetResult = { reset: RESET_PARTS.filter((p) => !kept.has(p)), services: [], tags: [], history: 0 };
  if (!kept.has("state")) result.services = store.resetLiveState();
  if (!kept.has("tags")) {
    result.tags = store.activeTags;
    if (result.tags.length) store.setActiveTags([]);
  }
  if (!kept.has("hooks")) hooks.resetState();
  if (!kept.has("history")) {
    result.history = history.list().length;
    history.clear();
  }
  return result;
}
