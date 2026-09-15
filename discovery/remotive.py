"""
Remotive adapter — pulls remote jobs from remotive.com/api/remote-jobs.

Uses Groq (Llama) to extract required vs preferred skills from each
listing's description. Results are cached on disk so we don't re-call
the LLM on every run.

Docs: https://remotive.com/api/remote-jobs
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
import urllib.request
import urllib.parse
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from groq import Groq

from core.models import (
    Listing,
    OpportunityType,
    Requirement,
    RequirementImportance,
    LocationMode,
)

from discovery.base import BaseAdapter

load_dotenv()

API_URL = "https://remotive.com/api/remote-jobs"
CACHE_DIR = Path(__file__).parent / ".cache"
CACHE_DIR.mkdir(exist_ok=True)

# If a model name 404s, try: "llama-3.1-8b-instant" or "openai/gpt-oss-20b"
GROQ_MODEL = "openai/gpt-oss-20b"


_EXTRACTION_PROMPT = """You are a job listing parser. Extract the skills this role requires from the description below.

Rules:
- "required" = must-have skills. Phrases like "must have", "required", "you have X years", "proficiency in", "strong experience with".
- "preferred" = nice-to-have. Phrases like "bonus", "nice to have", "familiarity with", "plus", "preferred".
- Only include concrete technical skills, tools, languages, frameworks, or domains. Skip soft skills like "communication", "team player".
- Use lowercase canonical names. E.g. "React.js" -> "react", "PostgreSQL" -> "postgres", "Node" -> "node.js".
- If the listing mentions nothing specific, return empty lists. Do NOT guess.

Return ONLY valid JSON in this exact shape, no prose, no markdown:
{{"required": ["skill1", "skill2"], "preferred": ["skill3"]}}

--- DESCRIPTION ---
{description}
--- END ---
"""


def _cache_key(description: str) -> str:
    return hashlib.sha256(description.encode("utf-8")).hexdigest()[:16]


def _load_cache(key: str):
    path = CACHE_DIR / f"{key}.json"
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return None
    return None


def _save_cache(key: str, value: dict) -> None:
    path = CACHE_DIR / f"{key}.json"
    try:
        path.write_text(json.dumps(value), encoding="utf-8")
    except Exception:
        pass


def _extract_with_groq(client: Groq, description: str, debug: bool = False) -> dict:
    trimmed = description[:3000]
    prompt = _EXTRACTION_PROMPT.format(description=trimmed)

    raw = None
    last_err = None
    for attempt in range(4):
        try:
            resp = client.chat.completions.create(
                model=GROQ_MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=0,
                max_tokens=1000,
            )
            raw = resp.choices[0].message.content or ""
            break
        except Exception as e:
            last_err = e
            msg = str(e)
            if "429" in msg or "rate_limit" in msg:
                wait = 5 * (attempt + 1)
                print(f"  [rate limited, waiting {wait}s...]")
                time.sleep(wait)
                continue
            print(f"  [groq error: {e}]")
            return {"required": [], "preferred": []}

    if raw is None:
        print(f"  [groq gave up after retries: {last_err}]")
        return {"required": [], "preferred": []}

    if debug:
        print(f"  [groq raw]: {raw[:300]}")

    # Strip markdown fences if present
    raw = raw.strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.lower().startswith("json"):
            raw = raw[4:].strip()

    # Find the first { ... } block
    start = raw.find("{")
    end = raw.rfind("}")
    if start == -1 or end == -1 or end <= start:
        if debug:
            print(f"  [no JSON block found in: {raw[:200]}]")
        return {"required": [], "preferred": []}
    raw = raw[start : end + 1]

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        if debug:
            print(f"  [json parse failed: {e} | raw: {raw[:200]}]")
        return {"required": [], "preferred": []}

    def _clean(items):
        out = []
        for s in items or []:
            if not isinstance(s, str):
                continue
            s = s.lower().strip()
            if s:
                out.append(s)
        return out

    return {
        "required": _clean(data.get("required", [])),
        "preferred": _clean(data.get("preferred", [])),
    }


def _skills_to_requirements(extracted: dict) -> list[Requirement]:
    reqs: list[Requirement] = []
    for skill in extracted.get("required", []):
        reqs.append(Requirement(skill=skill, importance=RequirementImportance.REQUIRED))
    for skill in extracted.get("preferred", []):
        reqs.append(
            Requirement(skill=skill, importance=RequirementImportance.PREFERRED)
        )
    return reqs


def _strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"&nbsp;", " ", text)
    text = re.sub(r"&amp;", "&", text)
    text = re.sub(r"&#\d+;", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def _parse_date(value: str | None):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        return None


class RemotiveAdapter(BaseAdapter):
    name = "remotive"

    def __init__(self, search: str | None = None, limit: int = 50, debug: bool = False):
        self.search = search
        self.limit = limit
        self.debug = debug
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise RuntimeError(
                "GROQ_API_KEY not set. Create a .env file in opo/ with GROQ_API_KEY=..."
            )
        self.client = Groq(api_key=api_key)

    def fetch(self) -> list[Listing]:
        url = API_URL
        if self.search:
            url = f"{url}?search={urllib.parse.quote(self.search)}"

        req = urllib.request.Request(url, headers={"User-Agent": "opo/0.1"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            payload = json.loads(resp.read().decode("utf-8"))

        jobs = payload.get("jobs", [])[: self.limit]
        return [self._to_listing(j) for j in jobs]

    def _to_listing(self, job: dict) -> Listing:
        description = job.get("description", "") or ""
        plain = _strip_html(description)

        key = _cache_key(plain)
        extracted = _load_cache(key)
        if extracted is None:
            time.sleep(1.5)
            extracted = _extract_with_groq(self.client, plain, debug=self.debug)
            _save_cache(key, extracted)

        requirements = _skills_to_requirements(extracted)

        countries: list[str] = []
        loc = (job.get("candidate_required_location") or "").strip()
        if loc and loc.lower() not in ("worldwide", "anywhere"):
            countries = [loc]

        return Listing(
            title=job.get("title", "Untitled").strip(),
            organization=job.get("company_name", "Unknown").strip(),
            opportunity_type=OpportunityType.JOB,
            requirements=requirements,
            location_mode=LocationMode.REMOTE,
            countries=countries,
            compensation=None,
            is_funded=False,
            application_fee=None,
            deadline=_parse_date(job.get("publication_date")),
            source_urls=[job.get("url", "")] if job.get("url") else [],
            raw_description=plain[:5000],
        )
