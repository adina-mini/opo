/**
 * @file groq.js
 * Browser-Direct Groq LLM Client for opo — Personal Opportunity Agent.
 *
 * Design & Safety Principles:
 * 1. Zero-Knowledge: Direct from browser to Groq API. The key never touches a developer server.
 * 2. Never cache failed extractions (rate limits, parse errors, network errors).
 * 3. High token budget (max_tokens: 2500, reasoning_effort: 'low') so reasoning models
 *    do not exhaust their budget during internal chain-of-thought.
 * 4. Cross-industry generic extraction prompt (nurses, accountants, teachers, designers, engineers).
 */

import { Storage } from './db.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models';

// Ordered preference list: try the best model first, cascade through fallbacks.
export const PREFERRED_MODELS = [
  'openai/gpt-oss-20b',
  'llama-3.3-70b-versatile',
  'llama-3.1-8b-instant'
];

// For backwards compat — external code that imported these constants.
export const DEFAULT_GROQ_MODEL = PREFERRED_MODELS[0];
export const FALLBACK_GROQ_MODELS = PREFERRED_MODELS.slice(1);

/**
 * Cached result from the last /v1/models probe so we don't hit it on every call.
 * Shape: { model: string, ts: number } | null
 */
let _resolvedModelCache = null;
const MODEL_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Queries /v1/models, intersects with PREFERRED_MODELS, returns the best available.
 * Result is cached in-memory for 10 minutes.
 * Falls back to PREFERRED_MODELS[0] if the probe fails (network error, etc.).
 * @param {string} apiKey
 * @returns {Promise<string>}
 */
export async function resolveAvailableModel(apiKey) {
  if (_resolvedModelCache && (Date.now() - _resolvedModelCache.ts) < MODEL_CACHE_TTL_MS) {
    return _resolvedModelCache.model;
  }

  try {
    const resp = await fetch(GROQ_MODELS_URL, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey.trim()}` }
    });

    if (resp.ok) {
      const body = await resp.json();
      const available = new Set((body?.data || []).map(m => m.id));

      for (const candidate of PREFERRED_MODELS) {
        if (available.has(candidate)) {
          _resolvedModelCache = { model: candidate, ts: Date.now() };
          return candidate;
        }
      }
    }
  } catch {
    // Probe failed — fall through to default.
  }

  // Couldn't determine — use first preference and let the call-site handle errors.
  return PREFERRED_MODELS[0];
}

/** Invalidate the cached model resolution (e.g. after key change). */
export function clearModelCache() {
  _resolvedModelCache = null;
}

/**
 * Generic cross-industry skill and requirement extraction prompt.
 * Strictly unbiased towards any single discipline.
 */
const EXTRACTION_SYSTEM_PROMPT = `You are an expert opportunity listing parser.
Extract the required and preferred skills, competencies, certifications, or qualifications from the opportunity description.

Rules:
1. "required" = must-have qualifications, skills, credentials, or proficiencies (e.g. "must have", "required", "minimum 3 years of", "board certified in", "fluent in").
2. "preferred" = nice-to-have, bonus, or complementary qualifications (e.g. "preferred", "bonus", "plus", "familiarity with", "advantageous").
3. Include domain-specific practical skills, methodologies, tools, languages, software, or credentials across any field (healthcare, design, education, accounting, research, technology, trades, etc.). Skip vague platitudes like "hard worker" or "great communicator".
4. Normalize to concise, lowercase canonical skill names (e.g. "Pediatric Care" -> "pediatric care", "Adobe Illustrator" -> "adobe illustrator", "Financial Modeling" -> "financial modeling").
5. If the listing states no specific qualifications, return empty arrays. Never invent or hallucinate skills.

Output format:
Return ONLY valid JSON with this exact shape:
{"required": ["skill1", "skill2"], "preferred": ["skill3"]}`;

/**
 * Hash generator for local disk/storage caching
 */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `h_${Math.abs(hash).toString(36)}`;
}

/**
 * Tests a Groq API key with a minimal ping.
 * @param {string} apiKey
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function testGroqApiKey(apiKey) {
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, error: 'API key is empty.' };
  }

  try {
    // Verify key directly against Groq's models endpoint
    const resp = await fetch('https://api.groq.com/openai/v1/models', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`
      }
    });

    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      const msg = errData?.error?.message || `HTTP ${resp.status}: ${resp.statusText}`;
      return { ok: false, error: msg };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || 'Network error connecting to Groq.' };
  }
}

