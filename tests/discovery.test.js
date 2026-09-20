import { describe, it, expect } from 'vitest';
import { stripHtml, calculateDeadlineUrgency, parseSalaryCompensation, fetchScholarshipsAndFellowships } from '../src/js/discovery.js';
import { cleanReasoningOutput } from '../src/js/groq.js';
import { isDuplicate, deduplicateListings, normalizeString } from '../src/js/dedupe.js';
import { createListing, createRequirement, OpportunityType, LocationMode } from '../src/js/models.js';
import { TEST_FIXTURES } from './fixtures/sample_opportunities.js';

describe('Discovery & Deduplication Engine', () => {
  it('strips HTML and entities cleanly from job descriptions', () => {
    const raw = '<p>We are seeking a <strong>Software Engineer</strong> &amp; Researcher.&nbsp;Apply now!</p>';
    expect(stripHtml(raw)).toBe('We are seeking a Software Engineer & Researcher. Apply now!');
  });

  it('calculates deadline urgency accurately', () => {
    const refDate = new Date('2026-09-17T12:00:00Z');

    // 3 days left -> Urgent
    const urgent3 = calculateDeadlineUrgency('2026-09-20', refDate);
    expect(urgent3.hasDeadline).toBe(true);
    expect(urgent3.isUrgent).toBe(true);
    expect(urgent3.daysRemaining).toBe(3);
    expect(urgent3.label).toBe('Urgent • 3 days left');

    // Ends today -> Urgent
    const todayUrgent = calculateDeadlineUrgency('2026-09-17', refDate);
    expect(todayUrgent.isUrgent).toBe(true);
    expect(todayUrgent.label).toBe('Urgent • Ends Today');

    // 20 days left -> Not urgent
    const normal = calculateDeadlineUrgency('2026-10-07', refDate);
    expect(normal.hasDeadline).toBe(true);
    expect(normal.isUrgent).toBe(false);
    expect(normal.daysRemaining).toBe(20);

    // Expired
    const expired = calculateDeadlineUrgency('2026-09-10', refDate);
    expect(expired.isExpired).toBe(true);
    expect(expired.isUrgent).toBe(false);

    // Missing deadline
    const empty = calculateDeadlineUrgency(null);
    expect(empty.hasDeadline).toBe(false);
    expect(empty.isUrgent).toBe(false);
  });

  it('parses salary and compensation strings accurately', () => {
    expect(parseSalaryCompensation('$84k - $100k')).toBe(7000); // 84000 / 12 = 7000
    expect(parseSalaryCompensation('$3,500/month')).toBe(3500);
    expect(parseSalaryCompensation('$60,000/year')).toBe(5000);
    expect(parseSalaryCompensation(null)).toBe(null);
  });

  it('cleans reasoning <think> tags from openai/gpt-oss-20b output', () => {
    const withThoughts = '<think>I need to extract required skills. The listing mentions Python.</think>```json\n{"required": ["python"], "preferred": []}\n```';
    const cleaned = cleanReasoningOutput(withThoughts);
    expect(cleaned).toBe('{"required": ["python"], "preferred": []}');
    expect(cleaned).not.toContain('<think>');
    expect(cleaned).not.toContain('</think>');
  });

  it('provides scholarships and fellowships with verified metadata', () => {
    const items = fetchScholarshipsAndFellowships();
    expect(items.length).toBeGreaterThanOrEqual(4);
    const hasUrgent = items.some(it => {
      const u = calculateDeadlineUrgency(it.deadline, new Date('2026-09-17'));
      return u.isUrgent;
    });
    expect(hasUrgent).toBe(true);
  });

  it('normalizes organization names and titles for fuzzy comparison', () => {
    expect(normalizeString('Google LLC')).toBe('google');
    expect(normalizeString('OpenAI Technologies Inc.')).toBe('openai');
    expect(normalizeString('Mercor Labs')).toBe('mercor');
  });

  it('identifies duplicates sharing the same source URL', () => {
    const a = createListing({
      title: 'AI Fellow',
      organization: 'Org A',
      source_urls: ['https://example.com/jobs/123']
    });
    const b = createListing({
      title: 'Different Title',
      organization: 'Org B',
      source_urls: ['https://example.com/jobs/123/']
    });
    expect(isDuplicate(a, b)).toBe(true);
  });

  it('identifies duplicates with fuzzy title and organization', () => {
    const a = createListing({
      title: 'Senior Python Developer',
      organization: 'Acme Corp Inc.',
      source_urls: ['https://acme.com/job-a']
    });
    const b = createListing({
      title: 'Senior Python Developer',
      organization: 'Acme Corp',
      source_urls: ['https://otherboard.com/acme-job']
    });
    expect(isDuplicate(a, b)).toBe(true);
  });

  it('merges duplicate listings into a canonical record preserving unique requirements', () => {
    const a = createListing({
      title: 'AI Research Fellow',
      organization: 'Lab',
      requirements: [createRequirement('Python')],
      source_urls: ['https://board1.com/1']
    });
    const b = createListing({
      title: 'AI Research Fellow',
      organization: 'Lab',
      requirements: [createRequirement('LangGraph')],
      source_urls: ['https://board2.com/2']
    });

    const deduped = deduplicateListings([a, b]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].source_urls).toHaveLength(2);
    expect(deduped[0].requirements).toHaveLength(2);
    expect(deduped[0].requirements.map(r => r.skill)).toContain('Python');
    expect(deduped[0].requirements.map(r => r.skill)).toContain('LangGraph');
  });

  it('verifies offline test fixtures cover non-tech domains and key opportunity types', () => {
    const types = TEST_FIXTURES.map(o => o.opportunity_type);
    expect(types).toContain(OpportunityType.FELLOWSHIP);
    expect(types).toContain(OpportunityType.GRANT);
    expect(types).toContain(OpportunityType.HACKATHON);
    expect(types).toContain(OpportunityType.SCHOLARSHIP);
    expect(types).toContain(OpportunityType.RESEARCH);

    // Verify non-tech domains exist in fixtures
    const titles = TEST_FIXTURES.map(o => o.title.toLowerCase());
    expect(titles.some(t => t.includes('clinical') || t.includes('pediatric'))).toBe(true);
    expect(titles.some(t => t.includes('design'))).toBe(true);
  });
});

