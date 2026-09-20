import { serializeAsset, serializeSituation, type PublicAsset, type PublicSituation } from "./publicSerializer.js";
import type { AssetPriceRow, AssetRow, SituationRow } from "../shared/types.js";

export interface NowSnapshot {
  schemaVersion: 1;
  generatedAt: string;
  situations: PublicSituation[];
  assets: PublicAsset[];
}

export interface SnapshotInput {
  generatedAt: string;
  situations: readonly SituationRow[];
  assets: readonly AssetRow[];
  latestQuotes: ReadonlyMap<string, AssetPriceRow>;
}

/** Builds a stable public snapshot. Inputs must already be ordered by the query layer. */
export function buildNowSnapshot(input: SnapshotInput): NowSnapshot {
  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt,
    situations: input.situations.map(serializeSituation),
    assets: input.assets.map((asset) => serializeAsset(asset, input.latestQuotes.get(asset.id) ?? null)),
  };
}

/** JSON output is intentionally stable so the same snapshot gets the same ETag. */
export function encodeSnapshot(snapshot: NowSnapshot): string {
  return JSON.stringify(snapshot);
}
