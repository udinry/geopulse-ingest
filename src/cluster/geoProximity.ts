/**
 * The `geoProximity` term of the clustering similarity function (planning doc §8:
 * `geoProximity(e,s) = exp(-haversine/500km)`) — standard great-circle distance,
 * exponentially decayed so nearby events score close to 1 and distant ones decay
 * toward 0 without a hard cutoff (consistent with the trending score's own decay
 * philosophy: smooth, not a step function).
 */

const EARTH_RADIUS_KM = 6371;
const DECAY_DISTANCE_KM = 500;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance between two lat/lon points, in kilometers. */
export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

export function geoProximity(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const distanceKm = haversineDistanceKm(lat1, lon1, lat2, lon2);
  return Math.exp(-distanceKm / DECAY_DISTANCE_KM);
}
