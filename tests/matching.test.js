/**
 * @file matching.test.js
 * Automated test suite for opo Match Scoring Engine using Vitest.
 * Asserts all 7 canonical rules and adversarial edge cases fail loudly if broken.
 */

import { describe, it, expect } from 'vitest';
import { match, passesThreshold } from '../src/js/matching.js';
import {
  createProfile,
  createSkill,
  createPreferences,
  createListing,
  createRequirement,
  SkillLevel,
  OpportunityType,
  RequirementImportance,
  LocationMode
} from '../src/js/models.js';

function getBaselineProfile() {
  return createProfile(
    'Adina',
    'adina@example.com',
    [
      createSkill('Python', SkillLevel.ADVANCED, 'programming'),
      createSkill('LangGraph', SkillLevel.ADVANCED, 'ml'),
      createSkill('RAG', SkillLevel.INTERMEDIATE, 'ml'),
      createSkill('FastAPI', SkillLevel.INTERMEDIATE, 'programming')
    ],
    [],
    createPreferences({
      opportunity_types: [
        OpportunityType.INTERNSHIP,
        OpportunityType.FELLOWSHIP,
        OpportunityType.RESEARCH
      ],
      remote_ok: true,
      relocate_ok: false,
      countries: ['Pakistan'],
      requires_funded: false,
      min_compensation: 200,
      min_match_score: 0.70,
      excluded_keywords: ['unpaid sales', 'commission-only']
    })
  );
}

