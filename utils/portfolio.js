/**
 * utils/portfolio.js
 * External Portfolio items — games a developer made outside Play Mist (on
 * Steam, the mobile stores, itch.io…), shown on their public /@handle profile.
 *
 * Nothing a developer types is ever rendered as HTML or used as an embed as-is:
 *  - Video input (a link OR pasted embed code) is reduced to a provider plus a
 *    strictly-validated video id; the player URL is built here, from scratch.
 *  - Store links must be https URLs on that store's own domain, so a "Steam"
 *    button can never lead to a look-alike phishing site.
 *  - Name and description are plain text, rendered escaped.
 */
const { cleanCommentBody: cleanPlainText } = require('./gameComments');

const MAX_ITEMS = 24;
const LIMITS = { title: 150, descriptionMin: 200, descriptionMax: 5000, url: 500, videoInput: 2000 };

// Order here is the order buttons appear on the public page.
const LINKS = [
  { field: 'steam_url',      label: 'Steam',        name: 'Steam',              hosts: ['store.steampowered.com', 'steamcommunity.com', 's.team'], placeholder: 'https://store.steampowered.com/app/…' },
  { field: 'play_store_url', label: 'Google Play',  name: 'Android Play Store', hosts: ['play.google.com'],                                        placeholder: 'https://play.google.com/store/apps/details?id=…' },
  { field: 'app_store_url',  label: 'App Store',    name: 'iOS App Store',      hosts: ['apps.apple.com', 'itunes.apple.com'],                    placeholder: 'https://apps.apple.com/app/…' },
  { field: 'itch_url',       label: 'itch.io',      name: 'itch.io',            hosts: ['itch.io'], subdomains: true,                             placeholder: 'https://yourname.itch.io/your-game' },
  { field: 'drive_url',      label: 'Google Drive', name: 'Google Drive',       hosts: ['drive.google.com', 'docs.google.com'],                   placeholder: 'https://drive.google.com/…' },
];

const VIDEO_ERROR = 'Trailer video must be a YouTube or Vimeo link, or the embed code copied from YouTube or Vimeo.';
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID   = /^\d{5,12}$/;

const hasScheme = (s) => /^[a-z][a-z0-9+.-]*:\/\//i.test(s);

function hostAllowed(hostname, link) {
  const host = hostname.toLowerCase();
  return link.hosts.some((h) => host === h || (link.subdomains && host.endsWith(`.${h}`)));
}

/** Validates one store link. Returns { value } (null when empty) or { error }. */
function normalizeLink(raw, link) {
  const input = String(raw ?? '').trim();
  if (!input) return { value: null };
  const invalid = { error: `${link.name} link must be a link to ${link.subdomains ? 'an ' : ''}${link.hosts[0]}${link.subdomains ? ' page' : ''}.` };
  if (input.length > LIMITS.url) return { error: `${link.name} link must be ${LIMITS.url} characters or fewer.` };

  let url;
  try { url = new URL(hasScheme(input) ? input : `https://${input}`); } catch (_) { return invalid; }
  if (url.protocol === 'http:') url.protocol = 'https:';
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !hostAllowed(url.hostname, link)) {
    return invalid;
  }
  return { value: url.href };
}

/**
 * Accepts a YouTube/Vimeo URL in any common shape, or an <iframe> embed
 * snippet, and returns { value: { provider, id } }, { value: null } when
 * empty, or { error }.
 */
