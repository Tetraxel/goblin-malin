import { TrackMetadata } from "../types";

function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/[^\w\s]/g, "");
}

function extractYear(releaseDate: string | undefined): number | undefined {
  if (!releaseDate) return undefined;
  const year = parseInt(releaseDate.split("-")[0]);
  return isNaN(year) ? undefined : year;
}

/**
 * Scores how well `source` matches `primary` on a 0–100 scale.
 * Primary source always returns 100. ISRC match short-circuits to 100.
 *
 * Breakdown:
 *   Track name exact:  40 pts  (substring: 25 pts)
 *   Artist name exact: 30 pts  (substring: 15 pts)
 *   Duration ≤2% diff: 20 pts  (≤5%: 10 pts)
 *   Year match:        10 pts
 */
export function computeConfidenceScore(
  source: TrackMetadata,
  primary: TrackMetadata,
): number {
  // ISRC exact match is a definitive identifier
  if (source.isrc && primary.isrc && source.isrc === primary.isrc) return 100;

  let score = 0;

  // Track name (40 pts)
  const srcName = normalize(source.trackName ?? "");
  const primName = normalize(primary.trackName ?? "");
  if (srcName && primName) {
    if (srcName === primName) {
      score += 40;
    } else if (srcName.includes(primName) || primName.includes(srcName)) {
      score += 25;
    }
  }

  // First artist name (30 pts)
  const srcArtist = normalize(source.artists[0]?.name ?? "");
  const primArtist = normalize(primary.artists[0]?.name ?? "");
  if (srcArtist && primArtist) {
    if (srcArtist === primArtist) {
      score += 30;
    } else if (srcArtist.includes(primArtist) || primArtist.includes(srcArtist)) {
      score += 15;
    }
  }

  // Duration (20 pts)
  if (source.duration && primary.duration) {
    const diff = Math.abs(source.duration - primary.duration) / primary.duration;
    if (diff <= 0.02) score += 20;
    else if (diff <= 0.05) score += 10;
  }

  // Release year (10 pts)
  const srcYear = extractYear(source.album?.releaseDate);
  const primYear = extractYear(primary.album?.releaseDate);
  if (srcYear && primYear && srcYear === primYear) {
    score += 10;
  }

  return Math.min(99, score);
}
