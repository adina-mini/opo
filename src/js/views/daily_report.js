/**
 * @file views/daily_report.js
 * Daily Report view for opo — Personal Opportunity Agent.
 *
 * Implements:
 * 1. Live multi-query search & discovery across real sources (Remotive + Arbeitnow).
 * 2. Type & match score filter chips (All, High Matches, Jobs, Internships, Research/Fellowships).
 * 3. Status Counter Cards (Discovered, Matched, Needs Input, Ready, Submitted).
 * 4. Ranked Shortlist sorted by match score.
 * 5. Plain language checkmark reasons (✓/✗), warning flags, and fee trust badges.
 * 6. Interactive Detail Drawer trigger.
 */

import { Storage } from '../db.js';
import { match, passesThreshold } from '../matching.js';
import { discoverOpportunities, calculateDeadlineUrgency } from '../discovery.js';
import { openListingDetailModal } from './listing_detail.js';
import { ApplicationState, OpportunityType, createApplication } from '../models.js';
import { generateDraftWithGroq } from '../groq.js';

export function renderDailyReport(container, onNavigate) {
  const profile = Storage.getProfile();
  if (!profile) {
    container.innerHTML = `
      <div class="card" style="text-align: center; padding: 48px 24px;">
        <h2 class="serif-title" style="margin-bottom: 8px;">No Profile Found</h2>
        <p style="margin-bottom: 20px;">Please complete your profile intake to begin receiving matched opportunities.</p>
        <button id="go-onboarding-btn" class="btn btn-primary">Start Onboarding →</button>
      </div>
    `;
    container.querySelector('#go-onboarding-btn').onclick = () => onNavigate('onboarding');
    return;
  }

  // Load cached listings or fetch live
  let cachedListings = Storage.getCachedListings();
  let drafts = Storage.getDrafts();
  let currentFilter = 'all';
  let currentSearchQuery = '';

  container.innerHTML = `
    <!-- End-of-Day Agent Ping Banner -->
    <div id="agent-ping-container">
      <!-- Injected dynamically -->
    </div>

    <!-- Counters Section -->
    <div id="counter-section" class="counter-grid">
      <!-- Injected dynamically -->
    </div>

    <!-- Actions & Search Bar -->
    <div style="margin-bottom: 20px;">
      <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px; flex-wrap: wrap; gap: 8px;">
        <div>
          <h2 class="serif-title" style="font-size: 1.5rem; margin-bottom: 2px;">Today's Opportunities</h2>
          <p style="font-size: 0.85rem; color: var(--color-text-muted);">
            Ranked by genuine skills fit. Urgent deadlines prioritized. Draft-then-approve.
          </p>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <button id="refresh-feed-btn" class="btn btn-secondary btn-sm" style="gap: 6px;">
            ↻ Refresh Live Feeds
          </button>
        </div>
      </div>

      <!-- Live Search Box -->
      <form id="feed-search-form" style="display: flex; gap: 8px; margin-bottom: 12px;">
        <input
          type="text"
          id="feed-search-input"
          class="form-input"
          placeholder="Search live by role, skill, or keyword (e.g. AI, Python, design, research, nurse, intern)..."
          style="flex: 1;"
          value="${currentSearchQuery}"
        />
        <button type="submit" id="search-submit-btn" class="btn btn-primary btn-sm" style="padding: 0 16px;">
          Search
        </button>
        <button type="button" id="clear-search-btn" class="btn btn-secondary btn-sm" style="display: none;">
          Clear
        </button>
      </form>

      <!-- Category Filter Chips -->
      <div id="type-filter-chips" style="display: flex; gap: 6px; flex-wrap: wrap;">
        <button class="btn btn-secondary btn-sm active" data-filter="all">All</button>
        <button class="btn btn-secondary btn-sm" data-filter="matched">Top Matches (60%+)</button>
        <button class="btn btn-secondary btn-sm" data-filter="${OpportunityType.JOB}">Jobs</button>
        <button class="btn btn-secondary btn-sm" data-filter="${OpportunityType.INTERNSHIP}">Internships</button>
        <button class="btn btn-secondary btn-sm" data-filter="fellowship_research">Fellowships & Grants</button>
      </div>
    </div>

    <!-- Active Search Banner -->
    <div id="active-search-banner" style="display: none; background: var(--color-bg-subtle); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-xs); padding: 8px 12px; margin-bottom: 16px; font-size: 0.85rem;">
      <!-- Populated dynamically -->
    </div>

    <!-- Feed Container -->
    <div id="listings-feed">
      <div style="text-align: center; padding: 40px; color: var(--color-text-muted);">
        Loading opportunities...
      </div>
    </div>
  `;

  const pingContainer = container.querySelector('#agent-ping-container');
  const counterSection = container.querySelector('#counter-section');
  const feedEl = container.querySelector('#listings-feed');
  const refreshBtn = container.querySelector('#refresh-feed-btn');
  const searchForm = container.querySelector('#feed-search-form');
  const searchInput = container.querySelector('#feed-search-input');
  const clearSearchBtn = container.querySelector('#clear-search-btn');
  const searchBanner = container.querySelector('#active-search-banner');
  const filterChips = container.querySelectorAll('#type-filter-chips button');

  function updateView(listings) {
    // Score all listings against current profile and compute urgency
    const scoredListings = listings.map(item => {
      const result = match(profile, item);
      const draft = drafts.find(d => d.listing_id === item.id);
      const urgency = calculateDeadlineUrgency(item.deadline);
      return { item, result, draft, urgency };
    });

    // Sort: Urgent (approaching deadline <= 7 days) prioritized first, then by match score
    scoredListings.sort((a, b) => {
      if (a.result.hard_rejected && !b.result.hard_rejected) return 1;
      if (!a.result.hard_rejected && b.result.hard_rejected) return -1;
      if (!a.result.hard_rejected && !b.result.hard_rejected) {
        if (a.urgency.isUrgent && !b.urgency.isUrgent) return -1;
        if (!a.urgency.isUrgent && b.urgency.isUrgent) return 1;
      }
      return b.result.score - a.result.score;
    });

    // Calculate metrics
    const totalDiscovered = listings.length;
    const totalMatched = scoredListings.filter(s => passesThreshold(profile, s.result)).length;
    const totalNeedsInput = drafts.filter(d => d.state === ApplicationState.NEEDS_INPUT).length;
    const totalReady = drafts.filter(d => d.state === ApplicationState.READY).length;
    const totalSubmitted = drafts.filter(d => d.state === ApplicationState.SUBMITTED).length;

    // Render End-of-Day Agent Ping Banner
    pingContainer.innerHTML = `
      <div class="agent-ping-banner">
        <div>
          <div class="agent-ping-title">
            <span>🔔 Autonomous Agent Alert</span>
            <span style="font-size: 0.78rem; font-weight: 500; opacity: 0.85;">(Daily Run Status)</span>
          </div>
          <div class="agent-ping-desc">
            ${totalReady > 0 || totalNeedsInput > 0
              ? `<strong>${totalReady} application${totalReady === 1 ? '' : 's'}</strong> 100% prepared & ready for your final review${totalNeedsInput > 0 ? ` • <strong style="color: var(--color-urgent-text);">${totalNeedsInput} need${totalNeedsInput === 1 ? 's' : ''} your approval/input</strong>` : ''}. Review and submit!`
              : `Your agent has identified <strong>${totalMatched} strong matches</strong>. Click "⚡ Auto-Prepare Applications" to bundle your CV and generate ready-to-submit drafts.`}
          </div>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          ${totalReady > 0 || totalNeedsInput > 0 ? `
            <button id="view-vault-banner-btn" class="btn btn-primary btn-sm">
              Review in Vault (${totalReady}) →
            </button>
          ` : ''}
          <button id="auto-prepare-btn" class="btn btn-secondary btn-sm" style="background: var(--color-bg-card); gap: 6px;">
            ⚡ Auto-Prepare Applications
          </button>
        </div>
      </div>
    `;

    // Wire banner buttons
    const viewVaultBtn = pingContainer.querySelector('#view-vault-banner-btn');
    if (viewVaultBtn) {
      viewVaultBtn.onclick = () => onNavigate('vault');
    }

    const autoPrepareBtn = pingContainer.querySelector('#auto-prepare-btn');
    if (autoPrepareBtn) {
      autoPrepareBtn.onclick = async () => {
        const apiKey = Storage.getGroqApiKey();
        if (!apiKey) {
          const keyInput = prompt('Enter your Groq API key to activate autonomous drafting:');
          if (keyInput && keyInput.trim()) {
            Storage.saveGroqApiKey(keyInput.trim());
          } else {
            return;
          }
        }

        // Target top un-drafted listings
        const unDrafted = scoredListings
          .filter(s => !s.result.hard_rejected && !s.draft && s.result.score >= 0.5)
          .slice(0, 4);

        if (unDrafted.length === 0) {
          alert('All top matched opportunities have already been prepared in your Draft Vault!');
          return;
        }

        autoPrepareBtn.disabled = true;
        autoPrepareBtn.textContent = `⚡ Preparing 0/${unDrafted.length}...`;

        let preparedCount = 0;
        for (let i = 0; i < unDrafted.length; i++) {
          const target = unDrafted[i];
          autoPrepareBtn.textContent = `⚡ Drafting ${i + 1}/${unDrafted.length} (${target.item.title.slice(0, 18)}...)...`;

          try {
            const draftRes = await generateDraftWithGroq({
              profile,
              listing: target.item
            });

            // If listing has unusual requirements not answered, mark as NEEDS_INPUT, otherwise READY
            const hasUnusualReqs = target.item.unusual_requirements && target.item.unusual_requirements.length > 0;
            const targetState = hasUnusualReqs ? ApplicationState.NEEDS_INPUT : ApplicationState.READY;

            const newApp = createApplication(target.item, targetState, {
              coverLetter: draftRes.coverLetter || ''
            });

            Storage.saveDraft(newApp);
            preparedCount++;
          } catch (err) {
            console.warn(`Failed to auto-prepare draft for ${target.item.title}:`, err);
          }
        }

        autoPrepareBtn.disabled = false;
        autoPrepareBtn.textContent = '✓ Preparation Complete!';
        drafts = Storage.getDrafts();
        setTimeout(() => {
          updateView(listings);
        }, 800);
      };
    }

    // Render Counters
    counterSection.innerHTML = `
      <div class="counter-card">
        <span class="counter-value">${totalDiscovered}</span>
        <span class="counter-label">Discovered</span>
      </div>
      <div class="counter-card">
        <span class="counter-value" style="color: var(--color-sage-deep);">${totalMatched}</span>
        <span class="counter-label">Matched</span>
      </div>
      <div class="counter-card">
        <span class="counter-value" style="color: var(--color-clay-dark);">${totalNeedsInput}</span>
        <span class="counter-label">Needs Input</span>
      </div>
      <div class="counter-card">
        <span class="counter-value" style="color: var(--color-sage);">${totalReady}</span>
        <span class="counter-label">Ready</span>
      </div>
      <div class="counter-card">
        <span class="counter-value">${totalSubmitted}</span>
        <span class="counter-label">Submitted</span>
      </div>
    `;

    // Apply Filter Chips
    let displayList = scoredListings.filter(s => !s.result.hard_rejected);

    if (currentFilter === 'matched') {
      displayList = displayList.filter(s => s.result.score >= 0.60);
    } else if (currentFilter === OpportunityType.JOB) {
      displayList = displayList.filter(s => s.item.opportunity_type === OpportunityType.JOB);
    } else if (currentFilter === OpportunityType.INTERNSHIP) {
      displayList = displayList.filter(s => s.item.opportunity_type === OpportunityType.INTERNSHIP);
    } else if (currentFilter === 'fellowship_research') {
      displayList = displayList.filter(s =>
        [OpportunityType.FELLOWSHIP, OpportunityType.RESEARCH, OpportunityType.GRANT, OpportunityType.SCHOLARSHIP].includes(s.item.opportunity_type)
      );
    }

    if (displayList.length === 0) {
      feedEl.innerHTML = `
        <div class="card" style="text-align: center; padding: 40px;">
          <h3 class="serif-title" style="margin-bottom: 6px;">No Opportunities Found for this Filter</h3>
          <p style="margin-bottom: 16px;">Try switching to "All" or searching for another keyword like "developer", "design", "manager", or "remote".</p>
          <button id="empty-reset-filter-btn" class="btn btn-secondary btn-sm">Show All Opportunities</button>
        </div>
      `;
      feedEl.querySelector('#empty-reset-filter-btn')?.addEventListener('click', () => {
        currentFilter = 'all';
        filterChips.forEach(b => b.classList.remove('active'));
        filterChips[0].classList.add('active');
        updateView(listings);
      });
      return;
    }

    // Render Cards with Compensation, Deadline, and Urgent styling
    feedEl.innerHTML = displayList.map(({ item, result, draft, urgency }) => {
      const matchPct = Math.round(result.score * 100);
      const isFeeRequired = result.payment_required;
      const flags = result.flags || [];
      const primaryReasons = (result.reasons || []).slice(0, 4);

      return `
        <div class="listing-card card-hoverable ${urgency.isUrgent ? 'urgent' : ''}" data-listing-id="${item.id}" style="cursor: pointer;">
          <div class="listing-card-header">
            <div class="listing-title-group">
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap;">
                <span class="listing-tag">${item.opportunity_type}</span>
                <span class="listing-tag">${item.location_mode}</span>
                
                <!-- Urgent Deadline Badge -->
                ${urgency.isUrgent ? `
                  <span class="urgent-badge">⏳ ${urgency.label}</span>
                ` : (urgency.hasDeadline ? `
                  <span class="deadline-pill">📅 ${urgency.label}</span>
                ` : '')}

                <!-- Compensation Badge -->
                ${item.compensation ? `
                  <span class="compensation-pill">💰 $${item.compensation}/mo</span>
                ` : (item.unpaid ? '<span class="listing-tag">Unpaid (Welcomed)</span>' : '')}

                ${draft ? `<span class="state-pill ${draft.state}">${draft.state}</span>` : ''}
              </div>
              <h3 class="serif-title">${item.title}</h3>
              <div class="listing-org-row">
                <strong>${item.organization}</strong>
                ${item.countries?.length ? `• ${item.countries.join(', ')}` : ''}
              </div>
            </div>

            <div style="text-align: right; flex-shrink: 0;">
              <span class="match-badge ${isFeeRequired ? 'discounted' : ''}">
                ${matchPct}% Match
              </span>
            </div>
          </div>

          <!-- Plain Language Reasons -->
          <div class="reason-list">
            ${primaryReasons.map(r => `
              <div class="reason-item">
                <span class="${r.startsWith('✓') ? 'reason-mark-hit' : 'reason-mark-miss'}">
                  ${r.startsWith('✓') ? '✓' : '•'}
                </span>
                <span>${r.replace(/^[✓✗•]\s*/, '')}</span>
              </div>
            `).join('')}
          </div>

          <!-- Flags & Badges -->
          ${flags.length > 0 ? `
            <div class="flags-container">
              ${flags.slice(0, 2).map(f => `
                <span class="flag-pill ${f.includes('fee') ? 'fee-flag' : ''}">${f}</span>
              `).join('')}
            </div>
          ` : ''}

          <!-- Card Action Buttons -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--color-border-subtle); flex-wrap: wrap; gap: 8px;">
            <span style="font-size: 0.78rem; color: var(--color-text-muted);">
              Click card for fit breakdown & draft assistant
            </span>
            <div style="display: flex; gap: 8px; align-items: center;">
              ${item.source_urls?.[0] ? `
                <a
                  href="${item.source_urls[0]}"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="btn btn-secondary btn-sm"
                  style="padding: 4px 10px; font-size: 0.8rem; text-decoration: none;"
                  onclick="event.stopPropagation();"
                  title="Open genuine official site"
                >
                  ↗ Official Site
                </a>
              ` : ''}
              <button
                type="button"
                class="btn btn-primary btn-sm card-autoapply-btn"
                style="padding: 4px 10px; font-size: 0.8rem; gap: 4px;"
                data-listing-id="${item.id}"
                title="Prepare application and launch autofill assistant"
              >
                ⚡ View & Apply ↗
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Attach click listeners to cards to open modal
    feedEl.querySelectorAll('.listing-card').forEach(card => {
      card.onclick = () => {
        const id = card.getAttribute('data-listing-id');
        const found = scoredListings.find(s => s.item.id === id);
        if (found) {
          openListingDetailModal(found.item, found.result, () => {
            drafts = Storage.getDrafts();
            updateView(listings);
          });
        }
      };
    });

    // Attach click listeners to auto-apply buttons
    feedEl.querySelectorAll('.card-autoapply-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-listing-id');
        const found = scoredListings.find(s => s.item.id === id);
        if (found) {
          openListingDetailModal(found.item, found.result, () => {
            drafts = Storage.getDrafts();
            updateView(listings);
          });
        }
      };
    });
  }

  async function handleSearch(query) {
    refreshBtn.disabled = true;
    refreshBtn.textContent = '↻ Fetching live feeds...';
    currentSearchQuery = (query || '').trim();

    if (currentSearchQuery) {
      clearSearchBtn.style.display = 'block';
      searchBanner.style.display = 'flex';
      searchBanner.style.justifyContent = 'space-between';
      searchBanner.style.alignItems = 'center';
      searchBanner.innerHTML = `
        <span>Searching live feeds for: <strong>"${currentSearchQuery}"</strong></span>
        <button id="banner-reset-btn" class="btn-subtle" style="font-size: 0.8rem; cursor: pointer;">Show All</button>
      `;
      searchBanner.querySelector('#banner-reset-btn')?.addEventListener('click', () => {
        searchInput.value = '';
        handleSearch('');
      });
    } else {
      clearSearchBtn.style.display = 'none';
      searchBanner.style.display = 'none';
    }

    try {
      // Fetch fresh live listings using search query or default primary skill
      const queryToUse = currentSearchQuery || profile.skills?.[0]?.name || '';
      const fresh = await discoverOpportunities({ search: queryToUse });
      cachedListings = fresh;
      updateView(fresh);
    } catch (err) {
      console.error('Failed to search feed:', err);
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.textContent = '↻ Refresh Live Feeds';
    }
  }

  // Refresh button
  refreshBtn.onclick = () => {
    Storage.clearListingsCache();
    handleSearch(currentSearchQuery);
  };

  // Search form submit
  searchForm.onsubmit = (e) => {
    e.preventDefault();
    handleSearch(searchInput.value);
  };

  // Clear search button
  clearSearchBtn.onclick = () => {
    searchInput.value = '';
    handleSearch('');
  };

  // Category filter chips
  filterChips.forEach(btn => {
    btn.onclick = () => {
      filterChips.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.getAttribute('data-filter');
      updateView(cachedListings);
    };
  });

  // Initial load
  if (cachedListings && cachedListings.length > 0) {
    updateView(cachedListings);
  } else {
    handleSearch('');
  }
}
