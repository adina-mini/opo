/**
 * @file views/draft_vault.js
 * Draft Vault view for opo — Personal Opportunity Agent.
 *
 * Implements persistent application state machine:
 * discovered → shortlisted → drafting → needs_input → ready → submitted → outcomes.
 * Allows the user to resume in-progress drafts, approve them, and record outcomes.
 */

import { Storage } from '../db.js';
import { ApplicationState } from '../models.js';
import { openListingDetailModal, openAutofillAssistantModal } from './listing_detail.js';

export function renderDraftVault(container, onNavigate) {
  let drafts = Storage.getDrafts();
  let activeFilter = 'all';

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 20px; flex-wrap: wrap; gap: 12px;">
      <div>
        <h2 class="serif-title" style="font-size: 1.6rem; margin-bottom: 4px;">Draft Vault</h2>
        <p style="font-size: 0.85rem; color: var(--color-text-muted);">
          Your in-progress and submitted applications. Draft-then-approve — resume anytime.
        </p>
      </div>

      <!-- State Filter Pills -->
      <div id="vault-filter-pills" style="display: flex; gap: 6px; flex-wrap: wrap;">
        <button class="btn btn-secondary btn-sm active" data-filter="all">All (${drafts.length})</button>
        <button class="btn btn-secondary btn-sm" data-filter="${ApplicationState.SHORTLISTED}">Shortlisted</button>
        <button class="btn btn-secondary btn-sm" data-filter="${ApplicationState.DRAFTING}">Drafting</button>
        <button class="btn btn-secondary btn-sm" data-filter="${ApplicationState.NEEDS_INPUT}">Needs Input</button>
        <button class="btn btn-secondary btn-sm" data-filter="${ApplicationState.READY}">Ready</button>
        <button class="btn btn-secondary btn-sm" data-filter="${ApplicationState.SUBMITTED}">Submitted</button>
      </div>
    </div>

    <!-- Drafts Container -->
    <div id="vault-items-container">
      <!-- Injected dynamically -->
    </div>
  `;

  const itemsContainer = container.querySelector('#vault-items-container');
  const filterPills = container.querySelectorAll('#vault-filter-pills button');

  function updateList() {
    drafts = Storage.getDrafts();

    // Filter
    let filtered = drafts;
    if (activeFilter !== 'all') {
      filtered = drafts.filter(d => d.state === activeFilter);
    }

    if (filtered.length === 0) {
      itemsContainer.innerHTML = `
        <div class="card" style="text-align: center; padding: 48px 24px;">
          <div style="font-size: 2rem; margin-bottom: 8px;">📂</div>
          <h3 class="serif-title" style="margin-bottom: 6px;">No Applications in this View</h3>
          <p style="color: var(--color-text-secondary); margin-bottom: 16px;">
            ${activeFilter === 'all'
              ? 'You haven\'t saved any opportunities to your Draft Vault yet. Explore Today\'s Feed to shortlist opportunities.'
              : `No applications currently in state "${activeFilter}".`}
          </p>
          <button id="go-feed-btn" class="btn btn-primary btn-sm">Explore Opportunities →</button>
        </div>
      `;
      itemsContainer.querySelector('#go-feed-btn')?.addEventListener('click', () => onNavigate('feed'));
      return;
    }

    itemsContainer.innerHTML = filtered.map(app => {
      const listing = app.listing;
      const letter = app.draft_content?.cover_letter || '';
      const letterExcerpt = letter.length > 180 ? letter.slice(0, 180) + '...' : letter;

      return `
        <div class="card" style="margin-bottom: 16px; padding: 22px;">
          <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; margin-bottom: 12px; flex-wrap: wrap;">
            <div>
              <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                <span class="state-pill ${app.state}">${app.state}</span>
                <span class="listing-tag">${listing.opportunity_type}</span>
                <span class="listing-tag">${listing.location_mode}</span>
              </div>
              <h3 class="serif-title" style="font-size: 1.3rem; margin-bottom: 2px;">${listing.title}</h3>
              <p style="font-size: 0.9rem; color: var(--color-text-secondary);">
                <strong>${listing.organization}</strong>
              </p>
            </div>

            <!-- State Advance Button -->
            <div style="display: flex; gap: 8px; align-items: center;">
              ${app.state !== ApplicationState.SUBMITTED ? `
                <select class="form-select state-changer-select" data-app-id="${app.id}" style="padding: 4px 8px; font-size: 0.8rem;">
                  <option value="${ApplicationState.SHORTLISTED}" ${app.state === ApplicationState.SHORTLISTED ? 'selected' : ''}>Shortlisted</option>
                  <option value="${ApplicationState.DRAFTING}" ${app.state === ApplicationState.DRAFTING ? 'selected' : ''}>Drafting</option>
                  <option value="${ApplicationState.NEEDS_INPUT}" ${app.state === ApplicationState.NEEDS_INPUT ? 'selected' : ''}>Needs Input</option>
                  <option value="${ApplicationState.READY}" ${app.state === ApplicationState.READY ? 'selected' : ''}>Ready to Apply</option>
                  <option value="${ApplicationState.SUBMITTED}" ${app.state === ApplicationState.SUBMITTED ? 'selected' : ''}>Mark Submitted</option>
                </select>
              ` : `
                <select class="form-select outcome-changer-select" data-app-id="${app.id}" style="padding: 4px 8px; font-size: 0.8rem;">
                  <option value="" disabled ${!app.outcome_notes ? 'selected' : ''}>Outcome...</option>
                  <option value="interview" ${app.state === ApplicationState.INTERVIEW ? 'selected' : ''}>Interview</option>
                  <option value="offer" ${app.state === ApplicationState.OFFER ? 'selected' : ''}>Offer</option>
                  <option value="rejected" ${app.state === ApplicationState.REJECTED ? 'selected' : ''}>Rejected</option>
                </select>
              `}
              <button type="button" class="btn-subtle delete-app-btn" data-app-id="${app.id}" style="color: var(--color-fee-text); font-size: 0.85rem; padding: 4px 6px;">
                Remove
              </button>
            </div>
          </div>

          <!-- Missing Inputs Alert -->
          ${(app.missing_inputs?.length > 0 && app.state !== ApplicationState.SUBMITTED) ? `
            <div style="background: var(--color-clay-wash); border-radius: var(--radius-xs); padding: 8px 12px; margin-bottom: 12px; font-size: 0.82rem; color: var(--color-clay-dark);">
              <strong>Needs Input:</strong> ${app.missing_inputs.join(', ')}
            </div>
          ` : ''}

          <!-- Draft Note Excerpt -->
          ${letter ? `
            <div style="background: var(--color-bg-subtle); border-radius: var(--radius-xs); padding: 12px 14px; margin-bottom: 14px; font-size: 0.86rem; color: var(--color-text-secondary); line-height: 1.5;">
              <div style="font-size: 0.75rem; text-transform: uppercase; font-weight: 600; color: var(--color-text-muted); margin-bottom: 4px;">Prepared Cover Letter:</div>
              ${letterExcerpt}
            </div>
          ` : `
            <div style="font-size: 0.84rem; color: var(--color-text-muted); margin-bottom: 12px;">
              No cover letter prepared yet. Click "Edit & Prepare Draft" to generate one.
            </div>
          `}

          <!-- Footer Actions -->
          <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--color-border-subtle); padding-top: 12px; flex-wrap: wrap; gap: 8px;">
            <span style="font-size: 0.8rem; color: var(--color-text-muted);">
              Last updated: ${new Date(app.updated_at).toLocaleDateString()}
            </span>

            <div style="display: flex; gap: 8px; align-items: center;">
              <button type="button" class="btn btn-secondary btn-sm open-editor-btn" data-app-id="${app.id}">
                Edit Draft
              </button>
              ${listing.source_urls?.[0] ? `
                <a href="${listing.source_urls[0]}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="text-decoration: none;">
                  ↗ Official Link
                </a>
                <button type="button" class="btn btn-primary btn-sm vault-autofill-btn" data-app-id="${app.id}">
                  ⚡ Apply & Autofill on Site ↗
                </button>
              ` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Attach State Select Listeners
    itemsContainer.querySelectorAll('.state-changer-select').forEach(sel => {
      sel.onchange = () => {
        const id = sel.getAttribute('data-app-id');
        const app = Storage.getDraft(id);
        if (app) {
          app.state = sel.value;
          if (sel.value === ApplicationState.SUBMITTED && !app.submitted_at) {
            app.submitted_at = new Date().toISOString();
          }
          Storage.saveDraft(app);
          updateList();
        }
      };
    });

    // Attach Outcome Select Listeners
    itemsContainer.querySelectorAll('.outcome-changer-select').forEach(sel => {
      sel.onchange = () => {
        const id = sel.getAttribute('data-app-id');
        const app = Storage.getDraft(id);
        if (app) {
          app.state = sel.value;
          app.outcome_notes = sel.value;
          Storage.saveDraft(app);
          updateList();
        }
      };
    });

    // Attach Delete Listeners
    itemsContainer.querySelectorAll('.delete-app-btn').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-app-id');
        if (confirm('Remove this opportunity from your Vault?')) {
          Storage.deleteDraft(id);
          updateList();
        }
      };
    });

    // Attach Edit Draft Listeners
    itemsContainer.querySelectorAll('.open-editor-btn').forEach(btn => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-app-id');
        const app = Storage.getDraft(id);
        if (app) {
          openListingDetailModal(app.listing, null, () => {
            updateList();
          });
        }
      };
    });

    // Attach Apply & Autofill Listeners
    itemsContainer.querySelectorAll('.vault-autofill-btn').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-app-id');
        const app = Storage.getDraft(id);
        if (app && app.listing?.source_urls?.[0]) {
          const profile = Storage.getProfile();
          const targetUrl = app.listing.source_urls[0];

          // CRITICAL: Call window.open IMMEDIATELY & SYNCHRONOUSLY to prevent browser popup suppression!
          window.open(targetUrl, '_blank', 'noopener,noreferrer');

          // Copy cover letter to clipboard if ready
          const letter = app.draft_content?.cover_letter;
          if (letter) {
            navigator.clipboard?.writeText(letter).catch(() => {});
          }

          // Launch Autofill Assistant modal
          openAutofillAssistantModal(profile, app, targetUrl, () => {
            updateList();
          });
        }
      };
    });
  }

  // Filter button clicks
  filterPills.forEach(btn => {
    btn.onclick = () => {
      filterPills.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.getAttribute('data-filter');
      updateList();
    };
  });

  updateList();
}
