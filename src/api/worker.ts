import { handleRequest, type Queryable } from "./handler.js";

interface D1StatementLike {
  bind(...bindings: unknown[]): D1StatementLike;
  all<T>(): Promise<{ results: T[] }>;
  first<T>(): Promise<T | null>;
}

interface D1DatabaseLike {
  prepare(sql: string): D1StatementLike;
}

export interface WorkerEnvironment {
  DB: D1DatabaseLike;
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
  };
}

/** Cloudflare Worker entry point. All product logic remains in the runtime-neutral handler. */
export default {
  fetch(request: Request, env: WorkerEnvironment): Promise<Response> {
    return handleRequest(request, { db: queryAdapter(env.DB) });
  },
};
