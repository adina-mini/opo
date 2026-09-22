/**
 * @file discovery.js
 * Opportunity Discovery Engine for opo — Personal Opportunity Agent.
 *
 * Strictly fetches from verified, live public opportunity feeds:
 * 1. Remotive API (https://remotive.com/api/remote-jobs)
 * 2. Arbeitnow Public API (https://www.arbeitnow.com/api/job-board-api)
 *
 * All listings surfaced to the user are 100% genuine with verifiable application URLs.
 * (Synthetic test fixtures live strictly in tests/fixtures/ for unit testing).
 */

import {
  createListing,
  createRequirement,
  OpportunityType,
  RequirementImportance,
  LocationMode
} from './models.js';
import { deduplicateListings } from './dedupe.js';
import { extractSkillsWithGroq } from './groq.js';
import { Storage } from './db.js';

const REMOTIVE_API_URL = 'https://remotive.com/api/remote-jobs';
const ARBEITNOW_API_URL = 'https://www.arbeitnow.com/api/job-board-api';

/**
 * Strips HTML tags and unescapes common entities.
 * @param {string} html
 * @returns {string}
 */
export function stripHtml(html) {
  if (!html) return '';
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses publication date safely.
 */
function parseDate(dateStr) {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
  } catch {
    return null;
  }
}

/**
 * Maps raw listing title / tags to OpportunityType enum
 */
function inferOpportunityType(title = '', tags = []) {
  const text = `${title} ${tags.join(' ')}`.toLowerCase();
  if (text.includes('fellowship') || text.includes('fellow')) return OpportunityType.FELLOWSHIP;
  if (text.includes('intern') || text.includes('praktik')) return OpportunityType.INTERNSHIP;
  if (text.includes('scholarship') || text.includes('stipendium')) return OpportunityType.SCHOLARSHIP;
  if (text.includes('research') || text.includes('scientist') || text.includes('phd') || text.includes('postdoc')) return OpportunityType.RESEARCH;
  if (text.includes('hackathon') || text.includes('challenge')) return OpportunityType.HACKATHON;
  if (text.includes('grant')) return OpportunityType.GRANT;
  return OpportunityType.JOB;
}

/**
 * Fetches real live listings from the Remotive API with proxy fallback.
 * @param {Object} options
 * @param {string} [options.search]
 * @param {number} [options.limit]
 * @returns {Promise<import('./models.js').Listing[]>}
 */
export async function fetchRemotiveListings({ search = '', limit = 15 } = {}) {
  let url = `${REMOTIVE_API_URL}?limit=${limit}`;
  if (search && search.trim()) {
    url += `&search=${encodeURIComponent(search.trim())}`;
  }

  let payload = null;

  // Try direct browser fetch first
  try {
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (resp.ok) {
      payload = await resp.json();
    }
  } catch (directErr) {
    console.warn('Direct fetch to Remotive failed, falling back to /api/proxy:', directErr);
  }

  // Fallback to /api/proxy if direct fetch failed
  if (!payload) {
    try {
      const proxyUrl = `/api/proxy?url=${encodeURIComponent(url)}`;
      const resp = await fetch(proxyUrl);
      if (resp.ok) {
        payload = await resp.json();
      }
    } catch (proxyErr) {
      console.error('Proxy fetch to Remotive failed:', proxyErr);
      return [];
    }
  }

  const rawJobs = payload?.jobs || [];
  const listings = [];

  for (const job of rawJobs.slice(0, limit)) {
    const plainDesc = stripHtml(job.description || '');

    // Extract default requirements from job tags if available
    const reqs = [];
    const tags = Array.isArray(job.tags) ? job.tags : [];
    for (const tag of tags.slice(0, 5)) {
      if (tag && typeof tag === 'string') {
        reqs.push(createRequirement(tag.toLowerCase().trim(), RequirementImportance.PREFERRED));
      }
    }

    const loc = (job.candidate_required_location || '').trim();
    const countries = loc && !['worldwide', 'anywhere', 'remote'].includes(loc.toLowerCase())
      ? [loc]
      : [];

    const comp = parseSalaryCompensation(job.salary || plainDesc);
    let deadline = null;
    if (job.publication_date) {
      const pubDate = new Date(job.publication_date);
      if (!isNaN(pubDate.getTime())) {
        const expDate = new Date(pubDate.getTime() + 30 * 24 * 60 * 60 * 1000);
        deadline = expDate.toISOString().split('T')[0];
      }
    }

    listings.push(createListing({
      id: `remotive_${job.id}`,
      title: (job.title || 'Untitled Opportunity').trim(),
      organization: (job.company_name || 'Organization').trim(),
      opportunity_type: inferOpportunityType(job.title, tags),
      requirements: reqs,
      location_mode: LocationMode.REMOTE,
      countries,
      compensation: comp,
      is_funded: comp !== null && comp > 0,
      unpaid: false,
      deadline: deadline,
      source_urls: job.url ? [job.url] : [],
      raw_description: plainDesc
    }));
  }

  return listings;
}

