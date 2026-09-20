"""
Sanity check for the match scoring logic against hand-written listings,
including a few adversarial ones (missing data, ambiguous location,
excluded keyword) to confirm the engine flags rather than guesses.

Run: python3 test_matching.py
"""

from __future__ import annotations

from datetime import date

from core.models import (
    Education,
    Listing,
    LocationMode,
    OpportunityType,
    Preferences,
    Profile,
    Requirement,
    RequirementImportance,
    Skill,
    SkillLevel,
)
from core.matching import match, passes_threshold


def build_profile() -> Profile:
    return Profile(
        name="Adina",
        email="adina@example.com",
        skills=[
            Skill("Python", SkillLevel.ADVANCED, "programming"),
            Skill("LangGraph", SkillLevel.ADVANCED, "ml"),
            Skill("RAG", SkillLevel.INTERMEDIATE, "ml"),
            Skill("FastAPI", SkillLevel.INTERMEDIATE, "programming"),
        ],
        education=[
            Education("BS Artificial Intelligence", "FAST-NUCES", date(2027, 6, 1), gpa=3.84)
        ],
        preferences=Preferences(
            opportunity_types=[
                OpportunityType.INTERNSHIP,
                OpportunityType.FELLOWSHIP,
                OpportunityType.RESEARCH,
            ],
            remote_ok=True,
            relocate_ok=False,
            countries=["Pakistan"],
            requires_funded=False,
            min_compensation=200,
            min_match_score=0.70,
            excluded_keywords=["unpaid sales", "commission-only"],
        ),
    )


LISTINGS = [
    # 1. Clean strong match
    Listing(
        title="AI Research Intern",
        organization="XYZ Lab",
        opportunity_type=OpportunityType.INTERNSHIP,
        requirements=[
            Requirement("Python", RequirementImportance.REQUIRED),
            Requirement("RAG", RequirementImportance.PREFERRED),
        ],
        location_mode=LocationMode.REMOTE,
        is_funded=True,
        compensation=800,
    ),
    # 2. Missing a required skill entirely -> hard reject
    Listing(
        title="Computer Vision Fellowship",
        organization="Vision Co",
        opportunity_type=OpportunityType.FELLOWSHIP,
        requirements=[
            Requirement("PyTorch", RequirementImportance.REQUIRED),
            Requirement("OpenCV", RequirementImportance.REQUIRED),
        ],
        location_mode=LocationMode.REMOTE,
        is_funded=True,
    ),
    # 3. Excluded keyword -> hard reject regardless of skills
    Listing(
        title="Unpaid Sales Internship",
        organization="Growth Corp",
        opportunity_type=OpportunityType.INTERNSHIP,
        requirements=[Requirement("Python", RequirementImportance.PREFERRED)],
        location_mode=LocationMode.REMOTE,
        raw_description="This is an unpaid sales role, commission-only after month 3.",
    ),
    # 4. Onsite outside accepted countries, no relocation
    Listing(
        title="ML Engineer",
        organization="Berlin AI",
        opportunity_type=OpportunityType.JOB,
        requirements=[Requirement("Python", RequirementImportance.REQUIRED)],
        location_mode=LocationMode.ONSITE,
        countries=["Germany"],
    ),
    # 5. Ambiguous location (should flag, not guess)
    Listing(
        title="Data Science Fellowship",
        organization="Ambiguous Org",
        opportunity_type=OpportunityType.FELLOWSHIP,
        requirements=[Requirement("Python", RequirementImportance.REQUIRED)],
        location_mode=LocationMode.UNKNOWN,
    ),
    # 6. No requirements listed at all
    Listing(
        title="Open Call: AI Fellows Program",
        organization="Mercor",
        opportunity_type=OpportunityType.FELLOWSHIP,
        requirements=[],
        location_mode=LocationMode.REMOTE,
        is_funded=True,
    ),
    # 7. Below stated compensation minimum
    Listing(
        title="Underpaid AI Internship",
        organization="Cheap Startup",
        opportunity_type=OpportunityType.INTERNSHIP,
        requirements=[Requirement("Python", RequirementImportance.REQUIRED)],
        location_mode=LocationMode.REMOTE,
        compensation=50,
    ),
    # 8. Wrong opportunity type but great skills fit
    Listing(
        title="Senior ML Engineer (Full-time)",
        organization="BigTech",
        opportunity_type=OpportunityType.JOB,
        requirements=[
            Requirement("Python", RequirementImportance.REQUIRED),
            Requirement("LangGraph", RequirementImportance.PREFERRED),
        ],
        location_mode=LocationMode.REMOTE,
        compensation=5000,
    ),
    # 9. Has an unusual requirement the profile can't answer
    Listing(
        title="Global Leaders Fellowship",
        organization="Foundation X",
        opportunity_type=OpportunityType.FELLOWSHIP,
        requirements=[Requirement("Python", RequirementImportance.PREFERRED)],
        location_mode=LocationMode.REMOTE,
        is_funded=True,
        unusual_requirements=["nomination letter from a professor"],
    ),
    # 10. Strong all-around match with preferred skills too
    Listing(
        title="Applied AI Fellowship",
        organization="Open Research Collective",
        opportunity_type=OpportunityType.FELLOWSHIP,
        requirements=[
            Requirement("Python", RequirementImportance.REQUIRED),
            Requirement("LangGraph", RequirementImportance.REQUIRED),
            Requirement("FastAPI", RequirementImportance.PREFERRED),
        ],
        location_mode=LocationMode.REMOTE,
        is_funded=True,
        compensation=1200,
    ),
    # 11. Otherwise great fit, but asks the applicant to pay a fee
    Listing(
        title="\"Elite\" AI Fellows Circle",
        organization="Suspicious Foundation",
        opportunity_type=OpportunityType.FELLOWSHIP,
        requirements=[
            Requirement("Python", RequirementImportance.REQUIRED),
        ],
        location_mode=LocationMode.REMOTE,
        is_funded=True,
        compensation=1000,
        application_fee=45,
    ),
]


def run():
    profile = build_profile()
    print(f"Profile: {profile.name} | min match threshold: {profile.preferences.min_match_score}\n")

    for listing in LISTINGS:
        result = match(profile, listing)
        shown = passes_threshold(profile, result)
        status = "HARD REJECT" if result.hard_rejected else ("SHOW" if shown else "BELOW THRESHOLD")

        print(f"[{status}] {listing.title} ({listing.organization}) — score: {result.score}")
        if result.hard_reject_reason:
            print(f"  reason: {result.hard_reject_reason}")
        for r in result.reasons:
            print(f"  {r}")
        for f in result.flags:
            print(f"  \u26a0 FLAG: {f}")
        print()


if __name__ == "__main__":
    run()