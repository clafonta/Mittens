/**
 * Types for Mittens hooks. In services/<id>/hook.ts:
 *
 *   import type { RequestHook, ResponseHook } from "@clafonta/mittens";
 *   export const request: RequestHook = (req, ctx) => { … };
 *
 * or in hook.js: `/** @type {import("@clafonta/mittens").RequestHook} *\/`.
 */
export type { HookContext, HookModule, HookRequest, HookResponse, HookResult, RequestHook, ResponseHook } from "./core/hooks.js";