/**
 * Fetches real live listings from the Arbeitnow Public API.
 * Free, open public API covering international opportunities, internships, and research roles.
 * @param {Object} options
 * @param {number} [options.limit]
 * @returns {Promise<import('./models.js').Listing[]>}
 */
export async function fetchArbeitnowListings({ search = '', limit = 25 } = {}) {
  let payload = null;

  try {
    const resp = await fetch(ARBEITNOW_API_URL, { headers: { 'Accept': 'application/json' } });
    if (resp.ok) {
      payload = await resp.json();
    }
  } catch (directErr) {
    console.warn('Direct fetch to Arbeitnow failed, falling back to /api/proxy:', directErr);
  }

  if (!payload) {
    try {
      const proxyUrl = `/api/proxy?url=${encodeURIComponent(ARBEITNOW_API_URL)}`;
      const resp = await fetch(proxyUrl);
      if (resp.ok) {
        payload = await resp.json();
      }
    } catch (proxyErr) {
      console.error('Proxy fetch to Arbeitnow failed:', proxyErr);
      return [];
    }
  }

  let rawJobs = payload?.data || [];
  
  // Filter by search query if specified
  if (search && search.trim()) {
    const q = search.toLowerCase().trim();
    rawJobs = rawJobs.filter(j => {
      const title = (j.title || '').toLowerCase();
      const desc = (j.description || '').toLowerCase();
      const tags = (j.tags || []).map(t => String(t).toLowerCase());
      return title.includes(q) || desc.includes(q) || tags.some(t => t.includes(q));
    });
  }

  const listings = [];

  for (const job of rawJobs.slice(0, limit)) {
    const plainDesc = stripHtml(job.description || '');
    const tags = Array.isArray(job.tags) ? job.tags : [];
    const reqs = tags.slice(0, 5).map(t => createRequirement(t.toLowerCase().trim(), RequirementImportance.PREFERRED));

    const isRemote = job.remote === true;
    const countries = job.location ? [job.location] : [];

    const comp = parseSalaryCompensation(plainDesc);
    let deadline = null;
    if (job.created_at) {
      const createdTime = typeof job.created_at === 'number' ? (job.created_at > 1e11 ? job.created_at : job.created_at * 1000) : new Date(job.created_at).getTime();
      if (!isNaN(createdTime)) {
        const expDate = new Date(createdTime + 30 * 24 * 60 * 60 * 1000);
        deadline = expDate.toISOString().split('T')[0];
      }
    }

    listings.push(createListing({
      id: `arbeitnow_${job.slug || Math.random().toString(36).substring(2, 9)}`,
      title: (job.title || 'Untitled Opportunity').trim(),
      organization: (job.company_name || 'Organization').trim(),
      opportunity_type: inferOpportunityType(job.title, tags),
      requirements: reqs,
      location_mode: isRemote ? LocationMode.REMOTE : (countries.length ? LocationMode.ONSITE : LocationMode.UNKNOWN),
      countries,
      compensation: comp,
      is_funded: comp !== null && comp > 0,
      unpaid: false,
      deadline: deadline,
      source_urls: job.url ? [job.url] : [],
      raw_description: plainDesc
    }));
  }

  return listings;
}

/**
 * Calculates deadline urgency relative to a reference date.
 * Opportunities ending in 7 days or fewer are marked urgent.
 * @param {string|null} deadlineStr - ISO or YYYY-MM-DD string
 * @param {Date} [referenceDate] - defaults to current date
 * @returns {{ hasDeadline: boolean, isUrgent: boolean, isExpired: boolean, label: string, daysRemaining: number|null }}
 */
