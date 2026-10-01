/**
 * Sleep-noise detector. Scrobblers faithfully log eight hours of "Rolling
 * Thunder — Nature Sounds.ca" every night, which buries actual music taste
 * under a monsoon. Artist-name heuristic; intentionally conservative.
 */
const NOISE_RE =
  /\b(white noise|brown noise|pink noise|nature sounds?|rain sounds?|sleep sounds?|ocean sounds?|asmr|binaural|noise machine|sounds? for sleep|sleep(y)? (noise|sounds?|music)|meditation sounds?)\b/i;
export const isNoiseArtist = (artist: string) =>
  NOISE_RE.test(artist) || /\bsounds?\b.*\.(ca|com|net|org)\b/i.test(artist);
