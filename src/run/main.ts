import { D1Http } from "./d1Http.js";
import { WranglerD1 } from "./wranglerD1.js";
import { runIngest } from "./ingest.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

// `npm run ingest -- --wrangler` uses your own `wrangler login`; CI uses the REST client + a scoped token.
const db = process.argv.includes("--wrangler")
  ? new WranglerD1()
  : new D1Http({ accountId: required("CF_ACCOUNT_ID"), databaseId: required("D1_DATABASE_ID"), apiToken: required("CF_API_TOKEN") });
const eia = process.env["EIA_API_KEY"];
runIngest(db, { ...(eia ? { eiaAPIKey: eia } : {}), log: (m) => console.log(m) })
  .then((counts) => console.log("ingest complete", JSON.stringify(counts)))
  .catch((error) => {
    console.error("ingest failed", error);
    process.exit(1);
  });
