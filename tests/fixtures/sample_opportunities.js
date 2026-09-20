/**
 * @file tests/fixtures/sample_opportunities.js
 * Offline test fixtures for automated testing and sandbox demonstration ONLY.
 * NEVER mixed into live user discovery feeds.
 */

import {
  createListing,
  createRequirement,
  OpportunityType,
  RequirementImportance,
  LocationMode
} from '../../src/js/models.js';

export const TEST_FIXTURES = [
  // 1. AI Fellowship fixture
  createListing({
    id: 'fixture_ai_fellowship_01',
    title: '[DEMO FIXTURE] Applied AI Research Fellowship',
    organization: 'Open Research Collective (Demo)',
    opportunity_type: OpportunityType.FELLOWSHIP,
    requirements: [
      createRequirement('Python', RequirementImportance.REQUIRED),
      createRequirement('LangGraph', RequirementImportance.REQUIRED),
      createRequirement('RAG', RequirementImportance.PREFERRED),
      createRequirement('FastAPI', RequirementImportance.PREFERRED)
    ],
    location_mode: LocationMode.REMOTE,
    is_funded: true,
    compensation: 1200,
    unpaid: false,
    deadline: '2026-11-30',
    source_urls: ['https://fellowship.mlh.io/'],
    raw_description: 'Offline test fixture for validating LangGraph and RAG agent matching.',
    unusual_requirements: ['research statement', 'github repository with reproducible demo']
  }),

  // 2. Healthcare / Nursing Fellowship fixture
  createListing({
    id: 'fixture_nurse_fellowship_02',
    title: '[DEMO FIXTURE] Pediatric Clinical Care Fellowship',
    organization: 'Childrens Health International (Demo)',
    opportunity_type: OpportunityType.FELLOWSHIP,
    requirements: [
      createRequirement('Patient Triage', RequirementImportance.REQUIRED),
      createRequirement('Electronic Health Records', RequirementImportance.PREFERRED),
      createRequirement('Pediatric Nursing', RequirementImportance.REQUIRED)
    ],
    location_mode: LocationMode.ONSITE,
    countries: ['Canada'],
    is_funded: true,
    compensation: 4200,
    unpaid: false,
    deadline: '2026-10-15',
    source_urls: ['https://www.daad.de/en/study-and-research-in-germany/scholarships/'],
    raw_description: 'Offline test fixture for validating healthcare/clinical triage profile matching.',
    unusual_requirements: ['provincial nursing license proof', 'two professional clinical references']
  }),

  // 3. Creative / UI Design fixture
  createListing({
    id: 'fixture_design_residency_03',
    title: '[DEMO FIXTURE] Digital Experience Design Residency',
    organization: 'Civic Media Lab (Demo)',
    opportunity_type: OpportunityType.GRANT,
    requirements: [
      createRequirement('UI Design', RequirementImportance.REQUIRED),
      createRequirement('Figma', RequirementImportance.REQUIRED),
      createRequirement('Design Systems', RequirementImportance.PREFERRED)
    ],
    location_mode: LocationMode.REMOTE,
    is_funded: true,
    compensation: 2500,
    unpaid: false,
    deadline: '2026-12-01',
    source_urls: ['https://foundation.mozilla.org/en/what-we-fund/awards/'],
    raw_description: 'Offline test fixture for validating creative design system matching.',
    unusual_requirements: ['portfolio link with 3 case studies']
  }),

  // 4. Global Hackathon fixture
  createListing({
    id: 'fixture_hackathon_04',
    title: '[DEMO FIXTURE] Open Climate Resilience Hackathon',
    organization: 'Earth Tech Accelerator (Demo)',
    opportunity_type: OpportunityType.HACKATHON,
    requirements: [
      createRequirement('Python', RequirementImportance.PREFERRED),
      createRequirement('Data Analysis', RequirementImportance.PREFERRED)
    ],
    location_mode: LocationMode.REMOTE,
    is_funded: true,
    compensation: 5000,
    unpaid: false,
    deadline: '2026-10-25',
    source_urls: ['https://summerofcode.withgoogle.com/'],
    raw_description: 'Offline test fixture for testing hackathon prize matching.',
    unusual_requirements: ['team roster (1-4 members)']
  }),

  // 5. Postgraduate Scholarship fixture with Application Fee
  createListing({
    id: 'fixture_scholarship_fee_05',
    title: '[DEMO FIXTURE] International Leadership Scholarship',
    organization: 'Global Scholars Guild (Demo)',
    opportunity_type: OpportunityType.SCHOLARSHIP,
    requirements: [
      createRequirement('Academic Writing', RequirementImportance.REQUIRED),
      createRequirement('Leadership Experience', RequirementImportance.PREFERRED)
    ],
    location_mode: LocationMode.REMOTE,
    is_funded: true,
    compensation: 3000,
    application_fee: 35,
    deadline: '2026-11-15',
    source_urls: ['https://foreign.fulbrightonline.org/'],
    raw_description: 'Offline test fixture for validating application fee trust signals.',
    unusual_requirements: ['academic transcript', 'nomination letter from faculty head']
  }),

  // 6. Explicitly Unpaid Volunteer Research Assistantship fixture
  createListing({
    id: 'fixture_unpaid_research_06',
    title: '[DEMO FIXTURE] Junior Research Contributor (Bioinformatics)',
    organization: 'Community Genomics Project (Demo)',
    opportunity_type: OpportunityType.RESEARCH,
    requirements: [
      createRequirement('Python', RequirementImportance.REQUIRED),
      createRequirement('Genomics', RequirementImportance.PREFERRED)
    ],
    location_mode: LocationMode.REMOTE,
    is_funded: false,
    unpaid: true,
    compensation: null,
    deadline: '2026-12-31',
    source_urls: ['https://github.com/readme/featured-projects'],
    raw_description: 'Offline test fixture for validating unpaid welcoming scoring rules.',
    unusual_requirements: []
  })
];
