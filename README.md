
# opo

An opportunity discovery and matching agent that helps users find relevant opportunities based on their skills, interests, and preferences.

opo is designed to discover internships, fellowships, research positions, jobs, scholarships, hackathons, and other career-building opportunities. It evaluates each listing against a user's profile and highlights opportunities worth pursuing.

## Project Status

**Work in Progress**

### Completed

- Profile and opportunity listing data models.
- Matching engine with compatibility scores and explanations.
- Skill-based matching and opportunity evaluation.
- Missing information flags and hard-rejection rules.
- Trust signals for evaluating opportunity listings.
- Remotive adapter for discovering remote jobs.

### In Progress

- LLM-powered skill extraction.
- Selection and integration of an appropriate language model.

### Planned

- Additional opportunity discovery sources.
- Mobile application using React Native and Expo.

## Project Structure

```text
opo/
├── core/
│   ├── models.py          # Profile, Listing, and enums
│   └── matching.py        # Profile-to-listing matching engine
├── discovery/
│   ├── base.py            # Discovery adapter interface
│   └── remotive.py        # Remotive job listings adapter
├── tests/
│   └── test_matching.py   # Matching engine tests
├── main.py                # End-to-end demonstration
└── README.md              # Project documentation
```

## Getting Started

### 1. Clone the Repository

```bash
git clone <repository-url>
cd opo
```

### 2. Create a Virtual Environment

```bash
python -m venv venv
```

Activate the environment:

**Windows Git Bash**

```bash
source venv/Scripts/activate
```

**macOS/Linux**

```bash
source venv/bin/activate
```

### 3. Install Dependencies

```bash
pip install groq python-dotenv
```

### 4. Configure Environment Variables

Create a `.env` file in the project root:

```env
GROQ_API_KEY=your_api_key_here
```

Keep your API keys private. Do not commit the `.env` file to the repository.

### 5. Run the Project

```bash
python -m main
```

## Core Principles

- **Transparent matching:** Every score should have understandable reasons behind it.
- **Explicit uncertainty:** Missing information should be flagged rather than silently treated as a match or rejection.
- **Skill-first evaluation:** A user's skills should be the primary factor in opportunity matching.
- **Context-aware matching:** Opportunity type, location, compensation, and other preferences should influence the final score.
- **Financial transparency:** Opportunities that require applicants to pay should be clearly flagged.
- **Trust and safety:** Suspicious, incomplete, or potentially misleading listings should be surfaced for review.
- **Responsible discovery:** The project will not scrape LinkedIn.

## Roadmap

- [ ] Improve LLM-powered skill extraction.
- [ ] Evaluate Gemini and Groq for skill extraction.
- [ ] Add Adzuna and Devpost discovery adapters.
- [ ] Add curated sources for fellowships, scholarships, and research opportunities.
- [ ] Build a FastAPI backend around the matching engine.
- [ ] Develop a mobile application using React Native and Expo.
- [ ] Add personalized daily opportunity recommendations.
- [ ] Add application draft generation and reusable answer memory.
- [ ] Build an application tracking system.

## Future Vision

opo aims to become a personalized opportunity discovery platform that reduces the time users spend searching for relevant opportunities and helps them make better-informed application decisions.

The long-term goal is to combine reliable opportunity discovery, transparent matching, and personalized application support in one platform.

## License

License information will be added in a future release.