/**
 * Strips <think>...</think> reasoning tags and markdown wrappers.
 * Essential for reasoning models like openai/gpt-oss-20b so internal thoughts
 * do not leak into cover letters or break JSON parsing.
 * @param {string} text
 * @returns {string}
 */
export function cleanReasoningOutput(text) {
  if (!text || typeof text !== 'string') return '';
  // Strip <think>...</think> tags and everything inside them
  let cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // Strip conversational thought prefixes like "Thought: ... \n\n"
  cleaned = cleaned.replace(/^thought:[\s\S]*?\n\n/i, '').trim();
  // Strip markdown code fence wrappers
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  return cleaned.trim();
}

/**
 * Extracts skills from raw description using Groq LLM.
 * Strictly adheres to:
 * - Never caches a failed result.
 * - Strips reasoning tokens (<think> tags) before JSON extraction.
 * - Robust fallback regex if JSON parser encounters trailing commentary.
 * @param {string} rawDescription
 * @param {string} [customApiKey]
 * @returns {Promise<{ required: string[], preferred: string[], ok: boolean, error?: string }>}
 */
export async function extractSkillsWithGroq(rawDescription, customApiKey = null) {
  const apiKey = customApiKey || Storage.getGroqApiKey();
  if (!apiKey) {
    return { required: [], preferred: [], ok: false, error: 'No API key provided.' };
  }

  const cleanText = (rawDescription || '').slice(0, 4000).trim();
  if (!cleanText) {
    return { required: [], preferred: [], ok: true };
  }

  const cacheKey = `groq_extract_${hashString(cleanText)}`;

  // Check local cache
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && Array.isArray(parsed.required)) {
        return { ...parsed, ok: true };
      }
    }
  } catch {
    // Cache read failed, proceed to fetch
  }

  // Resolve best available model (cached probe)
  const resolvedModel = await resolveAvailableModel(apiKey);

  // Attempt extraction with retries for rate limits and model-fallback cascade
  let rawContent = null;
  let lastError = null;
  const modelsToTry = [resolvedModel, ...PREFERRED_MODELS.filter(m => m !== resolvedModel)];

  for (const model of modelsToTry) {
    let modelFailed = false;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const requestPayload = {
          model,
          messages: [
            { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
            { role: 'user', content: `Opportunity Description:\n\n${cleanText}` }
          ],
          temperature: 0.1,
          max_tokens: 2500,
          reasoning_effort: 'low'
        };

        const resp = await fetch(GROQ_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey.trim()}`
          },
          body: JSON.stringify(requestPayload)
        });

        if (resp.status === 429) {
          // Rate limited — wait and retry same model
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }

        if (resp.status === 404) {
          // Model not found — skip to next model in the cascade
          console.warn(`Groq model "${model}" not found, trying next fallback.`);
          modelFailed = true;
          break;
        }

        if (!resp.ok) {
          const errJson = await resp.json().catch(() => ({}));
          throw new Error(errJson?.error?.message || `HTTP ${resp.status}`);
        }

        const data = await resp.json();
        rawContent = data?.choices?.[0]?.message?.content || '';
        break;
      } catch (err) {
        lastError = err;
        if (attempt < 1) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }

    if (rawContent || modelFailed) {
      if (rawContent) break;
      // modelFailed — continue to next model
      continue;
    }
  }

  if (!rawContent) {
    console.warn('Groq extraction failed (will NOT be cached):', lastError);
    return { required: [], preferred: [], ok: false, error: lastError?.message };
  }

  // Clean reasoning output (<think> tags) before parsing JSON
  const cleaned = cleanReasoningOutput(rawContent);
  let parsed = null;

  try {
    const startIdx = cleaned.indexOf('{');
    const endIdx = cleaned.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      parsed = JSON.parse(cleaned.substring(startIdx, endIdx + 1));
    }
  } catch {
    // Standard parse failed, attempt regex extraction fallback
  }

  if (!parsed || !Array.isArray(parsed.required)) {
    try {
      const reqMatch = cleaned.match(/"required"\s*:\s*\[([^\]]*)\]/i);
      const prefMatch = cleaned.match(/"preferred"\s*:\s*\[([^\]]*)\]/i);
      if (reqMatch || prefMatch) {
        const parseArray = (str) => {
          if (!str) return [];
          return str.split(',')
            .map(s => s.replace(/["'\r\n]/g, '').trim())
            .filter(Boolean);
        };
        parsed = {
          required: reqMatch ? parseArray(reqMatch[1]) : [],
          preferred: prefMatch ? parseArray(prefMatch[1]) : []
        };
      }
    } catch (regexErr) {
      console.warn('Regex JSON extraction fallback failed:', regexErr);
    }
  }

  if (!parsed || (!Array.isArray(parsed.required) && !Array.isArray(parsed.preferred))) {
    console.warn('No valid qualifications found in Groq response (will NOT be cached):', cleaned);
    return { required: [], preferred: [], ok: false, error: 'Could not parse qualifications JSON.' };
  }

  const cleanList = (list) => {
    if (!Array.isArray(list)) return [];
    return list
      .filter(s => typeof s === 'string' && s.trim().length > 0)
      .map(s => s.toLowerCase().trim());
  };

  const result = {
    required: cleanList(parsed.required),
    preferred: cleanList(parsed.preferred)
  };

  // Cache ONLY valid successful results
  try {
    localStorage.setItem(cacheKey, JSON.stringify(result));
  } catch {
    // LocalStorage might be full, safe to ignore
  }

  return { ...result, ok: true };
}

/**
 * Generates an application draft tailored to a listing.
 * Combines full profile, CV text, documents, education, job description, and answer library.
 * @param {Object} params
 * @param {import('./models.js').Profile} params.profile
 * @param {import('./models.js').Listing} params.listing
 * @param {string} [params.customApiKey]
 * @returns {Promise<{ coverLetter: string, customAnswers: Record<string, string>, ok: boolean, error?: string }>}
 */
export async function generateDraftWithGroq({ profile, listing, customApiKey = null }) {
  const apiKey = customApiKey || Storage.getGroqApiKey();
  if (!apiKey) {
    return { coverLetter: '', customAnswers: {}, ok: false, error: 'Groq API key not found.' };
  }

  const cvExcerpt = profile.cv_text ? `\nApplicant CV / Resume Details:\n${profile.cv_text.slice(0, 2500)}\n` : '';
  const links = [
    profile.portfolio_url ? `Portfolio: ${profile.portfolio_url}` : '',
    profile.github_url ? `GitHub: ${profile.github_url}` : '',
    profile.linkedin_url ? `LinkedIn: ${profile.linkedin_url}` : ''
  ].filter(Boolean).join(' | ');
  const linksExcerpt = links ? `\nApplicant Verified Links: ${links}\n` : '';

  const prompt = `You are a personal application assistant drafting a concise, tailored cover letter.
Do NOT use robotic clichés, preamble, or sycophantic filler. Write in a thoughtful, humble, and competent human tone.

Applicant Profile:
Name: ${profile.name}
Email: ${profile.email}${linksExcerpt}
Skills: ${(profile.skills || []).map(s => `${s.name} (${s.level})`).join(', ')}
Education: ${(profile.education || []).map(e => `${e.degree} at ${e.institution}`).join(', ')}
${cvExcerpt}
Relevant Background Answers:
${Object.entries(profile.answer_library || {})
  .map(([k, v]) => `${k}: ${v}`)
  .join('\n')}

Opportunity:
Title: ${listing.title}
Organization: ${listing.organization}
Type: ${listing.opportunity_type}
Description Excerpt: ${(listing.raw_description || '').slice(0, 1500)}

Instructions:
1. Write a 3-paragraph tailored cover letter emphasizing why the applicant's real background and CV skills match this specific opportunity.
2. Address any specific requirements if applicable.
3. Keep it under 250 words. Focus on genuine alignment.
4. Output ONLY the letter text directly, without preamble or conversational intro.`;

  // Resolve best available model (cached probe)
  const resolvedModel = await resolveAvailableModel(apiKey);
  const modelsToTry = [resolvedModel, ...PREFERRED_MODELS.filter(m => m !== resolvedModel)];

  for (const model of modelsToTry) {
    try {
      const resp = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 2500,
          reasoning_effort: 'low'
        })
      });

      if (resp.status === 404) {
        console.warn(`Groq model "${model}" not found for draft generation, trying next.`);
        continue;
      }

      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        const errorMsg = errJson?.error?.message || `HTTP ${resp.status}: ${resp.statusText}`;
        console.error('Groq draft generation failed:', errorMsg);
        return { coverLetter: '', customAnswers: {}, ok: false, error: errorMsg };
      }

      const data = await resp.json();
      const rawLetter = data?.choices?.[0]?.message?.content || '';
      const coverLetter = cleanReasoningOutput(rawLetter);
      return { coverLetter, customAnswers: {}, ok: true };
    } catch (err) {
      console.error(`Failed to generate draft with model "${model}":`, err);
      // If this isn't the last model, try the next one
      continue;
    }
  }

  // All models exhausted
  return { coverLetter: '', customAnswers: {}, ok: false, error: 'All models failed. Check your API key or try again later.' };
}


/**
 * CV / Resume profile extraction prompt.
 * Asks the model to return structured profile data matching the Profile shape in models.js.
 */
const CV_EXTRACTION_SYSTEM_PROMPT = `You are an expert resume/CV parser. Extract structured profile information from the provided resume text.

Rules:
1. Extract the person's full name and email address if present.
2. Extract education entries: degree/program name, institution, graduation date (if stated), GPA (if stated).
3. Extract skills with proficiency levels:
   - "advanced" = 3+ years experience, lead/expert language, or listed as a core/primary skill.
   - "intermediate" = mentioned with moderate experience or listed among secondary skills.
   - "beginner" = briefly mentioned, coursework-only, or listed as "familiar with" / "exposure to".
4. For each skill, infer a short category if obvious (e.g. "programming", "design", "healthcare", "analytics", "language", "management"). Use null if unclear.
5. Extract LinkedIn URL if present in the resume.
6. Do NOT invent information not present in the text. If a field is absent, omit it or use null.

Output ONLY valid JSON with this exact shape:
{
  "name": "Full Name",
  "email": "email@example.com",
  "linkedin_url": "https://linkedin.com/in/...",
  "education": [
    { "degree": "BS Computer Science", "institution": "MIT", "graduation_date": "2024", "gpa": 3.9 }
  ],
  "skills": [
    { "name": "python", "level": "advanced", "category": "programming" }
  ]
}`;

/**
 * Extracts structured profile data from raw CV/resume text using Groq LLM.
 * Follows the same patterns as extractSkillsWithGroq:
 * - Cache-only-successful-extractions via localStorage.
 * - Strips reasoning tokens (<think> tags) before JSON parsing.
 * - Model cascade through PREFERRED_MODELS on 404.
 * - Retry with backoff on 429 rate limits.
 *
 * CV text is sent ONLY to Groq's API from the browser — zero-knowledge, no developer server.
 *
 * @param {string} cvText - Raw resume/CV text (from PDF extraction or pasted).
 * @param {string} [customApiKey] - Optional override for the stored Groq key.
 * @returns {Promise<{ profile: Partial<import('./models.js').Profile>, ok: boolean, error?: string }>}
 */
export async function extractProfileFromCV(cvText, customApiKey = null) {
  const apiKey = customApiKey || Storage.getGroqApiKey();
  if (!apiKey) {
    return { profile: {}, ok: false, error: 'No API key provided.' };
  }

  const cleanText = (cvText || '').slice(0, 6000).trim();
  if (!cleanText) {
    return { profile: {}, ok: true };
  }

  const cacheKey = `groq_cv_profile_${hashString(cleanText)}`;

  // Check local cache — only valid successful results are cached
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed.name === 'string') {
        return { profile: parsed, ok: true };
      }
    }
  } catch {
    // Cache read failed, proceed to fetch
  }

  // Resolve best available model (cached probe)
  const resolvedModel = await resolveAvailableModel(apiKey);

  let rawContent = null;
  let lastError = null;
  const modelsToTry = [resolvedModel, ...PREFERRED_MODELS.filter(m => m !== resolvedModel)];

  for (const model of modelsToTry) {
    let modelFailed = false;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const resp = await fetch(GROQ_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey.trim()}`
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: CV_EXTRACTION_SYSTEM_PROMPT },
              { role: 'user', content: `Resume / CV Text:\n\n${cleanText}` }
            ],
            temperature: 0.1,
            max_tokens: 2500,
            reasoning_effort: 'low'
          })
        });

        if (resp.status === 429) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }

        if (resp.status === 404) {
          console.warn(`Groq model "${model}" not found for CV extraction, trying next fallback.`);
          modelFailed = true;
          break;
        }

        if (!resp.ok) {
          const errJson = await resp.json().catch(() => ({}));
          throw new Error(errJson?.error?.message || `HTTP ${resp.status}`);
        }

        const data = await resp.json();
        rawContent = data?.choices?.[0]?.message?.content || '';
        break;
      } catch (err) {
        lastError = err;
        if (attempt < 1) {
          await new Promise(r => setTimeout(r, 1000));
        }
      }
    }

    if (rawContent || modelFailed) {
      if (rawContent) break;
      continue;
    }
  }

  if (!rawContent) {
    console.warn('Groq CV extraction failed (will NOT be cached):', lastError);
    return { profile: {}, ok: false, error: lastError?.message };
  }

  // Clean reasoning output (<think> tags) before parsing JSON
  const cleaned = cleanReasoningOutput(rawContent);
  let parsed = null;

  try {
    const startIdx = cleaned.indexOf('{');
    const endIdx = cleaned.lastIndexOf('}');
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      parsed = JSON.parse(cleaned.substring(startIdx, endIdx + 1));
    }
  } catch {
    // Standard parse failed
  }

  if (!parsed || typeof parsed !== 'object') {
    console.warn('Could not parse CV extraction JSON (will NOT be cached):', cleaned);
    return { profile: {}, ok: false, error: 'Could not parse profile JSON from CV.' };
  }

  // Normalize into the Profile shape
  const normalizeSkill = (s) => {
    if (!s || !s.name) return null;
    const validLevels = ['beginner', 'intermediate', 'advanced'];
    return {
      name: String(s.name).toLowerCase().trim(),
      level: validLevels.includes(s.level) ? s.level : 'intermediate',
      category: s.category ? String(s.category).toLowerCase().trim() : null
    };
  };

  const normalizeEducation = (e) => {
    if (!e || (!e.degree && !e.institution)) return null;
    return {
      degree: (e.degree || '').trim(),
      institution: (e.institution || '').trim(),
      graduation_date: e.graduation_date || null,
      gpa: e.gpa !== null && e.gpa !== undefined ? Number(e.gpa) : null,
      gpa_scale: 4.0
    };
  };

  const result = {
    name: (parsed.name || '').trim(),
    email: (parsed.email || '').trim(),
    linkedin_url: (parsed.linkedin_url || '').trim(),
    skills: Array.isArray(parsed.skills)
      ? parsed.skills.map(normalizeSkill).filter(Boolean)
      : [],
    education: Array.isArray(parsed.education)
      ? parsed.education.map(normalizeEducation).filter(Boolean)
      : []
  };

  // Cache ONLY valid successful results
  try {
    localStorage.setItem(cacheKey, JSON.stringify(result));
  } catch {
    // LocalStorage might be full, safe to ignore
  }

  return { profile: result, ok: true };
}
