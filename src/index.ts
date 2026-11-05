/**
 * Types for Mimic hooks. In services/<id>/hook.ts:
 *
 *   import type { RequestHook, ResponseHook } from "@laboriouslabs/mimic";
 *   export const request: RequestHook = (req, ctx) => { … };
 *
 * or in hook.js: `/** @type {import("@laboriouslabs/mimic").RequestHook} *\/`.
 */
export type { HookContext, HookModule, HookRequest, HookResponse, HookResult, RequestHook, ResponseHook } from "./core/hooks.js";
