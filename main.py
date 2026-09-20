"""
End-to-end demo: fetch real Remotive jobs → match against a profile → print.

Run from the opo folder:
    python -m main
"""

from __future__ import annotations

from core.models import (
    Profile,
    Skill,
    SkillLevel,
    Education,
    Preferences,
    OpportunityType,
)
from core.matching import match, passes_threshold
from discovery.remotive import RemotiveAdapter


def build_profile() -> Profile:
    return Profile(
        name="Adina",
        email="adina@example.com",
        skills=[
            Skill("Python", SkillLevel.ADVANCED),
            Skill("LangGraph", SkillLevel.ADVANCED),
            Skill("RAG", SkillLevel.INTERMEDIATE),
            Skill("FastAPI", SkillLevel.INTERMEDIATE),
            Skill("LLM", SkillLevel.INTERMEDIATE),
        ],
        education=[
            Education(
                degree="BS Artificial Intelligence",
                institution="Example University",
                gpa=3.84,
                gpa_scale=4.0,
            )
        ],
        preferences=Preferences(
            opportunity_types=[
                OpportunityType.JOB,
                OpportunityType.INTERNSHIP,
                OpportunityType.FELLOWSHIP,
                OpportunityType.RESEARCH,
            ],
            remote_ok=True,
            relocate_ok=False,
            countries=["Pakistan", "Worldwide", "Remote"],
            min_compensation=None,
            requires_funded=False,
            min_match_score=0.55,
            excluded_keywords=["unpaid sales"],
        ),
    )


def main():
    profile = build_profile()

    print(f"Profile: {profile.name}")
    print("Fetching live listings from Remotive...\n")

    adapter = RemotiveAdapter(search="python", limit=15, debug=True)
    listings = adapter.fetch()
    print(f"\nFetched {len(listings)} listings from {adapter.name}\n")

    scored = []
    for listing in listings:
        result = match(profile, listing)
        scored.append((result, listing))

    scored.sort(key=lambda pair: pair[0].score, reverse=True)

    print("=" * 70)
    print("ALL MATCHES (sorted by score)")
    print("=" * 70)

    for result, listing in scored:
        reqs = [
            r.skill for r in listing.requirements if r.importance.value == "required"
        ]
        prefs = [
            r.skill for r in listing.requirements if r.importance.value == "preferred"
        ]
        status = "PASS" if passes_threshold(profile, result) else "FAIL"

        print(f"\n[{result.score:.2f}] ({status}) {listing.title}")
        print(f"        @ {listing.organization}")
        print(f"        required: {reqs}")
        print(f"        preferred: {prefs}")
        if listing.source_urls:
            print(f"        {listing.source_urls[0]}")
        for reason in result.reasons[:6]:
            print(f"        · {reason}")
        for flag in result.flags:
            print(f"        ⚠ {flag}")


if __name__ == "__main__":
    main()
