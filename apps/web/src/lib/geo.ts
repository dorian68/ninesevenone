export type BBox = {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
};

export function parseBBox(raw: string | null): BBox | null {
  if (!raw) return null;
  const values = raw.split(",").map(Number);
  if (values.length !== 4 || values.some((value) => Number.isNaN(value))) return null;
  const [minLng, minLat, maxLng, maxLat] = values;
  if (minLng >= maxLng || minLat >= maxLat) return null;
  return { minLng, minLat, maxLng, maxLat };
}

export function isInsideBBox(point: { longitude: number; latitude: number }, bbox: BBox) {
  return point.longitude >= bbox.minLng && point.longitude <= bbox.maxLng && point.latitude >= bbox.minLat && point.latitude <= bbox.maxLat;
}

export function gridCluster<T extends { longitude: number; latitude: number }>(items: T[], zoom: number) {
  if (zoom >= 10) return items.map((item) => ({ type: "point" as const, item }));
  const cellSize = zoom < 7 ? 0.25 : 0.12;
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = `${Math.floor(item.longitude / cellSize)}:${Math.floor(item.latitude / cellSize)}`;
    const current = buckets.get(key) ?? [];
    current.push(item);
    buckets.set(key, current);
  }
  return [...buckets.values()].map((bucket) => {
    if (bucket.length === 1) return { type: "point" as const, item: bucket[0] };
    const longitude = bucket.reduce((sum, item) => sum + item.longitude, 0) / bucket.length;
    const latitude = bucket.reduce((sum, item) => sum + item.latitude, 0) / bucket.length;
    return { type: "cluster" as const, count: bucket.length, longitude, latitude };
  });
}
