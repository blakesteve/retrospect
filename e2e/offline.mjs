// Preloaded into the browser checks' server (NODE_OPTIONS): a request to
// anywhere but this machine is refused, and written to BLOCKED_LOG, which the
// run requires to hold nothing but setup's own test request. Covers fetch and
// the sockets under every other client (http, https, tls, undici), so a
// dependency that skips fetch is refused too. The seeded listener needs
// nothing from Last.fm, NASA or JPL.
import { appendFileSync, mkdirSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";

const log = process.env.BLOCKED_LOG;
if (log) mkdirSync(path.dirname(log), { recursive: true });
const LOCAL = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const refuse = (where) => {
  if (log) appendFileSync(log, `${where}\n`);
  return new Error(`The browser checks' server reaches no network (${where})`);
};

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (!LOCAL.has(url.hostname)) throw refuse(`${url.host}${url.pathname}`);
  return realFetch(input, init);
};

/** The host a connect call names: options, or (port, host). A Unix socket path is local. */
const hostOf = (args) => {
  const [a, b] = args;
  if (Array.isArray(a)) return hostOf(a);
  if (a && typeof a === "object") return a.path ? "localhost" : (a.host ?? a.hostname ?? "localhost");
  if (typeof a === "number" || /^\d+$/.test(String(a))) return typeof b === "string" ? b : "localhost";
  return "localhost";
};
const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const host = hostOf(args);
  if (!LOCAL.has(host)) {
    const err = refuse(`socket ${host}`);
    process.nextTick(() => this.destroy(err));
    return this;
  }
  return realConnect.apply(this, args);
};
const realTls = tls.connect;
tls.connect = function (...args) {
  const host = hostOf(args);
  if (!LOCAL.has(host)) throw refuse(`tls ${host}`);
  return realTls.apply(this, args);
};
