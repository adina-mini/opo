/**
 * @file views/onboarding.js
 * Onboarding and Profile Intake view for opo — Personal Opportunity Agent.
 *
 * 3-Step Wizard:
 * 1. Groq API Key with expandable "How do I get this?" guide + 1-click test button.
 *    (Clear notice that the key is stored strictly in browser localStorage).
 * 2. CV Upload — PDF or plain text. Extracted text is sent directly to Groq's API
 *    (zero-knowledge: never touches a developer server) for profile field extraction.
 * 3. Personal Information (Name, Email, LinkedIn), Skills, Education, Preferences —
 *    pre-filled from CV extraction when available, fully editable.
 */

import { Storage } from '../db.js';
import {
  createProfile,
  createSkill,
  createEducation,
  createPreferences,
  SkillLevel,
  OpportunityType
} from '../models.js';
import { testGroqApiKey, extractProfileFromCV } from '../groq.js';

/**
 * Extract text from a PDF file using pdfjs-dist (runs entirely in the browser).
 * @param {File} file
 * @returns {Promise<string>}
 */
async function extractTextFromPDF(file) {
  const pdfjsLib = await import('pdfjs-dist');

  // Configure worker — Vite resolves the ?url import to a proper asset path
  const workerUrl = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl.default;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const pages = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map(item => item.str).join(' ');
    pages.push(text);
  }

  return pages.join('\n\n');
}

