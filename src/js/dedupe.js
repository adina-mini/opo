/**
 * @file dedupe.js
 * Duplicate filter for opo — Personal Opportunity Agent.
 *
 * Collapses duplicate opportunities across multiple discovery feeds/boards
 * into a single canonical record keyed by fuzzy match on title+org or shared source URL.
 */

/**
 * Normalizes text for fuzzy comparison.
 * @param {string} str
 * @returns {string}
 */
export function normalizeString(str) {
  const base = (str || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const stripped = base
    .replace(/\b(inc|corp|corporation|llc|ltd|gmbh|co|technologies|labs|lab|org)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped || base;
}

/**
 * Extracts a normalized domain and path slug from a URL for collision detection.
 * @param {string} urlStr
 * @returns {string}
 */
export function normalizeUrlKey(urlStr) {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.replace(/^www\./, '');
    const pathname = parsed.pathname.replace(/\/+$/, '');
    return `${host}${pathname}`;
  } catch {
    return (urlStr || '').toLowerCase().trim();
  }
}

/**
 * Computes simple Levenshtein distance for fuzzy title matching.
 */
function levenshtein(a, b) {
  const an = a ? a.length : 0;
  const bn = b ? b.length : 0;
  if (an === 0) return bn;
  if (bn === 0) return an;
  const matrix = Array.from({ length: bn + 1 }, () => new Array(an + 1).fill(0));
  for (let i = 0; i <= an; i++) matrix[0][i] = i;
  for (let j = 0; j <= bn; j++) matrix[j][0] = j;
  for (let j = 1; j <= bn; j++) {
    for (let i = 1; i <= an; i++) {
      if (a[i - 1] === b[j - 1]) {
        matrix[j][i] = matrix[j - 1][i - 1];
      } else {
        matrix[j][i] = Math.min(
          matrix[j - 1][i - 1] + 1, // substitution
          matrix[j][i - 1] + 1,     // insertion
          matrix[j - 1][i] + 1      // deletion
        );
      }
    }
  }
  return matrix[bn][an];
}

/**
 * Checks whether two listings represent the same opportunity.
 * @param {import('./models.js').Listing} a
 * @param {import('./models.js').Listing} b
 * @returns {boolean}
 */
export function isDuplicate(a, b) {
  if (a.id && b.id && a.id === b.id) return true;

  // 1. Shared source URL or canonical path
  for (const urlA of (a.source_urls || [])) {
    const keyA = normalizeUrlKey(urlA);
    for (const urlB of (b.source_urls || [])) {
      const keyB = normalizeUrlKey(urlB);
      if (keyA && keyB && keyA === keyB) return true;
    }
  }

  // 2. Fuzzy Title + Org match
  const orgA = normalizeString(a.organization);
  const orgB = normalizeString(b.organization);

  if (orgA && orgB && (orgA === orgB || orgA.includes(orgB) || orgB.includes(orgA))) {
    const titleA = normalizeString(a.title);
    const titleB = normalizeString(b.title);

    if (titleA === titleB) return true;

    // Check fuzzy title similarity
    const maxLen = Math.max(titleA.length, titleB.length);
    if (maxLen > 8) {
      const dist = levenshtein(titleA, titleB);
      const similarity = 1 - dist / maxLen;
      if (similarity >= 0.85) return true;
    }
  }

  return false;
}

/**
 * Merges two duplicate listings into one canonical record.
 * @param {import('./models.js').Listing} canonical
 * @param {import('./models.js').Listing} incoming
 * @returns {import('./models.js').Listing}
 */
export function mergeListings(canonical, incoming) {
  // Merge source URLs
  const urls = Array.from(new Set([...(canonical.source_urls || []), ...(incoming.source_urls || [])]));

  // Merge unique requirements
  const reqMap = new Map();
  for (const r of (canonical.requirements || [])) {
    reqMap.set(r.skill.toLowerCase(), r);
  }
  for (const r of (incoming.requirements || [])) {
    const key = r.skill.toLowerCase();
    if (!reqMap.has(key)) {
      reqMap.set(key, r);
    }
  }

  // Merge unusual requirements
  const unusual = Array.from(new Set([...(canonical.unusual_requirements || []), ...(incoming.unusual_requirements || [])]));

  return {
    ...canonical,
    requirements: Array.from(reqMap.values()),
    source_urls: urls,
    unusual_requirements: unusual,
    // Keep longer description
    raw_description: (canonical.raw_description || '').length >= (incoming.raw_description || '').length
      ? canonical.raw_description
      : incoming.raw_description
  };
}

/**
 * Deduplicates a list of listings, preserving the most complete record.
 * @param {import('./models.js').Listing[]} listings
 * @returns {import('./models.js').Listing[]}
 */
export function deduplicateListings(listings) {
  const canonicalList = [];

  for (const item of listings) {
    const existingIdx = canonicalList.findIndex(existing => isDuplicate(existing, item));
    if (existingIdx >= 0) {
      canonicalList[existingIdx] = mergeListings(canonicalList[existingIdx], item);
    } else {
      canonicalList.push({ ...item });
    }
  }

  return canonicalList;
}
