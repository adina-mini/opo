/**
 * @file views/profile_view.js
 * Profile, Preferences & Answer Library view for opo — Personal Opportunity Agent.
 */

import { Storage } from '../db.js';
import { testGroqApiKey } from '../groq.js';
import { TEST_FIXTURES } from '../../../tests/fixtures/sample_opportunities.js';
import { createApplication, ApplicationState } from '../models.js';

export function renderProfileView(container, onNavigate) {
  const profile = Storage.getProfile();
  const groqKey = Storage.getGroqApiKey();
  const answers = Storage.getAnswerLibrary();

  if (!profile) {
    onNavigate('onboarding');
    return;
  }

  container.innerHTML = `
    <div style="max-width: 760px; margin: 0 auto;">
      <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 24px; flex-wrap: wrap; gap: 12px;">
        <div>
          <h2 class="serif-title" style="font-size: 1.75rem; margin-bottom: 4px;">${profile.name}</h2>
          <p style="font-size: 0.85rem; color: var(--color-text-muted);">${profile.email}${profile.phone ? ` • 📞 ${profile.phone}` : ''}</p>
        </div>
        <button id="edit-profile-btn" class="btn btn-secondary btn-sm">Edit Full Profile</button>
      </div>

      <!-- Skills Card -->
      <div class="card" style="margin-bottom: 20px;">
        <h3 class="serif-title" style="margin-bottom: 12px; font-size: 1.15rem;">Skills & Qualifications</h3>
        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
          ${(profile.skills || []).map(s => `
            <span class="listing-tag" style="background: var(--color-bg-subtle); padding: 5px 12px;">
              <strong>${s.name}</strong>
              <span style="color: var(--color-text-muted); font-size: 0.75rem;">(${s.level})</span>
            </span>
          `).join('')}
        </div>
      </div>

      <!-- CV & Verified Links Card -->
      <div class="card" style="margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px;">
          <h3 class="serif-title" style="font-size: 1.15rem;">CV, Resume & Credentials</h3>
          <span style="font-size: 0.8rem; color: var(--color-sage-deep); font-weight: 600;">Autonomous drafting source</span>
        </div>
        ${profile.cv_text ? `
          <div style="background: var(--color-bg-subtle); border-radius: var(--radius-sm); padding: 12px 14px; font-size: 0.85rem; color: var(--color-text-secondary); line-height: 1.6; max-height: 120px; overflow-y: auto; white-space: pre-wrap; margin-bottom: 12px; border: 1px solid var(--color-border-subtle);">
${profile.cv_text}
          </div>
        ` : `
          <p style="font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 12px;">No CV text saved yet. Click "Edit Full Profile" to add your resume details for automatic application drafting.</p>
        `}
        <div style="display: flex; flex-wrap: wrap; gap: 14px; font-size: 0.85rem;">
          ${profile.portfolio_url ? `<span>🌐 <strong>Portfolio:</strong> <a href="${profile.portfolio_url}" target="_blank" rel="noopener">${profile.portfolio_url}</a></span>` : ''}
          ${profile.github_url ? `<span>💻 <strong>GitHub:</strong> <a href="${profile.github_url}" target="_blank" rel="noopener">${profile.github_url}</a></span>` : ''}
          ${profile.linkedin_url ? `<span>💼 <strong>LinkedIn:</strong> <a href="${profile.linkedin_url}" target="_blank" rel="noopener">${profile.linkedin_url}</a></span>` : ''}
        </div>
      </div>

      <!-- Preferences Card -->
      <div class="card" style="margin-bottom: 20px;">
        <h3 class="serif-title" style="margin-bottom: 12px; font-size: 1.15rem;">Matching Preferences</h3>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; font-size: 0.88rem;">
          <div>
            <span style="color: var(--color-text-muted); display: block;">Remote Work:</span>
            <strong>${profile.preferences.remote_ok ? 'Yes, preferred' : 'No'}</strong>
          </div>
          <div>
            <span style="color: var(--color-text-muted); display: block;">Relocation:</span>
            <strong>${profile.preferences.relocate_ok ? 'Willing to relocate' : 'No relocation'}</strong>
          </div>
          <div>
            <span style="color: var(--color-text-muted); display: block;">Min Compensation:</span>
            <strong>${profile.preferences.min_compensation ? `$${profile.preferences.min_compensation}/mo` : 'Unpaid Welcomed'}</strong>
          </div>
          <div>
            <span style="color: var(--color-text-muted); display: block;">Min Match Score:</span>
            <strong>${Math.round(profile.preferences.min_match_score * 100)}%</strong>
          </div>
        </div>
      </div>

      <!-- Answer Library (Recurring Application Questions) -->
      <div class="card" style="margin-bottom: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <div>
            <h3 class="serif-title" style="font-size: 1.15rem;">Answer Library</h3>
            <p style="font-size: 0.82rem; color: var(--color-text-muted);">
              Reusable answers to recurring application questions, pulled by the cover letter generator.
            </p>
          </div>
        </div>

        <div id="answer-items-container" style="display: flex; flex-direction: column; gap: 12px; margin-bottom: 16px;">
          ${Object.entries(answers).length === 0 ? `
            <p style="font-size: 0.85rem; color: var(--color-text-muted);">
              No answers saved yet. Add common prompts like "Why this field" or "Leadership example".
            </p>
          ` : Object.entries(answers).map(([key, text]) => `
            <div style="background: var(--color-bg-subtle); border-radius: var(--radius-sm); padding: 12px 14px; border: 1px solid var(--color-border-subtle);">
              <div style="font-weight: 600; font-size: 0.85rem; margin-bottom: 4px; color: var(--color-sage-deep); text-transform: capitalize;">
                ${key.replace(/_/g, ' ')}
              </div>
              <p style="font-size: 0.86rem; color: var(--color-text-secondary); line-height: 1.5;">${text}</p>
            </div>
          `).join('')}
        </div>

        <!-- Add Answer Input -->
        <div style="background: var(--color-bg-subtle); border-radius: var(--radius-sm); padding: 14px; border: 1px dashed var(--color-border-strong);">
          <div style="display: flex; gap: 8px; margin-bottom: 8px;">
            <input type="text" id="new-answer-key" class="form-input" placeholder="Question key (e.g. why_this_field, leadership_story)" style="flex: 1;" />
            <button type="button" id="save-answer-btn" class="btn btn-secondary btn-sm">Save to Library</button>
          </div>
          <textarea id="new-answer-text" class="form-textarea" placeholder="Your thoughtful response..." style="width: 100%; min-height: 70px;"></textarea>
        </div>
      </div>

      <!-- Groq API Key & Zero-Knowledge Storage Settings -->
      <div class="card" style="margin-bottom: 20px;">
        <h3 class="serif-title" style="margin-bottom: 8px; font-size: 1.15rem;">Groq API Key</h3>
        <p style="font-size: 0.82rem; color: var(--color-text-muted); margin-bottom: 12px;">
          Stored locally in your browser. Used for on-demand skill extraction and cover letter drafting.
        </p>
        <div style="display: flex; gap: 8px; margin-bottom: 6px;">
          <input type="password" id="profile-groq-key" class="form-input" value="${groqKey}" placeholder="gsk_..." style="flex: 1;" />
          <button type="button" id="save-groq-key-btn" class="btn btn-secondary btn-sm">Update Key</button>
        </div>
        <div id="profile-key-feedback" style="font-size: 0.8rem;"></div>
      </div>

      <!-- Data Management & Offline Demo Fixtures -->
      <div class="card" style="margin-bottom: 30px;">
        <h3 class="serif-title" style="margin-bottom: 8px; font-size: 1.15rem;">Data & Privacy</h3>
        <p style="font-size: 0.85rem; color: var(--color-text-muted); margin-bottom: 16px;">
          Everything is local-first. You can export a full JSON backup of your profile and vault anytime.
        </p>

        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
          <button id="export-json-btn" class="btn btn-secondary btn-sm">Export Data Backup (JSON)</button>
          <button id="load-test-fixtures-btn" class="btn btn-secondary btn-sm" style="color: var(--color-clay-dark);">
            🧪 Load Sandbox Test Fixtures (Offline Demo)
          </button>
          <button id="reset-data-btn" class="btn btn-subtle btn-sm" style="color: var(--color-fee-text); margin-left: auto;">
            Reset All Local Data
          </button>
        </div>
      </div>
    </div>
  `;

  // Edit profile button
  container.querySelector('#edit-profile-btn').onclick = () => onNavigate('onboarding');

  // Save answer handler
  const answerKeyInput = container.querySelector('#new-answer-key');
  const answerTextInput = container.querySelector('#new-answer-text');
  const saveAnswerBtn = container.querySelector('#save-answer-btn');

  saveAnswerBtn.onclick = () => {
    const key = answerKeyInput.value.trim().toLowerCase().replace(/\s+/g, '_');
    const text = answerTextInput.value.trim();
    if (key && text) {
      Storage.saveAnswer(key, text);
      renderProfileView(container, onNavigate);
    }
  };

  // Update Groq Key handler
  const groqInput = container.querySelector('#profile-groq-key');
  const saveKeyBtn = container.querySelector('#save-groq-key-btn');
  const keyFeedback = container.querySelector('#profile-key-feedback');

  saveKeyBtn.onclick = async () => {
    const val = groqInput.value.trim();
    saveKeyBtn.disabled = true;
    keyFeedback.innerHTML = '<span style="color: var(--color-text-muted);">Testing key...</span>';
    const test = await testGroqApiKey(val);
    saveKeyBtn.disabled = false;

    if (test.ok) {
      Storage.saveGroqApiKey(val);
      keyFeedback.innerHTML = '<span style="color: var(--color-match-text);">✓ Valid Groq API key saved locally.</span>';
    } else {
      keyFeedback.innerHTML = `<span style="color: var(--color-fee-text);">✗ Error: ${test.error}</span>`;
    }
  };

  // Export JSON backup
  container.querySelector('#export-json-btn').onclick = () => {
    const data = Storage.exportData();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `opo-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Load sandbox test fixtures for testing UI features without external network
  container.querySelector('#load-test-fixtures-btn').onclick = () => {
    if (confirm('Load offline test fixtures (nursing fellowship, design residency, scholarship with fee) into your Draft Vault for offline inspection?')) {
      for (const fix of TEST_FIXTURES) {
        const app = createApplication(fix, ApplicationState.SHORTLISTED);
        Storage.saveDraft(app);
      }
      alert('Loaded 6 test fixtures into your Draft Vault. They are clearly tagged with [DEMO FIXTURE].');
      onNavigate('vault');
    }
  };

  // Reset all data
  container.querySelector('#reset-data-btn').onclick = () => {
    if (confirm('Are you sure you want to erase all local profile, drafts, and key data? This cannot be undone.')) {
      Storage.clearAll();
      window.location.reload();
    }
  };
}
