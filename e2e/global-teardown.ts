import { existsSync, readFileSync } from "node:fs";
import { BLOCKED_LOG } from "../playwright.config";
import { CONTROL } from "./global-setup";

/** The run fails if the server reached for the network at any point in it:
    `offline.mjs` logs every refused request, and the one line allowed is the
    test request `global-setup.ts` made to prove the block was in force. */
export default async function globalTeardown() {
  const lines = existsSync(BLOCKED_LOG) ? readFileSync(BLOCKED_LOG, "utf8").trim().split("\n").filter(Boolean) : [];
  const control = lines.findIndex((l) => CONTROL.test(l));
  const others = lines.filter((_, i) => i !== control);
  if (control < 0) throw new Error("The network block's test request is missing from its log: the block wasn't checked");
  if (others.length > 0) throw new Error(`The browser checks' server reached for the network:\n${others.join("\n")}`);
}