describe('opo Match Scoring Engine', () => {
  // Test 1: Clean strong match
  it('correctly scores a clean strong match above threshold', () => {
    const profile = getBaselineProfile();
    const listing = createListing({
      title: 'AI Research Fellow',
      organization: 'XYZ Lab',
      opportunity_type: OpportunityType.FELLOWSHIP,
      requirements: [
        createRequirement('Python', RequirementImportance.REQUIRED),
        createRequirement('RAG', RequirementImportance.PREFERRED)
      ],
      location_mode: LocationMode.REMOTE,
      is_funded: true,
      compensation: 800
    });

    const result = match(profile, listing);
    expect(result.hard_rejected).toBe(false);
    expect(result.score).toBeGreaterThanOrEqual(0.85);
    expect(passesThreshold(profile, result)).toBe(true);
    expect(result.reasons).toContain('✓ Python (required)');
    expect(result.reasons).toContain('✓ RAG (preferred)');
    expect(result.reasons).toContain('✓ Remote, matches your preference');
    expect(result.payment_required).toBe(false);
  });

  // Test 2: Missing ALL required skills -> Hard reject
  it('hard rejects when profile misses ALL required skills', () => {
    const profile = getBaselineProfile();
    const listing = createListing({
      title: 'Computer Vision Fellowship',
      organization: 'Vision Co',
      opportunity_type: OpportunityType.FELLOWSHIP,
      requirements: [
        createRequirement('PyTorch', RequirementImportance.REQUIRED),
        createRequirement('OpenCV', RequirementImportance.REQUIRED)
      ],
      location_mode: LocationMode.REMOTE,
      is_funded: true
    });

    const result = match(profile, listing);
    expect(result.hard_rejected).toBe(true);
    expect(result.score).toBe(0.0);
    expect(result.hard_reject_reason).toMatch(/Missing all required skills/i);
    expect(passesThreshold(profile, result)).toBe(false);
  });

  // Test 3: Partial required skill match is scored, NOT rejected
  it('scores partial required skill matches without hard rejection', () => {
    const profile = getBaselineProfile();
    const listing = createListing({
      title: 'Applied AI Fellowship',
      organization: 'AI Institute',
      opportunity_type: OpportunityType.FELLOWSHIP,
      requirements: [
        createRequirement('Python', RequirementImportance.REQUIRED),
        createRequirement('Rust', RequirementImportance.REQUIRED) // not in profile
      ],
      location_mode: LocationMode.REMOTE,
      compensation: 500
    });

    const result = match(profile, listing);
    expect(result.hard_rejected).toBe(false);
    expect(result.score).toBeGreaterThan(0.0);
    expect(result.reasons).toContain('✓ Python (required)');
    expect(result.reasons).toContain('✗ Rust (required)');
  });

  // Test 4: Excluded keyword in title or description -> Hard reject
  it('hard rejects when listing contains an excluded keyword in title or description', () => {
    const profile = getBaselineProfile();

    const listingTitleMatch = createListing({
      title: 'Unpaid Sales Internship',
      organization: 'Growth Corp',
      opportunity_type: OpportunityType.INTERNSHIP,
      requirements: [createRequirement('Python', RequirementImportance.PREFERRED)]
    });

    const result1 = match(profile, listingTitleMatch);
    expect(result1.hard_rejected).toBe(true);
    expect(result1.score).toBe(0.0);
    expect(result1.hard_reject_reason).toContain('unpaid sales');

    const listingDescMatch = createListing({
      title: 'Junior Representative',
      organization: 'Growth Corp',
      raw_description: 'This is a commission-only opportunity after month 2.',
      requirements: [createRequirement('Python', RequirementImportance.PREFERRED)]
    });

    const result2 = match(profile, listingDescMatch);
    expect(result2.hard_rejected).toBe(true);
    expect(result2.score).toBe(0.0);
    expect(result2.hard_reject_reason).toContain('commission-only');
  });

  // Test 5: Opportunity type NEVER reduces the score (Rule 3)
  it('ensures opportunity type is informational only and never reduces score', () => {
    const profile = getBaselineProfile();
    // Preferred types: INTERNSHIP, FELLOWSHIP, RESEARCH.
    // JOB is NOT in preferred types.

    const fellowshipListing = createListing({
      title: 'AI Engineer',
      organization: 'Org',
      opportunity_type: OpportunityType.FELLOWSHIP,
      requirements: [createRequirement('Python', RequirementImportance.REQUIRED)],
      location_mode: LocationMode.REMOTE,
      compensation: 1000
    });

    const jobListing = createListing({
      title: 'AI Engineer',
      organization: 'Org',
      opportunity_type: OpportunityType.JOB, // outside preferred types
      requirements: [createRequirement('Python', RequirementImportance.REQUIRED)],
      location_mode: LocationMode.REMOTE,
      compensation: 1000
    });

    const fellowshipResult = match(profile, fellowshipListing);
    const jobResult = match(profile, jobListing);

    // Rule 3: The scores must be identical
    expect(jobResult.score).toBe(fellowshipResult.score);
    // Info reason must be present
    expect(jobResult.reasons.some(r => r.includes('Outside your usual opportunity types'))).toBe(true);
  });

  // Test 6: Unpaid opportunities are welcomed, not penalized (Rule 4)
  it('welcomes explicitly unpaid opportunities without penalty if min_compensation is null', () => {
    const profile = getBaselineProfile();
    profile.preferences.min_compensation = null; // unpaid fully acceptable

    const unpaidListing = createListing({
      title: 'Open Source AI Contributor',
      organization: 'Open Foundation',
      opportunity_type: OpportunityType.FELLOWSHIP,
      requirements: [createRequirement('Python', RequirementImportance.REQUIRED)],
      location_mode: LocationMode.REMOTE,
      unpaid: true
    });

    const result = match(profile, unpaidListing);
    expect(result.hard_rejected).toBe(false);
    expect(result.score).toBeGreaterThanOrEqual(0.8);
    expect(result.reasons).toContain('Unpaid opportunity (welcomed by default)');
  });

  // Test 7: Below stated compensation minimum is penalized
  it('penalizes when compensation is below user stated minimum', () => {
    const profile = getBaselineProfile();
    profile.preferences.min_compensation = 200;

    const wellPaidListing = createListing({
      title: 'AI Role',
      organization: 'Lab',
      opportunity_type: OpportunityType.INTERNSHIP,
      requirements: [createRequirement('Python', RequirementImportance.REQUIRED)],
      location_mode: LocationMode.REMOTE,
      compensation: 800
    });

    const underpaidListing = createListing({
      title: 'Underpaid AI Role',
      organization: 'Cheap Lab',
      opportunity_type: OpportunityType.INTERNSHIP,
      requirements: [createRequirement('Python', RequirementImportance.REQUIRED)],
      location_mode: LocationMode.REMOTE,
      compensation: 50 // below 200
    });

    const wellPaidResult = match(profile, wellPaidListing);
    const underpaidResult = match(profile, underpaidListing);

    expect(underpaidResult.score).toBeLessThan(wellPaidResult.score);
    expect(underpaidResult.reasons.some(r => r.includes('below your minimum'))).toBe(true);
    expect(underpaidResult.flags.some(f => f.includes('below your minimum'))).toBe(true);
  });

  // Test 8: Unknown location mode is flagged, not guessed (Rule 5)
  it('flags unknown location mode rather than guessing', () => {
    const profile = getBaselineProfile();
    const listing = createListing({
      title: 'Data Fellow',
      organization: 'Global AI',
      opportunity_type: OpportunityType.FELLOWSHIP,
      requirements: [createRequirement('Python', RequirementImportance.REQUIRED)],
      location_mode: LocationMode.UNKNOWN
    });

    const result = match(profile, listing);
    expect(result.flags).toContain('Location mode not specified by listing — confirm before applying');
  });

  // Test 9: Onsite outside accepted countries with no relocation (Rule 5)
  it('softly flags onsite abroad when relocation is false without hard rejecting good skills', () => {
    const profile = getBaselineProfile();
    profile.preferences.relocate_ok = false;
    profile.preferences.countries = ['Pakistan'];

    const onsiteListing = createListing({
      title: 'Berlin ML Fellow',
      organization: 'Berlin AI',
      opportunity_type: OpportunityType.FELLOWSHIP,
      requirements: [createRequirement('Python', RequirementImportance.REQUIRED)],
      location_mode: LocationMode.ONSITE,
      countries: ['Germany'],
      compensation: 1200
    });

    const result = match(profile, onsiteListing);
    // Soft penalty, but NOT a hard reject
    expect(result.hard_rejected).toBe(false);
    expect(result.flags.some(f => f.includes('check relocation requirements'))).toBe(true);
    expect(result.reasons.some(r => r.includes('outside your accepted countries'))).toBe(true);
  });

  // Test 10: Application fee is a trust signal with 0.6x discount (Rule 6)
  it('applies a ~0.6x discount and prominent trust flag for application fees', () => {
    const profile = getBaselineProfile();

    const standardListing = createListing({
      title: 'Fellowship A',
      organization: 'Foundation',
      opportunity_type: OpportunityType.FELLOWSHIP,
      requirements: [createRequirement('Python', RequirementImportance.REQUIRED)],
      location_mode: LocationMode.REMOTE,
      compensation: 1000
    });

    const feeListing = createListing({
      title: 'Fellowship B',
      organization: 'Suspicious Foundation',
      opportunity_type: OpportunityType.FELLOWSHIP,
      requirements: [createRequirement('Python', RequirementImportance.REQUIRED)],
      location_mode: LocationMode.REMOTE,
      compensation: 1000,
      application_fee: 45 // requires fee
    });

    const standardResult = match(profile, standardListing);
    const feeResult = match(profile, feeListing);

    expect(feeResult.payment_required).toBe(true);
    expect(feeResult.flags.some(f => f.includes('Requires an application fee ($45)'))).toBe(true);
    // Score must be approximately 0.6 of standard
    expect(feeResult.score).toBeCloseTo(standardResult.score * 0.6, 2);
  });

  // Test 11: Unusual requirements surfaced as flags (Rule 7)
  it('surfaces unusual requirements as flags needing user input', () => {
    const profile = getBaselineProfile();
    const listing = createListing({
      title: 'Global Leaders Fellowship',
      organization: 'Global Org',
      opportunity_type: OpportunityType.FELLOWSHIP,
      requirements: [createRequirement('Python', RequirementImportance.REQUIRED)],
      location_mode: LocationMode.REMOTE,
      unusual_requirements: ['nomination letter from a professor', 'video introduction']
    });

    const result = match(profile, listing);
    expect(result.flags.some(f => f.includes('Requires: nomination letter from a professor, video introduction'))).toBe(true);
  });

  // Test 12: Cross-industry matching works generically (Nursing Profile)
  it('matches cross-industry non-tech profiles (e.g. Registered Nurse) without bias', () => {
    const nurseProfile = createProfile(
      'Sarah',
      'sarah@example.com',
      [
        createSkill('Patient Triage', SkillLevel.ADVANCED, 'clinical'),
        createSkill('Electronic Health Records', SkillLevel.INTERMEDIATE, 'clinical'),
        createSkill('Phlebotomy', SkillLevel.INTERMEDIATE, 'clinical')
      ],
      [],
      createPreferences({
        opportunity_types: [OpportunityType.FELLOWSHIP, OpportunityType.JOB],
        remote_ok: false,
        relocate_ok: true,
        countries: ['Canada'],
        min_match_score: 0.70
      })
    );

    const nurseListing = createListing({
      title: 'Pediatric Clinical Fellowship',
      organization: 'Childrens Hospital Toronto',
      opportunity_type: OpportunityType.FELLOWSHIP,
      requirements: [
        createRequirement('Patient Triage', RequirementImportance.REQUIRED),
        createRequirement('Electronic Health Records', RequirementImportance.PREFERRED)
      ],
      location_mode: LocationMode.ONSITE,
      countries: ['Canada'],
      compensation: 4000
    });

    const result = match(nurseProfile, nurseListing);
    expect(result.hard_rejected).toBe(false);
    expect(result.score).toBeGreaterThanOrEqual(0.85);
    expect(passesThreshold(nurseProfile, result)).toBe(true);
    expect(result.reasons).toContain('✓ Patient Triage (required)');
    expect(result.reasons).toContain('✓ Electronic Health Records (preferred)');
  });

  // Test 13: Empty requirements on listing does not crash, scores low signal
  it('handles listings with no detected requirements safely with low signal reason', () => {
    const profile = getBaselineProfile();
    const emptyListing = createListing({
      title: 'Open Call AI Fellow',
      organization: 'Mercor',
      opportunity_type: OpportunityType.FELLOWSHIP,
      requirements: [],
      location_mode: LocationMode.REMOTE
    });

    const result = match(profile, emptyListing);
    expect(result.hard_rejected).toBe(false);
    expect(result.reasons).toContain('No skill requirements detected — low signal');
  });

  // Test 14: Skill alias matching (e.g. FastAPI / fastapi, postgres / postgresql)
  it('matches skills case-insensitively with punctuation and token tolerance', () => {
    const profile = createProfile(
      'Alex',
      'alex@example.com',
      [createSkill('PostgreSQL', SkillLevel.INTERMEDIATE), createSkill('Node.js', SkillLevel.ADVANCED)],
      [],
      createPreferences()
    );

    const listing = createListing({
      title: 'Backend Fellow',
      organization: 'Dev Org',
      requirements: [
        createRequirement('postgres', RequirementImportance.REQUIRED),
        createRequirement('node', RequirementImportance.PREFERRED)
      ],
      location_mode: LocationMode.REMOTE
    });

    const result = match(profile, listing);
    expect(result.hard_rejected).toBe(false);
    expect(result.reasons).toContain('✓ postgres (required)');
    expect(result.reasons).toContain('✓ node (preferred)');
  });
});
