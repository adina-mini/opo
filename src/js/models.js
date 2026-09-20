/**
 * @file models.js
 * Core canonical data models for opo — Personal Opportunity Agent.
 * Strict adherence to the data model specification:
 * Profile, Listing, Requirement, Application state machine.
 */

/**
 * Enums & Vocab
 */
export const SkillLevel = Object.freeze({
  BEGINNER: 'beginner',
  INTERMEDIATE: 'intermediate',
  ADVANCED: 'advanced'
});

export const OpportunityType = Object.freeze({
  JOB: 'job',
  INTERNSHIP: 'internship',
  FELLOWSHIP: 'fellowship',
  SCHOLARSHIP: 'scholarship',
  RESEARCH: 'research',
  HACKATHON: 'hackathon',
  COMPETITION: 'competition',
  ACCELERATOR: 'accelerator',
  GRANT: 'grant'
});

export const RequirementImportance = Object.freeze({
  REQUIRED: 'required',
  PREFERRED: 'preferred'
});

export const LocationMode = Object.freeze({
  REMOTE: 'remote',
  ONSITE: 'onsite',
  HYBRID: 'hybrid',
  UNKNOWN: 'unknown' // listing didn't say — never guess
});

export const ApplicationState = Object.freeze({
  DISCOVERED: 'discovered',
  SHORTLISTED: 'shortlisted',
  DRAFTING: 'drafting',
  NEEDS_INPUT: 'needs_input',
  READY: 'ready',
  SUBMITTED: 'submitted',
  INTERVIEW: 'interview',
  OFFER: 'offer',
  REJECTED: 'rejected'
});

/**
 * Profile factories
 */

/**
 * @typedef {Object} Skill
 * @property {string} name
 * @property {'beginner'|'intermediate'|'advanced'} level
 * @property {string|null} [category]
 */
export function createSkill(name, level = SkillLevel.INTERMEDIATE, category = null) {
  return {
    name: name.trim(),
    level,
    category
  };
}

/**
 * @typedef {Object} Education
 * @property {string} degree
 * @property {string} institution
 * @property {string|null} [graduation_date]
 * @property {number|null} [gpa]
 * @property {number} [gpa_scale]
 */
export function createEducation(degree, institution, graduation_date = null, gpa = null, gpa_scale = 4.0) {
  return {
    degree: degree.trim(),
    institution: institution.trim(),
    graduation_date,
    gpa: gpa !== null ? Number(gpa) : null,
    gpa_scale: Number(gpa_scale) || 4.0
  };
}

/**
 * @typedef {Object} Preferences
 * @property {string[]} opportunity_types - INFORMATIONAL ONLY, never filters or penalizes
 * @property {boolean} remote_ok
 * @property {boolean} relocate_ok
 * @property {string[]} countries - acceptable countries; empty = no constraint
 * @property {number|null} min_compensation - None = unpaid is fully acceptable
 * @property {boolean} requires_funded - hard requirement, no exceptions if true
 * @property {number} min_match_score - below this, don't show it (default 0.70)
 * @property {string[]} excluded_keywords - hard reject if title/description matches
 */
export function createPreferences(overrides = {}) {
  return {
    opportunity_types: overrides.opportunity_types ?? [],
    remote_ok: overrides.remote_ok ?? true,
    relocate_ok: overrides.relocate_ok ?? false,
    countries: overrides.countries ?? [],
    min_compensation: overrides.min_compensation ?? null,
    requires_funded: overrides.requires_funded ?? false,
    min_match_score: overrides.min_match_score ?? 0.70,
    excluded_keywords: overrides.excluded_keywords ?? []
  };
}

/**
 * @typedef {Object} Profile
 * @property {string} name
 * @property {string} email
 * @property {Skill[]} skills
 * @property {Education[]} education
 * @property {Preferences} preferences
 * @property {Record<string, string>} answer_library
 * @property {string} [cv_text] - Full CV / Resume text
 * @property {string} [portfolio_url]
 * @property {string} [github_url]
 * @property {string} [linkedin_url]
 */