export function renderOnboarding(container, onComplete) {
  const existingProfile = Storage.getProfile();
  const existingKey = Storage.getGroqApiKey();

  // Working state for the form — pre-populated from existing profile if editing
  let skills = existingProfile?.skills ? [...existingProfile.skills] : [
    createSkill('Python', SkillLevel.ADVANCED, 'programming'),
    createSkill('Data Analysis', SkillLevel.INTERMEDIATE, 'analytics')
  ];

  let education = existingProfile?.education ? [...existingProfile.education] : [];

  // Extracted CV data (populated by step 2 if successful)
  let extractedProfile = null;

  // Current wizard step (0-indexed)
  let currentStep = 0;

  container.innerHTML = `
    <div class="card" style="max-width: 680px; margin: 0 auto; padding: 36px 28px;">
      <div style="text-align: center; margin-bottom: 12px;">
        <div class="brand-icon" style="margin: 0 auto 12px; width: 52px; height: 52px; font-size: 26px;">🌱</div>
        <h1 class="serif-title" style="font-size: 2rem; margin-bottom: 6px;">Welcome to opo</h1>
        <p style="color: var(--color-text-secondary); max-width: 460px; margin: 0 auto;">
          Your personal opportunity agent. Set up your profile once, and receive daily curated opportunities prepared for your review.
        </p>
      </div>

      <!-- Step Indicator -->
      <div class="onboarding-steps">
        <div class="onboarding-step-dot active" data-step="0"></div>
        <div class="onboarding-step-line" data-line="0"></div>
        <div class="onboarding-step-dot" data-step="1"></div>
        <div class="onboarding-step-line" data-line="1"></div>
        <div class="onboarding-step-dot" data-step="2"></div>
      </div>
      <div class="onboarding-step-labels">
        <span class="onboarding-step-label active" data-label="0">API Key</span>
        <span class="onboarding-step-label" data-label="1">Resume</span>
        <span class="onboarding-step-label" data-label="2">Profile</span>
      </div>

      <!-- ============================================================ -->
      <!-- STEP 1: Groq API Key Setup                                   -->
      <!-- ============================================================ -->
      <div class="onboarding-panel visible" id="step-0">
        <div style="background: var(--color-bg-subtle); border-radius: var(--radius-sm); padding: 18px 20px; border: 1px solid var(--color-border-subtle);">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <label class="form-label" for="groq-key-input" style="font-weight: 600;">Groq API Key (Optional but Recommended)</label>
            <button type="button" id="toggle-key-help" class="btn-subtle" style="font-size: 0.8rem; padding: 2px 6px;">How do I get this? ▾</button>
          </div>
          <p class="form-helper" style="margin-bottom: 12px;">
            Powers LLM skill extraction, CV parsing, and tailored cover letter drafts.
            <strong>Zero-Knowledge:</strong> Stored strictly in your own browser's local storage and never sent to any developer server.
          </p>

          <div id="key-help-box" style="display: none; background: var(--color-bg-card); border-radius: var(--radius-xs); padding: 12px; margin-bottom: 12px; font-size: 0.82rem; border: 1px solid var(--color-border-subtle);">
            <p style="margin-bottom: 6px;"><strong>How to get a free Groq API key:</strong></p>
            <ol style="padding-left: 18px; margin-bottom: 8px; line-height: 1.5;">
              <li>Go to <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com/keys</a> and sign in.</li>
              <li>Click <strong>Create API Key</strong> and copy the generated key string.</li>
              <li>Paste it below. Groq provides a generous free tier with zero charge.</li>
            </ol>
            <p style="color: var(--color-text-muted);">Direct browser connection: calls go straight from your browser to Groq's API with CORS headers.</p>
          </div>

          <div style="display: flex; gap: 8px;">
            <input
              type="password"
              id="groq-key-input"
              class="form-input"
              placeholder="gsk_..."
              style="flex: 1;"
              value="${existingKey}"
            />
            <button type="button" id="test-key-btn" class="btn btn-secondary btn-sm" style="white-space: nowrap;">
              Test Key
            </button>
          </div>
          <div id="key-test-feedback" style="font-size: 0.8rem; margin-top: 6px;"></div>
        </div>

        <div class="onboarding-nav">
          <button type="button" id="step0-next" class="btn btn-primary" style="padding: 10px; font-size: 0.95rem;">
            Continue →
          </button>
        </div>
      </div>

      <!-- ============================================================ -->
      <!-- STEP 2: CV Upload                                            -->
      <!-- ============================================================ -->
      <div class="onboarding-panel" id="step-1">
        <h3 class="serif-title" style="text-align: center; margin-bottom: 6px; font-size: 1.15rem;">Upload Your Resume</h3>
        <p class="form-helper" style="text-align: center; margin-bottom: 18px; max-width: 440px; margin-left: auto; margin-right: auto;">
          We'll extract your name, skills, and education to pre-fill the profile form. Your CV text is sent
          <strong>only to Groq's API</strong> from your browser — never to any developer server.
        </p>

        <div class="cv-upload-zone" id="cv-upload-zone">
          <input type="file" id="cv-file-input" accept=".pdf,.txt,.text" style="display: none;" />
          <span class="cv-upload-icon">📄</span>
          <div class="cv-upload-label">Drop your resume here, or click to browse</div>
          <div class="cv-upload-sublabel">PDF or plain text • Processed entirely in your browser</div>
        </div>

        <div id="cv-file-name" style="font-size: 0.82rem; color: var(--color-text-muted); margin-top: 8px; text-align: center;"></div>

        <div style="text-align: center; margin-top: 12px; font-size: 0.82rem; color: var(--color-text-muted);">— or paste your resume text —</div>
        <textarea
          id="cv-paste-text"
          class="form-textarea"
          rows="4"
          placeholder="Paste your CV / resume text here..."
          style="width: 100%; font-size: 0.85rem; line-height: 1.5; margin-top: 8px;"
        ></textarea>

        <div id="cv-extract-status" class="cv-extract-status"></div>

        <div class="onboarding-nav">
          <button type="button" id="step1-back" class="btn btn-secondary" style="padding: 10px; font-size: 0.95rem;">
            ← Back
          </button>
          <button type="button" id="step1-extract" class="btn btn-primary" style="padding: 10px; font-size: 0.95rem;">
            Extract & Continue →
          </button>
        </div>
        <div style="text-align: center; margin-top: 8px;">
          <button type="button" id="step1-skip" class="btn-subtle" style="font-size: 0.82rem; color: var(--color-text-muted); padding: 4px 8px;">
            Skip — I'll fill it out manually
          </button>
        </div>
      </div>

      <!-- ============================================================ -->
      <!-- STEP 3: Profile Form (pre-filled from CV or blank)           -->
      <!-- ============================================================ -->
      <div class="onboarding-panel" id="step-2">
        <form id="onboarding-form">
          <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px;">
            <h3 class="serif-title" style="font-size: 1.15rem;">1. Personal Information</h3>
            <button type="button" id="quick-fill-btn" class="btn btn-secondary btn-sm" style="font-size: 0.72rem; padding: 3px 10px;">
              ⚡ Quick Fill (Testing)
            </button>
          </div>
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; margin-bottom: 14px;">
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label" for="user-name">Full Name *</label>
              <input type="text" id="user-name" class="form-input" required value="${existingProfile?.name || ''}" placeholder="e.g. Alex Chen" />
            </div>
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label" for="user-email">Email Address *</label>
              <input type="email" id="user-email" class="form-input" required value="${existingProfile?.email || ''}" placeholder="alex@example.com" />
            </div>
            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label" for="user-phone">Phone Number</label>
              <input type="tel" id="user-phone" class="form-input" value="${existingProfile?.phone || ''}" placeholder="+1 (555) 000-0000" />
            </div>
          </div>

          <!-- CV, Resume & Credentials -->
          <div style="margin-bottom: 24px;">
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
              <h3 class="serif-title" style="font-size: 1.15rem;">2. CV, Resume & Credentials</h3>
              <span class="form-helper" style="color: var(--color-sage-deep); font-weight: 600;">Autonomous drafting foundation</span>
            </div>
            <p class="form-helper" style="margin-bottom: 10px;">
              Paste your CV text, publications, and background details so the agent can automatically assemble tailored application packages with your genuine credentials.
            </p>
            <textarea
              id="user-cv-text"
              class="form-textarea"
              rows="5"
              placeholder="Paste your CV highlights, past experience, research/projects, and credentials here..."
              style="width: 100%; font-size: 0.85rem; line-height: 1.5; margin-bottom: 12px;"
            >${existingProfile?.cv_text || ''}</textarea>

            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px;">
              <div>
                <label class="form-label" for="user-portfolio" style="font-size: 0.78rem;">Portfolio / Website</label>
                <input type="url" id="user-portfolio" class="form-input" placeholder="https://alex.dev" value="${existingProfile?.portfolio_url || ''}" />
              </div>
              <div>
                <label class="form-label" for="user-github" style="font-size: 0.78rem;">GitHub Profile</label>
                <input type="url" id="user-github" class="form-input" placeholder="https://github.com/alex" value="${existingProfile?.github_url || ''}" />
              </div>
              <div>
                <label class="form-label" for="user-linkedin" style="font-size: 0.78rem;">LinkedIn Profile</label>
                <input type="text" id="user-linkedin" class="form-input" placeholder="https://linkedin.com/in/alex" value="${existingProfile?.linkedin_url || ''}" />
              </div>
            </div>
          </div>

          <!-- Skills -->
          <div style="margin-bottom: 24px;">
            <div style="display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px;">
              <h3 class="serif-title" style="font-size: 1.15rem;">3. Skills & Competencies</h3>
              <span class="form-helper">Core 80% matching signal</span>
            </div>
            <p class="form-helper" style="margin-bottom: 12px;">
              Any domain: healthcare triage, UI design, financial modeling, teaching, Python, data analysis, etc.
            </p>

            <div style="display: flex; gap: 8px; margin-bottom: 12px;">
              <input type="text" id="new-skill-name" class="form-input" placeholder="Add a skill or qualification..." style="flex: 1;" />
              <select id="new-skill-level" class="form-select" style="width: 140px;">
                <option value="${SkillLevel.BEGINNER}">Beginner</option>
                <option value="${SkillLevel.INTERMEDIATE}" selected>Intermediate</option>
                <option value="${SkillLevel.ADVANCED}">Advanced</option>
              </select>
              <button type="button" id="add-skill-btn" class="btn btn-secondary btn-sm">Add</button>
            </div>

            <div id="skills-list" style="display: flex; flex-wrap: wrap; gap: 8px; min-height: 42px; padding: 8px; background: var(--color-bg-subtle); border-radius: var(--radius-sm); border: 1px solid var(--color-border-subtle);">
            </div>
          </div>

          <!-- Education -->
          <div style="margin-bottom: 24px;">
            <h3 class="serif-title" style="margin-bottom: 8px; font-size: 1.15rem;">4. Education (Optional)</h3>
            <div style="display: grid; grid-template-columns: 1.5fr 1.5fr 1fr; gap: 10px;">
              <input type="text" id="edu-degree" class="form-input" placeholder="Degree / Program" value="${existingProfile?.education?.[0]?.degree || ''}" />
              <input type="text" id="edu-institution" class="form-input" placeholder="Institution / University" value="${existingProfile?.education?.[0]?.institution || ''}" />
              <input type="number" id="edu-gpa" class="form-input" placeholder="GPA (e.g. 3.8)" step="0.01" value="${existingProfile?.education?.[0]?.gpa || ''}" />
            </div>
          </div>

          <!-- Preferences -->
          <div style="margin-bottom: 28px;">
            <h3 class="serif-title" style="margin-bottom: 8px; font-size: 1.15rem;">5. Opportunity Preferences</h3>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 14px;">
              <div class="form-group" style="margin-bottom: 0;">
                <label class="form-label" for="pref-countries">Accepted Countries</label>
                <input type="text" id="pref-countries" class="form-input" placeholder="e.g. US, Canada, Remote (empty = any)" value="${existingProfile?.preferences?.countries?.join(', ') || ''}" />
              </div>
              <div class="form-group" style="margin-bottom: 0;">
                <label class="form-label" for="pref-min-comp">Min Monthly Compensation ($)</label>
                <input type="number" id="pref-min-comp" class="form-input" placeholder="Leave empty for unpaid ok" value="${existingProfile?.preferences?.min_compensation ?? ''}" />
              </div>
            </div>

            <div style="display: flex; gap: 18px; flex-wrap: wrap; margin-bottom: 14px;">
              <label style="display: flex; align-items: center; gap: 8px; font-size: 0.88rem; cursor: pointer;">
                <input type="checkbox" id="pref-remote-ok" ${existingProfile?.preferences?.remote_ok !== false ? 'checked' : ''} />
                Remote opportunities are welcome
              </label>
              <label style="display: flex; align-items: center; gap: 8px; font-size: 0.88rem; cursor: pointer;">
                <input type="checkbox" id="pref-relocate-ok" ${existingProfile?.preferences?.relocate_ok ? 'checked' : ''} />
                Willing to relocate for onsite roles
              </label>
            </div>

            <div class="form-group" style="margin-bottom: 0;">
              <label class="form-label" for="pref-excluded">Excluded Keywords (Hard Reject)</label>
              <input type="text" id="pref-excluded" class="form-input" placeholder="e.g. unpaid sales, cold calling, commission-only" value="${existingProfile?.preferences?.excluded_keywords?.join(', ') || ''}" />
              <span class="form-helper">Any listing containing these keywords will be immediately rejected with score 0.</span>
            </div>
          </div>

          <div class="onboarding-nav" style="margin-top: 0;">
            <button type="button" id="step2-back" class="btn btn-secondary" style="padding: 12px; font-size: 1rem;">
              ← Back
            </button>
            <button type="submit" class="btn btn-primary" style="padding: 12px; font-size: 1rem; flex: 2;">
              Save Profile & Discover Opportunities →
            </button>
          </div>
        </form>
      </div>
    </div>
  `;

  // ======================================================================
  // Step navigation logic
  // ======================================================================
  const stepPanels = [
    container.querySelector('#step-0'),
    container.querySelector('#step-1'),
    container.querySelector('#step-2')
  ];
  const stepDots = container.querySelectorAll('.onboarding-step-dot');
  const stepLines = container.querySelectorAll('.onboarding-step-line');
  const stepLabels = container.querySelectorAll('.onboarding-step-label');

  function goToStep(step) {
    currentStep = step;

    // Show/hide panels
    stepPanels.forEach((panel, i) => {
      panel.classList.toggle('visible', i === step);
    });

    // Update dots
    stepDots.forEach((dot, i) => {
      dot.classList.remove('active', 'completed');
      if (i === step) dot.classList.add('active');
      else if (i < step) dot.classList.add('completed');
    });

    // Update lines
    stepLines.forEach((line, i) => {
      line.classList.toggle('completed', i < step);
    });

    // Update labels
    stepLabels.forEach((label, i) => {
      label.classList.toggle('active', i === step);
    });
  }

  // ======================================================================
  // Step 1: API Key
  // ======================================================================
  const toggleHelpBtn = container.querySelector('#toggle-key-help');
  const helpBox = container.querySelector('#key-help-box');
  toggleHelpBtn.onclick = () => {
    const isHidden = helpBox.style.display === 'none';
    helpBox.style.display = isHidden ? 'block' : 'none';
    toggleHelpBtn.textContent = isHidden ? 'Hide help ▴' : 'How do I get this? ▾';
  };

  const testKeyBtn = container.querySelector('#test-key-btn');
  const keyInput = container.querySelector('#groq-key-input');
  const keyFeedback = container.querySelector('#key-test-feedback');

  testKeyBtn.onclick = async () => {
    const val = keyInput.value.trim();
    if (!val) {
      keyFeedback.innerHTML = '<span style="color: var(--color-fee-text);">Please enter an API key first.</span>';
      return;
    }
    testKeyBtn.disabled = true;
    keyFeedback.innerHTML = '<span style="color: var(--color-text-muted);">Testing connection to Groq...</span>';

    const testRes = await testGroqApiKey(val);
    testKeyBtn.disabled = false;

    if (testRes.ok) {
      keyFeedback.innerHTML = '<span style="color: var(--color-match-text);">✓ Connected! Valid Groq API key.</span>';
      Storage.saveGroqApiKey(val);
    } else {
      keyFeedback.innerHTML = `<span style="color: var(--color-fee-text);">✗ Error: ${testRes.error}</span>`;
    }
  };

  container.querySelector('#step0-next').onclick = () => {
    // Save key if provided
    const groqKey = keyInput.value.trim();
    if (groqKey) {
      Storage.saveGroqApiKey(groqKey);
    }
    goToStep(1);
  };

  // ======================================================================
  // Step 2: CV Upload
  // ======================================================================
  const uploadZone = container.querySelector('#cv-upload-zone');
  const fileInput = container.querySelector('#cv-file-input');
  const fileNameDisplay = container.querySelector('#cv-file-name');
  const pasteTextarea = container.querySelector('#cv-paste-text');
  const extractStatus = container.querySelector('#cv-extract-status');

  let uploadedCvText = '';

  // Click to browse
  uploadZone.onclick = () => fileInput.click();

  // Drag and drop
  uploadZone.ondragover = (e) => {
    e.preventDefault();
    uploadZone.classList.add('drag-over');
  };
  uploadZone.ondragleave = () => uploadZone.classList.remove('drag-over');
  uploadZone.ondrop = async (e) => {
    e.preventDefault();
    uploadZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) await handleFile(file);
  };

  // File input change
  fileInput.onchange = async () => {
    const file = fileInput.files[0];
    if (file) await handleFile(file);
  };

  async function handleFile(file) {
    fileNameDisplay.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    uploadZone.classList.add('has-file');
    uploadZone.querySelector('.cv-upload-icon').textContent = '✅';
    uploadZone.querySelector('.cv-upload-label').textContent = file.name;

    try {
      if (file.name.toLowerCase().endsWith('.pdf')) {
        showExtractStatus('loading', 'Extracting text from PDF...');
        uploadedCvText = await extractTextFromPDF(file);
      } else {
        uploadedCvText = await file.text();
      }

      if (!uploadedCvText.trim()) {
        showExtractStatus('error', 'Could not extract any text from this file. Try pasting your resume text below instead.');
      } else {
        showExtractStatus('success', `Extracted ${uploadedCvText.length.toLocaleString()} characters. Click "Extract & Continue" to parse your profile.`);
        pasteTextarea.value = uploadedCvText;
      }
    } catch (err) {
      console.error('File read error:', err);
      showExtractStatus('error', `Failed to read file: ${err.message}. Try pasting your resume text below instead.`);
    }
  }

  function showExtractStatus(type, message) {
    extractStatus.className = `cv-extract-status visible ${type}`;
    extractStatus.textContent = message;
  }

  // Extract & Continue button
  container.querySelector('#step1-extract').onclick = async () => {
    const cvText = pasteTextarea.value.trim() || uploadedCvText.trim();

    if (!cvText) {
      showExtractStatus('error', 'No resume text found. Upload a file or paste your resume above.');
      return;
    }

    const apiKey = Storage.getGroqApiKey();
    if (!apiKey) {
      // No API key — store the CV text but skip extraction, go to step 3 with blank fields
      showExtractStatus('error', 'No Groq API key set — skipping extraction. You can fill in your profile manually.');
      await new Promise(r => setTimeout(r, 1500));
      applyExtractedProfile(null, cvText);
      goToStep(2);
      return;
    }

    showExtractStatus('loading', 'Sending resume to Groq for profile extraction...');
    const extractBtn = container.querySelector('#step1-extract');
    extractBtn.disabled = true;

    const result = await extractProfileFromCV(cvText, apiKey);
    extractBtn.disabled = false;

    if (result.ok && result.profile && (result.profile.name || result.profile.skills?.length)) {
      const p = result.profile;
      const summary = [
        p.name ? `Name: ${p.name}` : '',
        p.email ? `Email: ${p.email}` : '',
        p.skills?.length ? `${p.skills.length} skills` : '',
        p.education?.length ? `${p.education.length} education entries` : ''
      ].filter(Boolean).join(' • ');

      showExtractStatus('success', `✓ Extracted: ${summary}. Review and edit on the next step.`);
      extractedProfile = result.profile;
      await new Promise(r => setTimeout(r, 1200));
      applyExtractedProfile(extractedProfile, cvText);
      goToStep(2);
    } else {
      showExtractStatus('error', `Extraction ${result.error ? 'failed: ' + result.error : 'returned no data'}. You can fill in your profile manually.`);
      await new Promise(r => setTimeout(r, 2000));
      applyExtractedProfile(null, cvText);
      goToStep(2);
    }
  };

  // Skip button
  container.querySelector('#step1-skip').onclick = () => {
    applyExtractedProfile(null, '');
    goToStep(2);
  };

  // Back button
  container.querySelector('#step1-back').onclick = () => goToStep(0);

  /**
   * Apply extracted profile data (or null) into the step-3 form fields.
   * Everything is editable — nothing is locked.
   */
  function applyExtractedProfile(extracted, cvText) {
    // Only pre-fill if we don't already have an existing profile AND extraction succeeded
    if (extracted) {
      const nameInput = container.querySelector('#user-name');
      const emailInput = container.querySelector('#user-email');
      const phoneInput = container.querySelector('#user-phone');
      const linkedinInput = container.querySelector('#user-linkedin');
      const githubInput = container.querySelector('#user-github');
      const portfolioInput = container.querySelector('#user-portfolio');

      if (extracted.name && !nameInput.value.trim()) {
        nameInput.value = extracted.name;
      }
      if (extracted.email && !emailInput.value.trim()) {
        emailInput.value = extracted.email;
      }
      if (extracted.phone && phoneInput && !phoneInput.value.trim()) {
        phoneInput.value = extracted.phone;
      }
      if (extracted.linkedin_url && !linkedinInput.value.trim()) {
        linkedinInput.value = extracted.linkedin_url;
      }
      if (extracted.github_url && githubInput && !githubInput.value.trim()) {
        githubInput.value = extracted.github_url;
      }
      if (extracted.portfolio_url && portfolioInput && !portfolioInput.value.trim()) {
        portfolioInput.value = extracted.portfolio_url;
      }

      // Merge extracted skills (don't replace existing ones the user set up)
      if (extracted.skills?.length) {
        const existingNames = new Set(skills.map(s => s.name.toLowerCase()));
        for (const s of extracted.skills) {
          if (!existingNames.has(s.name.toLowerCase())) {
            skills.push(createSkill(s.name, s.level || SkillLevel.INTERMEDIATE, s.category || null));
          }
        }
        updateSkillsDisplay();
      }

      // Pre-fill education if not already set
      if (extracted.education?.length) {
        const eduDegree = container.querySelector('#edu-degree');
        const eduInstitution = container.querySelector('#edu-institution');
        const eduGpa = container.querySelector('#edu-gpa');

        if (!eduDegree.value.trim() && extracted.education[0]?.degree) {
          eduDegree.value = extracted.education[0].degree;
        }
        if (!eduInstitution.value.trim() && extracted.education[0]?.institution) {
          eduInstitution.value = extracted.education[0].institution;
        }
        if (!eduGpa.value && extracted.education[0]?.gpa) {
          eduGpa.value = extracted.education[0].gpa;
        }
      }
    }

    // Always populate CV text field with whatever was uploaded/pasted
    if (cvText) {
      const cvTextarea = container.querySelector('#user-cv-text');
      if (!cvTextarea.value.trim()) {
        cvTextarea.value = cvText;
      }
    }
  }

  // ======================================================================
  // Step 3: Profile Form
  // ======================================================================

  // Render skills chips
  const skillsListEl = container.querySelector('#skills-list');
  function updateSkillsDisplay() {
    if (skills.length === 0) {
      skillsListEl.innerHTML = '<span style="color: var(--color-text-muted); font-size: 0.85rem; padding: 6px;">No skills added yet. Add at least 2 for accurate matching.</span>';
      return;
    }
    skillsListEl.innerHTML = skills.map((s, idx) => `
      <span class="listing-tag" style="background: var(--color-bg-card); display: flex; align-items: center; gap: 6px; padding: 4px 10px;">
        <strong>${s.name}</strong>
        <span style="font-size: 0.72rem; color: var(--color-text-muted);">${s.level}</span>
        <button type="button" data-skill-idx="${idx}" class="remove-skill-btn" style="border: none; background: none; cursor: pointer; color: var(--color-text-muted); font-size: 13px; line-height: 1;">×</button>
      </span>
    `).join('');

    skillsListEl.querySelectorAll('.remove-skill-btn').forEach(btn => {
      btn.onclick = () => {
        const idx = Number(btn.getAttribute('data-skill-idx'));
        skills.splice(idx, 1);
        updateSkillsDisplay();
      };
    });
  }
  updateSkillsDisplay();

  // Add skill button handler
  const newSkillInput = container.querySelector('#new-skill-name');
  const newSkillLevel = container.querySelector('#new-skill-level');
  const addSkillBtn = container.querySelector('#add-skill-btn');

  function handleAddSkill() {
    const name = newSkillInput.value.trim();
    if (name) {
      skills.push(createSkill(name, newSkillLevel.value));
      newSkillInput.value = '';
      updateSkillsDisplay();
      newSkillInput.focus();
    }
  }

  addSkillBtn.onclick = handleAddSkill;
  newSkillInput.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddSkill();
    }
  };

  // Back button on step 3
  container.querySelector('#step2-back').onclick = () => goToStep(1);

  // Quick Fill Button Handler
  const quickFillBtn = container.querySelector('#quick-fill-btn');
  if (quickFillBtn) {
    quickFillBtn.onclick = () => {
      container.querySelector('#user-name').value = 'Adina Khan';
      container.querySelector('#user-email').value = 'adina@example.com';
      if (container.querySelector('#user-phone')) container.querySelector('#user-phone').value = '+1 (555) 019-2834';
      container.querySelector('#user-cv-text').value = 'AI Software Engineer with 2+ years experience building autonomous agent workflows, LangGraph pipelines, and FastAPI microservices. Contributor to open-source RAG evaluation frameworks. First-class honors in BS Artificial Intelligence from FAST-NUCES.';
      container.querySelector('#user-portfolio').value = 'https://adina-ai.dev';
      container.querySelector('#user-github').value = 'https://github.com/adinakhan';
      container.querySelector('#user-linkedin').value = 'https://linkedin.com/in/adinakhan';
      container.querySelector('#edu-degree').value = 'BS Artificial Intelligence';
      container.querySelector('#edu-institution').value = 'FAST-NUCES';
      container.querySelector('#edu-gpa').value = '3.84';
      container.querySelector('#pref-countries').value = 'Pakistan, Remote, Worldwide';
      container.querySelector('#pref-min-comp').value = '200';
      container.querySelector('#pref-excluded').value = 'unpaid sales, commission-only';

      skills.length = 0;
      skills.push(
        createSkill('Python', SkillLevel.ADVANCED, 'programming'),
        createSkill('LangGraph', SkillLevel.ADVANCED, 'ml'),
        createSkill('RAG', SkillLevel.INTERMEDIATE, 'ml'),
        createSkill('FastAPI', SkillLevel.INTERMEDIATE, 'programming')
      );
      updateSkillsDisplay();
    };
  }

  // Form Submit Handler
  const form = container.querySelector('#onboarding-form');
  form.onsubmit = (e) => {
    e.preventDefault();

    const name = container.querySelector('#user-name').value.trim();
    const email = container.querySelector('#user-email').value.trim();
    const phone = container.querySelector('#user-phone')?.value.trim() || '';
    const groqKey = keyInput.value.trim();
    const cvText = container.querySelector('#user-cv-text')?.value.trim() || '';
    const portfolioUrl = container.querySelector('#user-portfolio')?.value.trim() || '';
    const githubUrl = container.querySelector('#user-github')?.value.trim() || '';
    const linkedinUrl = container.querySelector('#user-linkedin')?.value.trim() || '';

    // Save Groq key
    if (groqKey) {
      Storage.saveGroqApiKey(groqKey);
    }

    // Build Education
    const degree = container.querySelector('#edu-degree').value.trim();
    const institution = container.querySelector('#edu-institution').value.trim();
    const gpaVal = container.querySelector('#edu-gpa').value.trim();
    const educationList = [];
    if (degree || institution) {
      educationList.push(createEducation(degree || 'Degree', institution || 'Institution', null, gpaVal ? Number(gpaVal) : null));
    }

    // Build Preferences
    const countriesRaw = container.querySelector('#pref-countries').value;
    const countries = countriesRaw ? countriesRaw.split(',').map(c => c.trim()).filter(Boolean) : [];
    const minCompRaw = container.querySelector('#pref-min-comp').value;
    const minComp = minCompRaw ? Number(minCompRaw) : null;
    const remoteOk = container.querySelector('#pref-remote-ok').checked;
    const relocateOk = container.querySelector('#pref-relocate-ok').checked;
    const excludedRaw = container.querySelector('#pref-excluded').value;
    const excludedKeywords = excludedRaw ? excludedRaw.split(',').map(k => k.trim()).filter(Boolean) : [];

    const preferences = createPreferences({
      opportunity_types: [OpportunityType.JOB, OpportunityType.FELLOWSHIP, OpportunityType.INTERNSHIP, OpportunityType.RESEARCH],
      remote_ok: remoteOk,
      relocate_ok: relocateOk,
      countries,
      min_compensation: minComp,
      requires_funded: false,
      min_match_score: 0.65,
      excluded_keywords: excludedKeywords
    });

    const newProfile = createProfile({
      name,
      email,
      phone,
      skills,
      education: educationList,
      preferences,
      answer_library: existingProfile?.answer_library || {},
      cv_text: cvText,
      portfolio_url: portfolioUrl,
      github_url: githubUrl,
      linkedin_url: linkedinUrl
    });

    Storage.saveProfile(newProfile);
    if (onComplete) onComplete(newProfile);
  };
}
