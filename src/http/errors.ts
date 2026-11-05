import { z } from "zod";
import { StoreError, ConflictError, NotFoundError } from "../core/store.js";

export function errorStatus(err: unknown): 400 | 404 | 409 | 500 {
  if (err instanceof z.ZodError) return 400;
  if (err instanceof NotFoundError) return 404;
  if (err instanceof ConflictError) return 409;
  return 500;
}

export const isClientError = (err: unknown): err is z.ZodError | StoreError =>
  err instanceof z.ZodError || err instanceof StoreError;