export function createProfile(
  name,
  email = '',
  skills = [],
  education = [],
  preferences = createPreferences(),
  answer_library = {},
  cv_text = '',
  portfolio_url = '',
  github_url = '',
  linkedin_url = ''
) {
  if (typeof name === 'object' && name !== null) {
    const p = name;
    return {
      name: (p.name || '').trim(),
      email: (p.email || '').trim(),
      skills: [...(p.skills || [])],
      education: [...(p.education || [])],
      preferences: { ...(p.preferences || createPreferences()) },
      answer_library: { ...(p.answer_library || {}) },
      cv_text: (p.cv_text || '').trim(),
      portfolio_url: (p.portfolio_url || '').trim(),
      github_url: (p.github_url || '').trim(),
      linkedin_url: (p.linkedin_url || '').trim()
    };
  }

  return {
    name: (name || '').trim(),
    email: (email || '').trim(),
    skills: [...skills],
    education: [...education],
    preferences: { ...preferences },
    answer_library: { ...answer_library },
    cv_text: (cv_text || '').trim(),
    portfolio_url: (portfolio_url || '').trim(),
    github_url: (github_url || '').trim(),
    linkedin_url: (linkedin_url || '').trim()
  };
}


/**
 * Listing factories
 */

/**
 * @typedef {Object} Requirement
 * @property {string} skill
 * @property {'required'|'preferred'} importance
 * @property {'beginner'|'intermediate'|'advanced'} min_level
 */
export function createRequirement(skill, importance = RequirementImportance.REQUIRED, min_level = SkillLevel.BEGINNER) {
  return {
    skill: skill.trim(),
    importance,
    min_level
  };
}

/**
 * @typedef {Object} Listing
 * @property {string} id
 * @property {string} title
 * @property {string} organization
 * @property {string} opportunity_type
 * @property {Requirement[]} requirements
 * @property {'remote'|'onsite'|'hybrid'|'unknown'} location_mode
 * @property {string[]} countries
 * @property {number|null} compensation - None = not stated (unknown, not unpaid)
 * @property {boolean} unpaid - explicitly unpaid, distinct from unknown
 * @property {boolean} is_funded
 * @property {number|null} application_fee - if set, trust signal
 * @property {string|null} deadline
 * @property {string[]} source_urls
 * @property {string} raw_description
 * @property {string[]} unusual_requirements - e.g. nomination letter, portfolio link, video intro
 */
export function createListing({
  id = null,
  title,
  organization,
  opportunity_type = OpportunityType.JOB,
  requirements = [],
  location_mode = LocationMode.UNKNOWN,
  countries = [],
  compensation = null,
  unpaid = false,
  is_funded = false,
  application_fee = null,
  deadline = null,
  source_urls = [],
  raw_description = '',
  unusual_requirements = []
}) {
  const generatedId = id || `listing_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  return {
    id: generatedId,
    title: (title || '').trim(),
    organization: (organization || '').trim(),
    opportunity_type,
    requirements: [...requirements],
    location_mode,
    countries: [...countries],
    compensation: compensation !== null && compensation !== undefined ? Number(compensation) : null,
    unpaid: Boolean(unpaid),
    is_funded: Boolean(is_funded),
    application_fee: application_fee !== null && application_fee !== undefined ? Number(application_fee) : null,
    deadline: deadline || null,
    source_urls: [...source_urls],
    raw_description: (raw_description || '').trim(),
    unusual_requirements: [...unusual_requirements]
  };
}

/**
 * Application factories (State Machine)
 */

/**
 * @typedef {Object} Application
 * @property {string} id
 * @property {string} listing_id
 * @property {Listing} listing
 * @property {string} state - discovered | shortlisted | drafting | needs_input | ready | submitted | interview | offer | rejected
 * @property {string} created_at
 * @property {string} updated_at
 * @property {Object} draft_content
 * @property {string} draft_content.cover_letter
 * @property {Record<string, string>} draft_content.custom_answers
 * @property {string} draft_content.notes
 * @property {string[]} missing_inputs
 * @property {string|null} submitted_at
 * @property {string|null} outcome_notes
 */
export function createApplication(listing, state = ApplicationState.DISCOVERED, draft_content = {}) {
  const now = new Date().toISOString();
  return {
    id: `app_${listing.id}`,
    listing_id: listing.id,
    listing,
    state,
    created_at: now,
    updated_at: now,
    draft_content: {
      cover_letter: draft_content.cover_letter || '',
      custom_answers: draft_content.custom_answers || {},
      notes: draft_content.notes || ''
    },
    missing_inputs: [...(listing.unusual_requirements || [])],
    submitted_at: null,
    outcome_notes: null
  };
}