function parseVideo(raw) {
  let input = String(raw ?? '').trim();
  if (!input) return { value: null };
  if (input.length > LIMITS.videoInput) return { error: VIDEO_ERROR };

  if (/<iframe/i.test(input)) {
    const src = input.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (!src) return { error: VIDEO_ERROR };
    input = src[1].replace(/&amp;/g, '&').trim();
  }
  if (input.startsWith('//')) input = `https:${input}`;

  let url;
  try { url = new URL(hasScheme(input) ? input : `https://${input}`); } catch (_) { return { error: VIDEO_ERROR }; }
  if (!['http:', 'https:'].includes(url.protocol)) return { error: VIDEO_ERROR };

  const host  = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
  const parts = url.pathname.split('/').filter(Boolean);
  let provider = null;
  let id = null;

  if (host === 'youtu.be') {
    provider = 'youtube'; id = parts[0];
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    provider = 'youtube';
    if (parts[0] === 'watch') id = url.searchParams.get('v');
    else if (['embed', 'shorts', 'live', 'v'].includes(parts[0])) id = parts[1];
  } else if (host === 'vimeo.com') {
    provider = 'vimeo'; id = [...parts].reverse().find((p) => /^\d+$/.test(p));
  } else if (host === 'player.vimeo.com' && parts[0] === 'video') {
    provider = 'vimeo'; id = parts[1];
  }

  if (provider === 'youtube' && YOUTUBE_ID.test(id || '')) return { value: { provider, id } };
  if (provider === 'vimeo' && VIMEO_ID.test(id || '')) return { value: { provider, id } };
  return { error: VIDEO_ERROR };
}

/** Player URL we control — never the developer's pasted markup. */
function embedUrl(provider, id) {
  if (provider === 'youtube' && YOUTUBE_ID.test(id || '')) return `https://www.youtube-nocookie.com/embed/${id}?rel=0`;
  if (provider === 'vimeo' && VIMEO_ID.test(id || '')) return `https://player.vimeo.com/video/${id}?dnt=1`;
  return null;
}

function watchUrl(provider, id) {
  if (provider === 'youtube' && YOUTUBE_ID.test(id || '')) return `https://www.youtube.com/watch?v=${id}`;
  if (provider === 'vimeo' && VIMEO_ID.test(id || '')) return `https://vimeo.com/${id}`;
  return null;
}

/** Validates the portfolio form body. Returns { errors: [], values }. */
function validatePortfolioInput(body = {}) {
  const errors = [];

  const title = cleanPlainText(body.title).replace(/\s+/g, ' ');
  if (!title) errors.push('Project / game name is required.');
  else if ([...title].length > LIMITS.title) errors.push(`Project / game name must be ${LIMITS.title} characters or fewer.`);

  const description = cleanPlainText(body.description);
  const length = [...description].length;
  if (length < LIMITS.descriptionMin) {
    errors.push(`Description must be at least ${LIMITS.descriptionMin} characters (currently ${length}).`);
  } else if (length > LIMITS.descriptionMax) {
    errors.push(`Description must be ${LIMITS.descriptionMax} characters or fewer.`);
  }

  const video = parseVideo(body.video);
  if (video.error) errors.push(video.error);

  const values = {
    title,
    description,
    video_provider: video.value ? video.value.provider : null,
    video_id:       video.value ? video.value.id : null,
  };
  for (const link of LINKS) {
    const result = normalizeLink(body[link.field], link);
    if (result.error) errors.push(result.error);
    else values[link.field] = result.value;
  }
  return { errors, values };
}

/** Shape a DB row for templates. */
function itemView(row) {
  return {
    ...row,
    embedUrl: embedUrl(row.video_provider, row.video_id),
    watchUrl: watchUrl(row.video_provider, row.video_id),
    links: LINKS.filter((l) => row[l.field]).map((l) => ({ field: l.field, label: l.label, url: row[l.field] })),
  };
}

/** Form values for editing an existing item. */
function formFromItem(item) {
  const form = {
    title: item.title,
    description: item.description,
    video: watchUrl(item.video_provider, item.video_id) || '',
  };
  for (const l of LINKS) form[l.field] = item[l.field] || '';
  return form;
}

/** Form values echoed back after a failed submit. */
function formFromBody(body = {}) {
  const form = {
    title: String(body.title ?? ''),
    description: String(body.description ?? ''),
    video: String(body.video ?? ''),
  };
  for (const l of LINKS) form[l.field] = String(body[l.field] ?? '');
  return form;
}

module.exports = {
  MAX_ITEMS,
  LIMITS,
  LINKS,
  parseVideo,
  normalizeLink,
  embedUrl,
  watchUrl,
  validatePortfolioInput,
  itemView,
  formFromItem,
  formFromBody,
};
