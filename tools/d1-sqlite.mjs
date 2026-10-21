/* The slice of Cloudflare D1's API that server/diag-worker.mjs uses, over
 * node:sqlite — so the worker runs unchanged in tools/diag-verify.mjs and
 * tools/diag-local.mjs. */
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

export function d1(file = ":memory:") {
  const db = new DatabaseSync(file);
  db.exec(fs.readFileSync(fileURLToPath(new URL("../server/schema.sql", import.meta.url)), "utf8"));
  return {
    raw: db,
    prepare(sql) {
      const st = db.prepare(sql);
      let args = [];
      const o = {
        bind(...a) { args = a; return o; },
        async first() { const r = st.get(...args); return r ? { ...r } : null; },
        async all() { return { results: st.all(...args).map((r) => ({ ...r })) }; },
        async run() { const r = st.run(...args); return { meta: { changes: Number(r.changes) } }; },
      };
      return o;
    },
  };
}
