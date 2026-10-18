import crypto from "node:crypto";

export function shortId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(3).toString("hex")}`;
}
