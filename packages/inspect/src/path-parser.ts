import { PathInfo, PathSegment } from "./types";

export function parsePath(raw: string): PathInfo {
  const segments: PathSegment[] = [];

  // Split path into parts and classify each
  const parts = raw.split("/").filter((p) => p.length > 0);

  for (const part of parts) {
    if (part.startsWith(":")) {
      segments.push({ type: "param", name: part.slice(1) });
    } else {
      segments.push({ type: "static", value: part });
    }
  }

  return { raw, segments };
}
