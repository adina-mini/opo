/**
 * @file matching.js
 * Match Scoring Engine for opo — Personal Opportunity Agent.
 *
 * Scoring Rules (strictly prioritized):
 * 1. Hard rejects first (score forced to 0.0, never shown):
 *    - Excluded keyword in title/description.
 *    - Listing has REQUIRED skills and profile matches NONE of them.
 *      (Partial match is scored, never rejected.)
 * 2. Skills are ~80% of the score (strongest genuine fit signal).
 * 3. Opportunity type is informational only and NEVER reduces the score.
 * 4. Unpaid opportunities are welcomed, not penalized (unpaid=true scores 1.0 comp fit).
 * 5. Location mismatches are soft/informational, not hard filters. Unknown is flagged, never guessed.
 * 6. Application fee is a trust signal: score * 0.6 + prominent verification flag + payment_required boolean.
 * 7. Every result carries plain-language reasons (✓/✗) and flags for low-confidence fields.
 */

import { LocationMode, RequirementImportance } from './models.js';

export const MATCH_WEIGHTS = Object.freeze({
  skills: 0.80,
  location: 0.10,
  compensation: 0.10
});

/**
 * @typedef {Object} MatchResult
 * @property {number} score - Overall match score (0.0 to 1.0)
 * @property {string[]} reasons - Plain-language bullet points explaining fit (✓/✗)
 * @property {string[]} flags - Low-confidence or items requiring user confirmation
 * @property {boolean} hard_rejected - Whether the listing was hard-rejected
 * @property {string|null} hard_reject_reason - Reason for hard rejection
 * @property {boolean} payment_required - Trust signal for application fee
 */

/**
 * Normalizes skill names for case-insensitive and punctuation-tolerant matching.
 * @param {string} skill
 * @returns {string}
 */