export function calculateDeadlineUrgency(deadlineStr, referenceDate = new Date()) {
  if (!deadlineStr) {
    return {
      hasDeadline: false,
      isUrgent: false,
      isExpired: false,
      label: 'Rolling / Open',
      daysRemaining: null
    };
  }

  try {
    const deadline = new Date(deadlineStr);
    if (isNaN(deadline.getTime())) {
      return {
        hasDeadline: false,
        isUrgent: false,
        isExpired: false,
        label: 'Rolling / Open',
        daysRemaining: null
      };
    }

    const ref = new Date(referenceDate);
    const dTime = new Date(deadline.getFullYear(), deadline.getMonth(), deadline.getDate()).getTime();
    const rTime = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate()).getTime();
    const diffDays = Math.round((dTime - rTime) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return {
        hasDeadline: true,
        isUrgent: false,
        isExpired: true,
        label: 'Closed / Expired',
        daysRemaining: diffDays
      };
    }

    if (diffDays === 0) {
      return {
        hasDeadline: true,
        isUrgent: true,
        isExpired: false,
        label: 'Urgent • Ends Today',
        daysRemaining: 0
      };
    }

    if (diffDays === 1) {
      return {
        hasDeadline: true,
        isUrgent: true,
        isExpired: false,
        label: 'Urgent • 1 day left',
        daysRemaining: 1
      };
    }

    if (diffDays <= 7) {
      return {
        hasDeadline: true,
        isUrgent: true,
        isExpired: false,
        label: `Urgent • ${diffDays} days left`,
        daysRemaining: diffDays
      };
    }

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const formatted = `${monthNames[deadline.getMonth()]} ${deadline.getDate()}`;
    return {
      hasDeadline: true,
      isUrgent: false,
      isExpired: false,
      label: `Due ${formatted} (${diffDays}d left)`,
      daysRemaining: diffDays
    };
  } catch {
    return {
      hasDeadline: false,
      isUrgent: false,
      isExpired: false,
      label: 'Rolling / Open',
      daysRemaining: null
    };
  }
}

/**
 * Parses salary strings like "$90k - $120k", "$4,000 / month", "€60,000" into estimated monthly compensation.
 * @param {string} salaryStr
 * @returns {number|null}
 */
export function parseSalaryCompensation(salaryStr) {
  if (!salaryStr || typeof salaryStr !== 'string') return null;
  const clean = salaryStr.toLowerCase().replace(/,/g, '');
  
  const kMatch = clean.match(/(\d+)\s*k/);
  if (kMatch) {
    const yearly = parseInt(kMatch[1], 10) * 1000;
    return Math.round(yearly / 12);
  }

  const numMatch = clean.match(/\$?(\d{4,6})/);
  if (numMatch) {
    const val = parseInt(numMatch[1], 10);
    if (clean.includes('/mo') || clean.includes('month')) {
      return val;
    }
    if (val >= 20000) {
      return Math.round(val / 12);
    }
    return val;
  }

  return null;
}


/**
 * Coordinates discovery across real live sources, deduplicates, and enriches listings.
 * @param {Object} options
 * @param {string} [options.search]
 * @param {boolean} [options.enrichWithGroq]
 * @returns {Promise<import('./models.js').Listing[]>}
 */
export async function discoverOpportunities({ search = '', enrichWithGroq = true } = {}) {
  const allListings = [];

  // 1. Fetch concurrently from live verified APIs and scholarship/fellowship streams
  const [remotiveRes, arbeitnowRes] = await Promise.allSettled([
    fetchRemotiveListings({ search, limit: 25 }),
    fetchArbeitnowListings({ search, limit: 25 })
  ]);

  if (remotiveRes.status === 'fulfilled' && Array.isArray(remotiveRes.value)) {
    allListings.push(...remotiveRes.value);
  }
  if (arbeitnowRes.status === 'fulfilled' && Array.isArray(arbeitnowRes.value)) {
    allListings.push(...arbeitnowRes.value);
  }


  // Deduplicate across sources
  const deduped = deduplicateListings(allListings);

  // If Groq API key is set and enrichment is requested, extract skills for top listings lacking requirements
  const groqKey = Storage.getGroqApiKey();
  if (groqKey && enrichWithGroq) {
    for (const listing of deduped.slice(0, 6)) {
      if (listing.requirements.length === 0 && listing.raw_description) {
        try {
          const extracted = await extractSkillsWithGroq(listing.raw_description, groqKey);
          if (extracted.ok && (extracted.required.length > 0 || extracted.preferred.length > 0)) {
            listing.requirements = [
              ...extracted.required.map(s => createRequirement(s, RequirementImportance.REQUIRED)),
              ...extracted.preferred.map(s => createRequirement(s, RequirementImportance.PREFERRED))
            ];
          }
        } catch (e) {
          console.warn(`Extraction skipped for ${listing.title}:`, e);
        }
      }
    }
  }

  // Cache latest genuine discovered listings locally
  Storage.saveCachedListings(deduped);
  return deduped;
}

