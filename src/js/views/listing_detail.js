/**
 * @file views/listing_detail.js
 * Opportunity Detail & Application Drafter Modal for opo.
 *
 * Implements:
 * 1. Deep fit breakdown (✓/✗ reasons, soft flags, fee signals).
 * 2. "Things you don't know" pings: highlights unusual_requirements as blocking items.
 * 3. Application Draft Generator: synthesizes tailored cover letter with Groq or local synthesis.
 * 4. In-place editable draft and save to Draft Vault.
 */

import { Storage } from '../db.js';
import { ApplicationState, createApplication } from '../models.js';
import { generateDraftWithGroq } from '../groq.js';
import { calculateDeadlineUrgency } from '../discovery.js';
import { generateAutofillBookmarklet, getAutofillScript } from '../autofill.js';

export function openListingDetailModal(listing, matchResult, onUpdate) {
  const profile = Storage.getProfile();
  const existingDraft = Storage.getDraft(listing.id);
  const flags = matchResult?.flags || [];
  const unusualReqs = listing.unusual_requirements || [];
  const urgency = calculateDeadlineUrgency(listing.deadline);

  // Determine draft state
  let currentCoverLetter = existingDraft?.draft_content?.cover_letter || '';
  let currentState = existingDraft?.state || ApplicationState.SHORTLISTED;

  const modalBackdrop = document.createElement('div');
  modalBackdrop.className = 'modal-backdrop';

  modalBackdrop.innerHTML = `
    <div class="modal-content" style="max-width: 720px;">
      <!-- Modal Header -->
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 1px solid var(--color-border-subtle); padding-bottom: 16px;">
        <div>
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px; flex-wrap: wrap;">
            <span class="listing-tag" style="background: var(--color-sage-wash); color: var(--color-sage-deep); font-weight: 700;">
              ${listing.opportunity_type}
            </span>
            <span class="listing-tag">${listing.location_mode}</span>

            <!-- Urgent / Deadline Badge -->
            ${urgency.isUrgent ? `
              <span class="urgent-badge">⏳ ${urgency.label}</span>
            ` : (urgency.hasDeadline ? `
              <span class="deadline-pill">📅 ${urgency.label}</span>
            ` : '')}

            ${listing.unpaid ? '<span class="listing-tag">Unpaid (Welcomed)</span>' : ''}
            ${listing.compensation ? `<span class="compensation-pill">💰 $${listing.compensation}/mo</span>` : ''}
          </div>
          <h2 class="serif-title" style="font-size: 1.6rem; margin-bottom: 4px;">${listing.title}</h2>
          <p style="color: var(--color-text-secondary); font-size: 0.95rem;">
            <strong>${listing.organization}</strong>
            ${listing.countries?.length ? `• ${listing.countries.join(', ')}` : ''}
          </p>
        </div>

        <div style="display: flex; align-items: center; gap: 8px;">
          ${listing.source_urls?.[0] ? `
            <a href="${listing.source_urls[0]}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="display: inline-flex; align-items: center; gap: 4px; text-decoration: none; padding: 6px 12px;">
              ↗ Official Site
            </a>
          ` : ''}
          <button type="button" id="close-modal-btn" class="btn-subtle" style="font-size: 1.5rem; line-height: 1; padding: 4px 8px; border-radius: var(--radius-xs); cursor: pointer;">
            ×
          </button>
        </div>
      </div>

      <!-- Match Score & Fit Explanation -->
      <div style="background: var(--color-bg-subtle); border-radius: var(--radius-sm); padding: 16px; border: 1px solid var(--color-border-subtle);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h4 style="font-size: 0.95rem; font-weight: 600;">Match Fit Analysis</h4>
          <span class="match-badge ${matchResult?.payment_required ? 'discounted' : ''}">
            ${Math.round((matchResult?.score || 0) * 100)}% Match
          </span>
        </div>

        <div class="reason-list" style="margin-bottom: 10px;">
          ${(matchResult?.reasons || []).map(r => `
            <div class="reason-item">
              <span class="${r.startsWith('✓') ? 'reason-mark-hit' : 'reason-mark-miss'}">
                ${r.startsWith('✓') ? '✓' : '•'}
              </span>
              <span>${r.replace(/^[✓✗•]\s*/, '')}</span>
            </div>
          `).join('')}
        </div>

        ${flags.length ? `
          <div style="margin-top: 10px; display: flex; flex-direction: column; gap: 6px;">
            ${flags.map(f => `
              <div class="flag-pill ${f.includes('fee') ? 'fee-flag' : ''}">
                ${f}
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>

      <!-- "Things You Don't Know" Pings (Core Safety Principle) -->
      ${(unusualReqs.length > 0 || listing.location_mode === 'unknown') ? `
        <div style="background: var(--color-clay-wash); border: 1px solid var(--color-clay); border-radius: var(--radius-sm); padding: 16px;">
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
            <span style="font-size: 1.1rem;">🔔</span>
            <h4 style="font-size: 0.95rem; font-weight: 600; color: var(--color-clay-dark);">
              Things You Don't Know (Needs Your Input)
            </h4>
          </div>
          <p style="font-size: 0.85rem; color: var(--color-text-secondary); margin-bottom: 10px;">
            The agent detected items requiring your confirmation before this application can be marked <strong>Ready</strong>:
          </p>
          <ul style="padding-left: 20px; font-size: 0.85rem; color: var(--color-text-primary); line-height: 1.6;">
            ${unusualReqs.map(req => `<li><strong>Unusual Requirement:</strong> ${req} (not on standard profile)</li>`).join('')}
            ${listing.location_mode === 'unknown' ? `<li><strong>Location Mode:</strong> Not stated in listing — confirm remote/onsite policy</li>` : ''}
          </ul>
        </div>
      ` : ''}

      <!-- Description Excerpt -->
      <div>
        <h4 style="font-size: 0.95rem; font-weight: 600; margin-bottom: 8px;">Opportunity Description</h4>
        <div style="background: var(--color-bg-card); border: 1px solid var(--color-border-subtle); border-radius: var(--radius-sm); padding: 14px; max-height: 180px; overflow-y: auto; font-size: 0.88rem; color: var(--color-text-secondary); line-height: 1.6; white-space: pre-wrap;">
${listing.raw_description || 'No description text provided.'}
        </div>
      </div>

      <!-- Application Draft Workspace (Draft-Then-Approve) -->
      <div style="border-top: 1px solid var(--color-border-subtle); padding-top: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <div>
            <h4 class="serif-title" style="font-size: 1.15rem;">Application Draft</h4>
            <p style="font-size: 0.82rem; color: var(--color-text-muted);">Draft-then-approve: customize and review before saving to your Vault.</p>
          </div>
          <button type="button" id="generate-draft-btn" class="btn btn-secondary btn-sm" style="gap: 6px;">
            ✨ Generate with Groq
          </button>
        </div>

        <textarea
          id="draft-cover-letter"
          class="form-textarea"
          style="width: 100%; min-height: 140px; font-size: 0.88rem; line-height: 1.6; margin-bottom: 12px;"
          placeholder="Click 'Generate with Groq' or compose your tailored application note here..."
        >${currentCoverLetter}</textarea>

        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <label style="font-size: 0.85rem; font-weight: 600;">Status:</label>
            <select id="draft-state-select" class="form-select" style="padding: 6px 10px; font-size: 0.85rem;">
              <option value="${ApplicationState.SHORTLISTED}" ${currentState === ApplicationState.SHORTLISTED ? 'selected' : ''}>Shortlisted</option>
              <option value="${ApplicationState.DRAFTING}" ${currentState === ApplicationState.DRAFTING ? 'selected' : ''}>Drafting</option>
              <option value="${ApplicationState.NEEDS_INPUT}" ${currentState === ApplicationState.NEEDS_INPUT ? 'selected' : ''}>Needs Input</option>
              <option value="${ApplicationState.READY}" ${currentState === ApplicationState.READY ? 'selected' : ''}>Ready to Apply</option>
              <option value="${ApplicationState.SUBMITTED}" ${currentState === ApplicationState.SUBMITTED ? 'selected' : ''}>Submitted</option>
            </select>
          </div>

          <div style="display: flex; gap: 8px; align-items: center;">
            ${listing.source_urls?.[0] ? `
              <a href="${listing.source_urls[0]}" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="text-decoration: none;">
                ↗ Direct Link
              </a>
              <button type="button" id="apply-autofill-btn" class="btn btn-primary btn-sm" style="gap: 6px;">
                ⚡ Apply on Site (Autofill) ↗
              </button>
            ` : ''}
            <button type="button" id="save-draft-btn" class="btn btn-secondary btn-sm">
              Save to Draft Vault
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modalBackdrop);

  // Close handlers
  const closeBtn = modalBackdrop.querySelector('#close-modal-btn');
  function closeModal() {
    modalBackdrop.remove();
  }
  closeBtn.onclick = closeModal;
  modalBackdrop.onclick = (e) => {
    if (e.target === modalBackdrop) closeModal();
  };

  // Generate Draft with Groq Handler
  const generateBtn = modalBackdrop.querySelector('#generate-draft-btn');
  const textarea = modalBackdrop.querySelector('#draft-cover-letter');
  const stateSelect = modalBackdrop.querySelector('#draft-state-select');

  generateBtn.onclick = async () => {
    if (!profile) {
      alert('Please complete your profile in onboarding first.');
      return;
    }
    const apiKey = Storage.getGroqApiKey();
    if (!apiKey) {
      const enterKey = prompt('Enter your Groq API key (or set it in Onboarding):');
      if (enterKey && enterKey.trim()) {
        Storage.saveGroqApiKey(enterKey.trim());
      } else {
        return;
      }
    }

    generateBtn.disabled = true;
    generateBtn.textContent = '✨ Generating draft...';

    const draftRes = await generateDraftWithGroq({ profile, listing });
    generateBtn.disabled = false;
    generateBtn.textContent = '✨ Re-generate';

    if (draftRes.ok && draftRes.coverLetter) {
      textarea.value = draftRes.coverLetter;
      stateSelect.value = ApplicationState.DRAFTING;
    } else {
      alert(`Failed to generate with Groq: ${draftRes.error || 'Check your API key or network connection.'}`);
    }
  };

  // Apply on Site & Launch Autofill Assistant
  const applyAutofillBtn = modalBackdrop.querySelector('#apply-autofill-btn');
  if (applyAutofillBtn && listing.source_urls?.[0]) {
    applyAutofillBtn.onclick = (e) => {
      e.stopPropagation();
      const targetUrl = listing.source_urls[0];
      const updatedLetter = textarea.value.trim();
      const updatedState = stateSelect.value;

      // CRITICAL: Call window.open IMMEDIATELY & SYNCHRONOUSLY to prevent popup blockers from suppressing it!
      window.open(targetUrl, '_blank', 'noopener,noreferrer');

      // Save draft state
      const app = existingDraft || createApplication(listing, updatedState, { coverLetter: updatedLetter });
      app.draft_content.cover_letter = updatedLetter;
      Storage.saveDraft(app);

      // Copy cover letter to clipboard for instant pasting
      if (updatedLetter) {
        navigator.clipboard?.writeText(updatedLetter).catch(() => {});
      }

      // Close current modal and launch the Autofill Assistant
      closeModal();
      openAutofillAssistantModal(profile, app, targetUrl, onUpdate);
    };
  }

  // Save to Draft Vault Handler
  const saveBtn = modalBackdrop.querySelector('#save-draft-btn');
  saveBtn.onclick = () => {
    const updatedLetter = textarea.value.trim();
    const updatedState = stateSelect.value;

    const app = existingDraft || createApplication(listing, updatedState);
    app.state = updatedState;
    app.draft_content.cover_letter = updatedLetter;

    Storage.saveDraft(app);
    saveBtn.textContent = '✓ Saved in Vault!';
    setTimeout(() => {
      saveBtn.textContent = 'Save to Draft Vault';
      closeModal();
      if (onUpdate) onUpdate();
    }, 600);
  };
}

/**
 * Opens the interactive Browser Autofill Assistant modal.
 * Provides the 1-Click Form Filler Bookmarklet and individual credential copiers.
 * @param {import('../models.js').Profile} profile
 * @param {import('../models.js').Application} app
 * @param {string} targetUrl
 * @param {Function} [onUpdate]
 */
export function openAutofillAssistantModal(profile, app, targetUrl, onUpdate) {
  const assistantBackdrop = document.createElement('div');
  assistantBackdrop.className = 'modal-backdrop';

  const bookmarkletCode = generateAutofillBookmarklet(profile, app);
  const letter = app?.draft_content?.cover_letter || '';

  assistantBackdrop.innerHTML = `
    <div class="modal-content" style="max-width: 640px;">
      <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; border-bottom: 1px solid var(--color-border-subtle); padding-bottom: 14px;">
        <div>
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
            <span style="font-size: 1.3rem;">⚡</span>
            <h3 class="serif-title" style="font-size: 1.4rem;">Application Autofill Assistant</h3>
          </div>
          <p style="font-size: 0.85rem; color: var(--color-text-secondary);">
            Official site for <strong>${app.listing.title}</strong> at <strong>${app.listing.organization}</strong>:
            <br/>
            <a href="${targetUrl}" target="_blank" rel="noopener noreferrer" style="color: var(--color-brand); font-weight: 600; text-decoration: underline; word-break: break-all;">
              ${targetUrl} ↗
            </a>
          </p>
        </div>
        <button type="button" id="close-assistant-btn" class="btn-subtle" style="font-size: 1.6rem; line-height: 1; cursor: pointer;">×</button>
      </div>

      <!-- 1. The 1-Click Form Filler Bookmarklet -->
      <div style="background: var(--color-sage-wash); border: 1px solid var(--color-match-border); border-radius: var(--radius-sm); padding: 18px; margin-bottom: 18px;">
        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
          <h4 style="font-size: 1rem; font-weight: 700; color: var(--color-sage-deep);">
            ⚡ 1-Click Browser Form-Filler (Applies on your behalf)
          </h4>
          <span class="listing-tag" style="background: var(--color-match-pill); color: var(--color-match-text);">Works on any site</span>
        </div>
        <p style="font-size: 0.84rem; color: var(--color-text-secondary); margin-bottom: 12px; line-height: 1.5;">
          Drag this button up to your browser's <strong>Bookmarks Bar</strong> (press <code>Ctrl+Shift+B</code> to show bookmarks bar). When on the application page, click it once to automatically populate your Name, Email, Phone, CV, and Tailored Cover Letter!
        </p>

        <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
          <a
            href="${bookmarkletCode}"
            class="btn btn-primary btn-sm"
            style="cursor: grab; gap: 6px; padding: 9px 16px; font-weight: 700;"
            onclick="event.preventDefault(); alert('Drag this button to your browser bookmarks bar (Ctrl+Shift+B)! Once on the external application page, click your bookmark to autofill every field with your credentials and cover letter.');"
          >
            ⚡ Drag to Bookmarks: Auto-Fill Application
          </a>
          <button type="button" id="copy-bookmarklet-script-btn" class="btn btn-secondary btn-sm">
            📋 Copy Console Script
          </button>
        </div>
        <div id="script-copied-notice" style="font-size: 0.8rem; color: var(--color-match-text); margin-top: 6px; display: none;">
          ✓ Console script copied! You can paste it into your browser DevTools Console (F12 -> Console) on any application site to auto-fill.
        </div>
      </div>

      <!-- 2. One-Click Quick Credential Copiers -->
      <div style="margin-bottom: 18px;">
        <h4 style="font-size: 0.9rem; font-weight: 600; margin-bottom: 8px;">
          Quick-Copy Credentials (Click to copy individual fields):
        </h4>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.82rem;">
          <button type="button" class="btn btn-secondary btn-sm copy-cred-btn" data-value="${profile.name}">
            📋 Name: ${profile.name}
          </button>
          <button type="button" class="btn btn-secondary btn-sm copy-cred-btn" data-value="${profile.email}">
            📋 Email: ${profile.email}
          </button>
          ${profile.phone ? `
            <button type="button" class="btn btn-secondary btn-sm copy-cred-btn" data-value="${profile.phone}">
              📋 Phone: ${profile.phone}
            </button>
          ` : ''}
          ${profile.portfolio_url ? `
            <button type="button" class="btn btn-secondary btn-sm copy-cred-btn" data-value="${profile.portfolio_url}">
              📋 Portfolio URL
            </button>
          ` : ''}
          ${profile.github_url ? `
            <button type="button" class="btn btn-secondary btn-sm copy-cred-btn" data-value="${profile.github_url}">
              📋 GitHub URL
            </button>
          ` : ''}
          ${profile.cv_text ? `
            <button type="button" class="btn btn-secondary btn-sm copy-cred-btn" data-value="${profile.cv_text}">
              📋 Full CV Text
            </button>
          ` : ''}
          <button type="button" class="btn btn-secondary btn-sm copy-cred-btn" data-value="${letter}" style="border-color: var(--color-sage-deep); font-weight: 700; color: var(--color-sage-deep);">
            📋 Tailored Cover Letter (${letter ? 'Ready' : 'Empty'})
          </button>
        </div>
        <div id="cred-copy-feedback" style="font-size: 0.8rem; color: var(--color-match-text); margin-top: 6px; min-height: 18px;"></div>
      </div>

      <!-- Footer -->
      <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--color-border-subtle); padding-top: 14px; flex-wrap: wrap; gap: 10px;">
        <a href="${targetUrl}" id="reopen-site-btn" target="_blank" rel="noopener noreferrer" class="btn btn-secondary btn-sm" style="text-decoration: none;">
          Re-open Official Page ↗
        </a>
        <div style="display: flex; gap: 8px;">
          <button type="button" id="mark-applied-btn" class="btn btn-primary btn-sm">
            ✓ Mark as Submitted in Vault
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(assistantBackdrop);

  // Close handler
  function closeAssistant() {
    assistantBackdrop.remove();
  }
  assistantBackdrop.querySelector('#close-assistant-btn').onclick = closeAssistant;
  assistantBackdrop.onclick = (e) => {
    if (e.target === assistantBackdrop) closeAssistant();
  };

  // Copy Bookmarklet Script button
  const copyScriptBtn = assistantBackdrop.querySelector('#copy-bookmarklet-script-btn');
  const copiedNotice = assistantBackdrop.querySelector('#script-copied-notice');
  copyScriptBtn.onclick = async () => {
    const rawScript = getAutofillScript(profile, app);
    try {
      await navigator.clipboard.writeText(rawScript);
      copiedNotice.style.display = 'block';
      setTimeout(() => { copiedNotice.style.display = 'none'; }, 4000);
    } catch {}
  };

  // Quick Credential Copiers
  const feedbackEl = assistantBackdrop.querySelector('#cred-copy-feedback');
  assistantBackdrop.querySelectorAll('.copy-cred-btn').forEach(btn => {
    btn.onclick = async () => {
      const val = btn.getAttribute('data-value');
      if (!val) return;
      try {
        await navigator.clipboard.writeText(val);
        feedbackEl.textContent = `✓ Copied "${btn.textContent.replace('📋', '').trim()}" to clipboard!`;
        setTimeout(() => { feedbackEl.textContent = ''; }, 2500);
      } catch {}
    };
  });

  // Re-open page button
  const reopenBtn = assistantBackdrop.querySelector('#reopen-site-btn');
  if (reopenBtn) {
    reopenBtn.onclick = () => {
      window.open(targetUrl, '_blank', 'noopener,noreferrer');
    };
  }

  // Mark Submitted button
  assistantBackdrop.querySelector('#mark-applied-btn').onclick = () => {
    app.state = ApplicationState.SUBMITTED;
    app.submitted_at = new Date().toISOString();
    Storage.saveDraft(app);
    closeAssistant();
    if (onUpdate) onUpdate();
  };
}

