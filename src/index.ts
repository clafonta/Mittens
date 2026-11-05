/**
 * Types for Mimic hooks. In services/<id>/hook.ts:
 *
 *   import type { RequestHook, ResponseHook } from "@clafonta/mimic";
 *   export const request: RequestHook = (req, ctx) => { … };
 *
 * or in hook.js: `/** @type {import("@clafonta/mimic").RequestHook} *\/`.
 */
export type { HookContext, HookModule, HookRequest, HookResponse, HookResult, RequestHook, ResponseHook } from "./core/hooks.js";
