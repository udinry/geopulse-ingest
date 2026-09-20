import { handleRequest, type APIEnvironment, type Queryable } from "./handler.js";
import { dispatchAlerts, type APNsSender } from "../alerts/dispatch.js";
import { APNsHTTPClient } from "../alerts/apns.js";

interface D1StatementLike {
  bind(...bindings: unknown[]): D1StatementLike;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}

interface D1DatabaseLike {
  prepare(sql: string): D1StatementLike;
}

export interface WorkerEnvironment {
  DB: D1DatabaseLike;
  APNsSender?: APNsSender;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_PRIVATE_KEY?: string;
  APNS_TOPIC?: string;
  APNS_SANDBOX?: string;
  OPS_KEY?: string;
}

function queryAdapter(db: D1DatabaseLike): Queryable {
  return {
    async all<T>(sql: string, ...bindings: unknown[]) {
      const statement = db.prepare(sql);
      return (bindings.length > 0 ? statement.bind(...bindings) : statement).all<T>().then((result) => result.results);
    },
    async first<T>(sql: string, ...bindings: unknown[]) {
      const statement = db.prepare(sql);
      return (bindings.length > 0 ? statement.bind(...bindings) : statement).first<T>();
    },
    async run(sql: string, ...bindings: unknown[]) {
      const statement = db.prepare(sql);
      await (bindings.length > 0 ? statement.bind(...bindings) : statement).run();
    },
  };
}

/** Cloudflare Worker entry point. All product logic remains in the runtime-neutral handler. */
export default {
  fetch(request: Request, env: WorkerEnvironment): Promise<Response> {
    const apiEnvironment: APIEnvironment = { db: queryAdapter(env.DB) };
    if (env.OPS_KEY !== undefined) apiEnvironment.opsKey = env.OPS_KEY;
    return handleRequest(request, apiEnvironment);
  },
  async scheduled(_event: unknown, env: WorkerEnvironment): Promise<void> {
    const sender = env.APNsSender ?? (env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_PRIVATE_KEY && env.APNS_TOPIC
      ? new APNsHTTPClient({ keyID: env.APNS_KEY_ID, teamID: env.APNS_TEAM_ID, privateKeyPEM: env.APNS_PRIVATE_KEY, topic: env.APNS_TOPIC, sandbox: env.APNS_SANDBOX === "true" })
      : undefined);
    if (sender !== undefined) await dispatchAlerts(queryAdapter(env.DB), sender, new Date().toISOString());
  },
};
