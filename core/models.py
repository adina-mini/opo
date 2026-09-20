"""
Core data schemas for the opportunity agent.

No external dependencies on purpose (stdlib dataclasses + enums only) so
this can be dropped into a script, a FastAPI backend, or a notebook
without dragging in a specific framework choice yet.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import Enum
from typing import Optional

# ---------------------------------------------------------------------------
# Shared vocab
# ---------------------------------------------------------------------------


class SkillLevel(str, Enum):
    BEGINNER = "beginner"
    INTERMEDIATE = "intermediate"
    ADVANCED = "advanced"


class OpportunityType(str, Enum):
    JOB = "job"
    INTERNSHIP = "internship"
    FELLOWSHIP = "fellowship"
    SCHOLARSHIP = "scholarship"
    RESEARCH = "research"
    HACKATHON = "hackathon"
    COMPETITION = "competition"
    ACCELERATOR = "accelerator"
    GRANT = "grant"
    OPEN_SOURCE = "open_source"
    EXCHANGE = "exchange"
    CONFERENCE = "conference"
    RESEARCH_ASSISTANTSHIP = "research_assistantship"


class RequirementImportance(str, Enum):
    REQUIRED = "required"
    PREFERRED = "preferred"


class LocationMode(str, Enum):
    REMOTE = "remote"
    ONSITE = "onsite"
    HYBRID = "hybrid"
    UNKNOWN = "unknown"  # listing didn't say — never guess this


# ---------------------------------------------------------------------------
# Profile (the user side)
# ---------------------------------------------------------------------------


@dataclass
class Skill:
    name: str  # e.g. "Python", "LangGraph", "Docker"
    level: SkillLevel = SkillLevel.INTERMEDIATE
    category: Optional[str] = None  # e.g. "programming", "ml", "tooling"


@dataclass
class Education:
    degree: str  # e.g. "BS Artificial Intelligence"
    institution: str
    graduation_date: Optional[date] = None
    gpa: Optional[float] = None
    gpa_scale: float = 4.0


@dataclass
class Preferences:
    opportunity_types: list[OpportunityType] = field(default_factory=list)
    remote_ok: bool = True
    relocate_ok: bool = False
    countries: list[str] = field(
        default_factory=list
    )  # acceptable countries; empty = no constraint
    min_compensation: Optional[float] = None  # None = unpaid acceptable
    requires_funded: bool = False  # must be paid/funded, no exceptions
    min_match_score: float = 0.70  # below this, don't even show it
    excluded_keywords: list[str] = field(
        default_factory=list
    )  # hard reject if title/desc matches


@dataclass
class Profile:
    name: str
    email: str
    skills: list[Skill] = field(default_factory=list)
    education: list[Education] = field(default_factory=list)
    preferences: Preferences = field(default_factory=Preferences)
    # free-form answers the user has already given, reused for cover letters /
    # recurring application questions (e.g. "why_this_field", "leadership_example")
    answer_library: dict[str, str] = field(default_factory=dict)

    def skill_names(self) -> set[str]:
        return {s.name.lower() for s in self.skills}


# ---------------------------------------------------------------------------
# Listing (the opportunity side)
# ---------------------------------------------------------------------------


@dataclass
class Requirement:
    skill: str
    importance: RequirementImportance = RequirementImportance.REQUIRED
    min_level: SkillLevel = SkillLevel.BEGINNER


@dataclass
class Listing:
    title: str
    organization: str
    opportunity_type: OpportunityType
    requirements: list[Requirement] = field(default_factory=list)
    location_mode: LocationMode = LocationMode.UNKNOWN
    countries: list[str] = field(default_factory=list)  # where it's open to, if known
    compensation: Optional[float] = None  # None = unknown/unpaid
    is_funded: bool = False
    application_fee: Optional[float] = (
        None  # if the listing requires YOU to pay to apply
    )
    deadline: Optional[date] = None
    source_urls: list[str] = field(default_factory=list)  # for dedupe across boards
    raw_description: str = ""
    # fields the agent knows it can't infer confidently and must ask the user
    # about before an application can be considered "ready" — populated by
    # the application-prep step, not by matching, but declared here since
    # it lives on the listing's requirement set (e.g. "nomination_letter")
    unusual_requirements: list[str] = field(default_factory=list)
