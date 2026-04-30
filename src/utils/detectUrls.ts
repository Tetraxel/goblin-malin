export type SupportedPlatform =
  | 'spotify'
  | 'youtube'
  | 'youtubeMusic'
  | 'soundcloud'
  | 'deezer'
  | 'appleMusic'
  | 'tidal';

export type DetectedUrl = {
  raw: string;
  platform: SupportedPlatform;
  type: 'track' | 'album' | 'playlist' | 'unknown';
};

const URL_REGEX = /https?:\/\/[^\s"'<>]+/gi;

export function detectUrls(text: string): DetectedUrl[] {
  const matches = text.match(URL_REGEX) ?? [];
  const results: DetectedUrl[] = [];
  for (const raw of matches) {
    const classified = classify(raw);
    if (classified) results.push(classified);
  }
  return results;
}

function classify(raw: string): DetectedUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
  const path = parsed.pathname;

  if (host === 'open.spotify.com' || host.endsWith('.spotify.com')) {
    if (/\/track\//.test(path)) return { raw, platform: 'spotify', type: 'track' };
    if (/\/album\//.test(path)) return { raw, platform: 'spotify', type: 'album' };
    if (/\/playlist\//.test(path)) return { raw, platform: 'spotify', type: 'playlist' };
    return null;
  }

  if (host === 'music.youtube.com') {
    if (path.startsWith('/watch')) return { raw, platform: 'youtubeMusic', type: 'track' };
    return null;
  }

  if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
    if (path === '/watch') return { raw, platform: 'youtube', type: 'track' };
    return null;
  }

  if (host === 'youtu.be') {
    return { raw, platform: 'youtube', type: 'track' };
  }

  if (host === 'soundcloud.com' || host.endsWith('.soundcloud.com')) {
    if (path === '/' || path === '') return null;
    return { raw, platform: 'soundcloud', type: 'track' };
  }

  if (host === 'deezer.com' || host.endsWith('.deezer.com')) {
    if (/\/track\//.test(path)) return { raw, platform: 'deezer', type: 'track' };
    return null;
  }

  if (host === 'music.apple.com') {
    return { raw, platform: 'appleMusic', type: 'track' };
  }

  if (host === 'tidal.com' || host.endsWith('.tidal.com')) {
    if (/\/track\//.test(path)) return { raw, platform: 'tidal', type: 'track' };
    return null;
  }

  return null;
}
