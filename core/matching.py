"""
Match scoring: given one Profile and one Listing, produce a score (0-1),
a plain-language list of reasons (for the "why am I seeing this" feature),
and a list of flags for anything the engine isn't confident about and
should surface to the user rather than silently deciding.

Design principle: never let a missing/ambiguous field silently pass or
silently fail. If we don't know, it becomes a flag, not a guess.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from core.models import (
    Listing,
    LocationMode,
    Profile,
    RequirementImportance,
)

WEIGHTS = {
    "skills": 0.55,
    "type": 0.15,
    "location": 0.15,
    "compensation": 0.15,
}


@dataclass
class MatchResult:
    score: float
    reasons: list[str] = field(default_factory=list)
    flags: list[str] = field(default_factory=list)
    hard_rejected: bool = False
    hard_reject_reason: str | None = None
    payment_required: bool = False


def _score_skills(
    profile: Profile, listing: Listing
) -> tuple[float, list[str], bool, str | None]:
    reasons: list[str] = []
    profile_skills = profile.skill_names()

    if not listing.requirements:
        return 0.15, ["No skill requirements detected — low signal"], False, None

    required = [
        r
        for r in listing.requirements
        if r.importance == RequirementImportance.REQUIRED
    ]
    preferred = [
        r
        for r in listing.requirements
        if r.importance == RequirementImportance.PREFERRED
    ]

    required_hits = sum(1 for r in required if r.skill.lower() in profile_skills)
    preferred_hits = sum(1 for r in preferred if r.skill.lower() in profile_skills)

    if required and required_hits == 0:
        missing = ", ".join(r.skill for r in required)
        return 0.0, [], True, f"Missing all required skills: {missing}"

    req_ratio = required_hits / len(required) if required else 0.0
    pref_ratio = preferred_hits / len(preferred) if preferred else 0.0

    for r in required:
        mark = "\u2713" if r.skill.lower() in profile_skills else "\u2717"
        reasons.append(f"{mark} {r.skill} (required)")
    for r in preferred:
        mark = "\u2713" if r.skill.lower() in profile_skills else "\u2717"
        reasons.append(f"{mark} {r.skill} (preferred)")

    score = 0.75 * req_ratio + 0.25 * pref_ratio
    return score, reasons, False, None


def _score_type(profile: Profile, listing: Listing) -> tuple[float, list[str]]:
    prefs = profile.preferences
    if not prefs.opportunity_types:
        return 1.0, []
    if listing.opportunity_type in prefs.opportunity_types:
        return 1.0, [
            f"\u2713 {listing.opportunity_type.value} matches your preferences"
        ]
    return 0.2, [
        f"\u26a0 {listing.opportunity_type.value} isn't in your preferred types"
    ]


def _score_location(
    profile: Profile, listing: Listing
) -> tuple[float, list[str], list[str]]:
    prefs = profile.preferences
    reasons: list[str] = []
    flags: list[str] = []

    if listing.location_mode == LocationMode.UNKNOWN:
        flags.append("Location mode not specified by listing — confirm before applying")
        return 0.5, reasons, flags

    if listing.location_mode == LocationMode.REMOTE:
        if prefs.remote_ok:
            reasons.append("\u2713 Remote, matches your preference")
            return 1.0, reasons, flags
        return 0.5, reasons, flags

    if not prefs.relocate_ok and listing.countries:
        if prefs.countries and not set(c.lower() for c in listing.countries) & set(
            c.lower() for c in prefs.countries
        ):
            reasons.append(
                f"\u2717 Onsite in {', '.join(listing.countries)}, outside your accepted countries"
            )
            return 0.1, reasons, flags
    reasons.append(
        f"\u26a0 {listing.location_mode.value.title()} role — check relocation requirements"
    )
    return 0.6, reasons, flags


def _score_compensation(
    profile: Profile, listing: Listing
) -> tuple[float, list[str], list[str]]:
    prefs = profile.preferences
    reasons: list[str] = []
    flags: list[str] = []

    if prefs.requires_funded and not listing.is_funded:
        reasons.append(
            "\u2717 Not marked as funded, and you require funded opportunities"
        )
        return 0.0, reasons, flags

    if listing.compensation is None:
        flags.append("Compensation not stated — confirm before applying")
        return 0.6, reasons, flags

    if (
        prefs.min_compensation is not None
        and listing.compensation < prefs.min_compensation
    ):
        reasons.append(
            f"\u2717 Compensation ({listing.compensation}) is below your minimum ({prefs.min_compensation})"
        )
        return 0.2, reasons, flags

    reasons.append("\u2713 Compensation meets your stated minimum")
    return 1.0, reasons, flags


def match(profile: Profile, listing: Listing) -> MatchResult:
    haystack = f"{listing.title} {listing.raw_description}".lower()
    for kw in profile.preferences.excluded_keywords:
        if kw.lower() in haystack:
            return MatchResult(
                score=0.0,
                hard_rejected=True,
                hard_reject_reason=f"Contains excluded keyword: '{kw}'",
            )

    skill_score, skill_reasons, hard_reject, hard_reason = _score_skills(
        profile, listing
    )
    if hard_reject:
        return MatchResult(
            score=0.0, hard_rejected=True, hard_reject_reason=hard_reason
        )

    type_score, type_reasons = _score_type(profile, listing)
    location_score, location_reasons, location_flags = _score_location(profile, listing)
    comp_score, comp_reasons, comp_flags = _score_compensation(profile, listing)

    total = (
        WEIGHTS["skills"] * skill_score
        + WEIGHTS["type"] * type_score
        + WEIGHTS["location"] * location_score
        + WEIGHTS["compensation"] * comp_score
    )

    reasons = skill_reasons + type_reasons + location_reasons + comp_reasons
    flags = list(location_flags) + list(comp_flags)

    if listing.unusual_requirements:
        flags.append(
            "Requires: "
            + ", ".join(listing.unusual_requirements)
            + " — not in your profile yet"
        )

    payment_required = (
        listing.application_fee is not None and listing.application_fee > 0
    )
    if payment_required:
        flags.append(
            f"\u26a0 Requires an application fee (${listing.application_fee:g}) "
            "— verify this is legitimate before paying anything"
        )
        total *= 0.6

    return MatchResult(
        score=round(total, 3),
        reasons=reasons,
        flags=flags,
        payment_required=payment_required,
    )


def passes_threshold(profile: Profile, result: MatchResult) -> bool:
    if result.hard_rejected:
        return False
    return result.score >= profile.preferences.min_match_score