export function normalizeSkill(skill) {
  return (skill || '')
    .toLowerCase()
    .trim()
    .replace(/[._\-]/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Checks if a profile possesses a skill, with smart prefix/alias tolerance
 * (e.g. 'react' matches 'react.js', 'postgres' matches 'postgresql').
 * @param {Set<string>} profileSkills
 * @param {string} targetSkill
 * @returns {boolean}
 */
export function hasSkill(profileSkills, targetSkill) {
  const normTarget = normalizeSkill(targetSkill);
  if (profileSkills.has(normTarget)) return true;

  // Prefix / token match for common synonyms (e.g. node / node.js, postgres / postgresql)
  for (const s of profileSkills) {
    if (s === normTarget) return true;
    if (s.length > 2 && normTarget.length > 2) {
      if (s.startsWith(normTarget) || normTarget.startsWith(s)) return true;
    }
  }
  return false;
}

/**
 * Evaluates skill fit.
 * @param {import('./models.js').Profile} profile
 * @param {import('./models.js').Listing} listing
 * @returns {{ score: number, reasons: string[], hardReject: boolean, hardReason: string|null }}
 */
function scoreSkills(profile, listing) {
  const reasons = [];
  const profileSkills = new Set((profile.skills || []).map(s => normalizeSkill(s.name)));

  if (!listing.requirements || listing.requirements.length === 0) {
    return {
      score: 0.15,
      reasons: ['No skill requirements detected — low signal'],
      hardReject: false,
      hardReason: null
    };
  }

  const required = listing.requirements.filter(
    r => r.importance === RequirementImportance.REQUIRED
  );
  const preferred = listing.requirements.filter(
    r => r.importance === RequirementImportance.PREFERRED
  );

  const requiredHits = required.filter(r => hasSkill(profileSkills, r.skill)).length;
  const preferredHits = preferred.filter(r => hasSkill(profileSkills, r.skill)).length;

  // Rule 1B: If listing has REQUIRED skills and the profile matches NONE -> Hard Reject
  if (required.length > 0 && requiredHits === 0) {
    const missing = required.map(r => r.skill).join(', ');
    return {
      score: 0.0,
      reasons: [],
      hardReject: true,
      hardReason: `Missing all required skills: ${missing}`
    };
  }

  // Calculate score breakdown
  const reqRatio = required.length > 0 ? requiredHits / required.length : 1.0;
  const prefRatio = preferred.length > 0 ? preferredHits / preferred.length : 1.0;

  let skillScore;
  if (required.length > 0 && preferred.length > 0) {
    skillScore = 0.75 * reqRatio + 0.25 * prefRatio;
  } else if (required.length > 0) {
    skillScore = reqRatio;
  } else {
    // Only preferred skills specified
    skillScore = prefRatio;
  }

  // Generate plain-language reasons
  for (const r of required) {
    const hit = hasSkill(profileSkills, r.skill);
    reasons.push(`${hit ? '✓' : '✗'} ${r.skill} (required)`);
  }
  for (const r of preferred) {
    const hit = hasSkill(profileSkills, r.skill);
    reasons.push(`${hit ? '✓' : '✗'} ${r.skill} (preferred)`);
  }

  return {
    score: skillScore,
    reasons,
    hardReject: false,
    hardReason: null
  };
}

/**
 * Rule 3: Opportunity type is informational only and NEVER reduces the score.
 * A full-time job scores identically to an internship if skills fit is identical.
 * @param {import('./models.js').Profile} profile
 * @param {import('./models.js').Listing} listing
 * @returns {string[]} reasons
 */
function evaluateTypeInfo(profile, listing) {
  const prefs = profile.preferences || {};
  const userTypes = prefs.opportunity_types || [];
  const typeName = (listing.opportunity_type || 'Opportunity').replace(/_/g, ' ');

  if (!userTypes.length) {
    return [];
  }

  if (userTypes.includes(listing.opportunity_type)) {
    return [`✓ ${typeName} matches your preferred types`];
  }

  // Informational note — NEVER penalizes score
  return [`Outside your usual opportunity types (${typeName}), shown for the skills fit`];
}

/**
 * Rule 5: Location mismatches are soft/informational, not a hard filter.
 * Ambiguous/unknown location is flagged for the user to confirm, never assumed.
 * @param {import('./models.js').Profile} profile
 * @param {import('./models.js').Listing} listing
 * @returns {{ score: number, reasons: string[], flags: string[] }}
 */
function scoreLocation(profile, listing) {
  const prefs = profile.preferences || {};
  const reasons = [];
  const flags = [];

  // Ambiguous / Unknown location
  if (!listing.location_mode || listing.location_mode === LocationMode.UNKNOWN) {
    flags.push('Location mode not specified by listing — confirm before applying');
    return { score: 0.5, reasons, flags };
  }

  // Remote role
  if (listing.location_mode === LocationMode.REMOTE) {
    if (prefs.remote_ok) {
      reasons.push('✓ Remote, matches your preference');
      return { score: 1.0, reasons, flags };
    }
    reasons.push('Remote role, but you indicated remote is not preferred');
    return { score: 0.6, reasons, flags };
  }

  // Onsite / Hybrid role
  const listingCountries = (listing.countries || []).map(c => c.toLowerCase().trim());
  const userCountries = (prefs.countries || []).map(c => c.toLowerCase().trim());

  if (!prefs.relocate_ok && listingCountries.length > 0 && userCountries.length > 0) {
    const hasOverlap = listingCountries.some(c => userCountries.includes(c));
    if (!hasOverlap) {
      flags.push(`Onsite in ${listing.countries.join(', ')} — check relocation requirements`);
      reasons.push(`✗ Onsite in ${listing.countries.join(', ')}, outside your accepted countries`);
      return { score: 0.2, reasons, flags };
    }
  }

  const modeTitle = listing.location_mode.charAt(0).toUpperCase() + listing.location_mode.slice(1);
  if (listingCountries.length > 0) {
    reasons.push(`✓ ${modeTitle} in ${listing.countries.join(', ')}`);
  } else {
    reasons.push(`✓ ${modeTitle} opportunity`);
  }

  return { score: 1.0, reasons, flags };
}

/**
 * Rule 4: Unpaid opportunities are welcomed, not penalized.
 * If explicitly unpaid=true, score comp at 1.0 with neutral note.
 * Only penalize if user set min_compensation AND listing states a lower number.
 * @param {import('./models.js').Profile} profile
 * @param {import('./models.js').Listing} listing
 * @returns {{ score: number, reasons: string[], flags: string[] }}
 */
function scoreCompensation(profile, listing) {
  const prefs = profile.preferences || {};
  const reasons = [];
  const flags = [];

  // Hard requirement on funding
  if (prefs.requires_funded && !listing.is_funded && !listing.compensation) {
    reasons.push('✗ Not marked as funded, and you require funded opportunities');
    return { score: 0.0, reasons, flags };
  }

  // Explicitly unpaid opportunity -> Welcomed, not penalized!
  if (listing.unpaid === true) {
    if (prefs.min_compensation !== null && prefs.min_compensation > 0) {
      reasons.push(`✗ Unpaid opportunity, but you requested min compensation of $${prefs.min_compensation}`);
      return { score: 0.1, reasons, flags };
    }
    reasons.push('Unpaid opportunity (welcomed by default)');
    return { score: 1.0, reasons, flags };
  }

  // Compensation genuinely not stated (unknown, not unpaid)
  if (listing.compensation === null || listing.compensation === undefined) {
    flags.push('Compensation not stated — confirm before applying');
    return { score: 0.7, reasons, flags };
  }

  // Stated compensation below minimum
  if (prefs.min_compensation !== null && listing.compensation < prefs.min_compensation) {
    reasons.push(`✗ Compensation ($${listing.compensation}) is below your minimum ($${prefs.min_compensation})`);
    flags.push(`Compensation ($${listing.compensation}) is below your minimum preference ($${prefs.min_compensation})`);
    return { score: 0.0, reasons, flags };
  }

  reasons.push('✓ Compensation meets your stated preference');
  return { score: 1.0, reasons, flags };
}

/**
 * Main Match Scoring Function
 * Evaluates a Profile against a Listing and produces score, reasons, and flags.
 * @param {import('./models.js').Profile} profile
 * @param {import('./models.js').Listing} listing
 * @returns {MatchResult}
 */
export function match(profile, listing) {
  const prefs = profile.preferences || {};
  const haystack = `${listing.title || ''} ${listing.raw_description || ''}`.toLowerCase();

  // Rule 1A: Hard reject on excluded keywords
  for (const kw of (prefs.excluded_keywords || [])) {
    if (kw && haystack.includes(kw.toLowerCase().trim())) {
      return {
        score: 0.0,
        reasons: [],
        flags: [],
        hard_rejected: true,
        hard_reject_reason: `Contains excluded keyword: '${kw}'`,
        payment_required: false
      };
    }
  }

  // Rule 1B & 2: Skill evaluation (~80% weight)
  const skillRes = scoreSkills(profile, listing);
  if (skillRes.hardReject) {
    return {
      score: 0.0,
      reasons: [],
      flags: [],
      hard_rejected: true,
      hard_reject_reason: skillRes.hardReason,
      payment_required: false
    };
  }

  // Rule 3: Opportunity Type (Informational only, 0 penalty)
  const typeReasons = evaluateTypeInfo(profile, listing);

  // Rule 5: Location evaluation (soft, ~10% weight)
  const locRes = scoreLocation(profile, listing);

  // Rule 4: Compensation evaluation (welcoming unpaid, ~10% weight)
  const compRes = scoreCompensation(profile, listing);

  // Calculate weighted total score
  let total = (
    MATCH_WEIGHTS.skills * skillRes.score +
    MATCH_WEIGHTS.location * locRes.score +
    MATCH_WEIGHTS.compensation * compRes.score
  );

  const reasons = [
    ...skillRes.reasons,
    ...typeReasons,
    ...locRes.reasons,
    ...compRes.reasons
  ];

  const flags = [
    ...locRes.flags,
    ...compRes.flags
  ];

  // Surface unusual requirements explicitly as flags
  if (listing.unusual_requirements && listing.unusual_requirements.length > 0) {
    flags.push(`Requires: ${listing.unusual_requirements.join(', ')} — not in your profile yet`);
  }

  // Rule 6: Application fee is a trust signal, not a fit signal
  const paymentRequired = listing.application_fee !== null && listing.application_fee > 0;
  if (paymentRequired) {
    flags.push(`⚠️ Requires an application fee ($${listing.application_fee}) — verify this is legitimate before paying anything`);
    // Apply moderate discount
    total *= 0.6;
  }

  return {
    score: Math.round(total * 1000) / 1000,
    reasons,
    flags,
    hard_rejected: false,
    hard_reject_reason: null,
    payment_required: paymentRequired
  };
}

/**
 * Determines whether a listing passes the user's minimum match score threshold.
 * @param {import('./models.js').Profile} profile
 * @param {MatchResult} result
 * @returns {boolean}
 */
export function passesThreshold(profile, result) {
  if (!result || result.hard_rejected) return false;
  const minScore = profile?.preferences?.min_match_score ?? 0.70;
  return result.score >= minScore;
}
