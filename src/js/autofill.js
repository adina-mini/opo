/**
 * @file autofill.js
 * Browser Autofill Assistant for opo — Personal Opportunity Agent.
 *
 * Allows opo to apply on the user's behalf:
 * 1. Generates a self-executing 1-Click Form Filler script/bookmarklet.
 * 2. Injects credentials and tailored cover letter into external job portals (Greenhouse, Lever, Workday, Ashby, etc.).
 * 3. Bypasses React/Vue synthetic event barriers by invoking native input property setters.
 * 4. Docks a floating "🌱 OPO Copilot" assistant onto the target page with quick-copy buttons for remaining custom questions.
 */

/**
 * Returns the raw JavaScript string for autofilling external forms on the user's behalf.
 * @param {import('./models.js').Profile} profile
 * @param {import('./models.js').Application} [app]
 * @returns {string} Plain JavaScript code
 */
export function getAutofillScript(profile, app = null) {
  if (!profile) return 'alert("Please create a profile in OPO first.");';

  const name = profile.name || '';
  const parts = name.trim().split(/\s+/);
  const firstName = parts[0] || '';
  const lastName = parts.slice(1).join(' ') || '';
  const email = profile.email || '';
  const phone = profile.phone || '';
  const portfolio = profile.portfolio_url || '';
  const github = profile.github_url || '';
  const linkedin = profile.linkedin_url || '';
  const cvText = profile.cv_text || '';
  const letter = app?.draft_content?.cover_letter || '';
  const location = Array.isArray(profile.countries) && profile.countries.length > 0 ? profile.countries.join(', ') : '';

  const payload = {
    name,
    firstName,
    lastName,
    email,
    phone,
    portfolio,
    github,
    linkedin,
    cvText,
    letter,
    location
  };

  return `(function() {
  var d = ${JSON.stringify(payload)};

  var filled = 0;
  function setVal(el, val) {
    if (!el || val === undefined || val === null || val === '') return;
    try {
      el.focus();
      var setter = null;
      if (el.tagName === 'INPUT') {
        setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      } else if (el.tagName === 'TEXTAREA') {
        setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      }
      if (setter) {
        setter.call(el, val);
      } else {
        el.value = val;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
      el.style.outline = "2px solid #10b981";
      el.style.backgroundColor = "rgba(16, 185, 129, 0.08)";
      filled++;
    } catch (e) {
      console.warn('OPO Autofill failed on field:', el, e);
    }
  }

  // Scan all inputs and textareas
  var inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea');
  inputs.forEach(function(el) {
    var attr = (el.name + ' ' + el.id + ' ' + (el.placeholder || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('data-automation-id') || '') + ' ' + (el.getAttribute('data-testid') || '')).toLowerCase();
    var type = (el.type || '').toLowerCase();
    var autocomplete = (el.autocomplete || '').toLowerCase();

    // Associated label context
    var labelText = '';
    if (el.id) {
      var lbl = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (lbl) labelText += ' ' + lbl.innerText;
    }
    var parentLbl = el.closest('label');
    if (parentLbl) labelText += ' ' + parentLbl.innerText;
    var fullContext = (attr + ' ' + labelText + ' ' + autocomplete).toLowerCase();

    if (type === 'email' || autocomplete === 'email' || fullContext.includes('email') || fullContext.includes('e-mail')) {
      setVal(el, d.email);
    } else if (autocomplete === 'given-name' || (fullContext.includes('first') && fullContext.includes('name')) || fullContext.includes('firstname')) {
      setVal(el, d.firstName);
    } else if (autocomplete === 'family-name' || (fullContext.includes('last') && fullContext.includes('name')) || fullContext.includes('lastname') || fullContext.includes('surname')) {
      setVal(el, d.lastName);
    } else if (autocomplete === 'name' || (fullContext.includes('full name') || (fullContext.includes('name') && !fullContext.includes('company') && !fullContext.includes('school') && !fullContext.includes('user') && !fullContext.includes('org')))) {
      setVal(el, d.name);
    } else if (type === 'tel' || autocomplete === 'tel' || fullContext.includes('phone') || fullContext.includes('mobile') || fullContext.includes('cell')) {
      setVal(el, d.phone);
    } else if (fullContext.includes('linkedin')) {
      setVal(el, d.linkedin);
    } else if (fullContext.includes('github') || fullContext.includes('git')) {
      setVal(el, d.github);
    } else if (fullContext.includes('portfolio') || fullContext.includes('website') || fullContext.includes('personal url') || fullContext.includes('personal site') || fullContext.includes('homepage')) {
      setVal(el, d.portfolio);
    } else if (fullContext.includes('city') || fullContext.includes('location') || fullContext.includes('residence')) {
      if (d.location) setVal(el, d.location);
    } else if (el.tagName === 'TEXTAREA' && (fullContext.includes('cover') || fullContext.includes('letter') || fullContext.includes('message') || fullContext.includes('pitch') || fullContext.includes('statement') || fullContext.includes('why are you') || fullContext.includes('note'))) {
      setVal(el, d.letter || d.cvText);
    } else if (el.tagName === 'TEXTAREA' && (fullContext.includes('resume') || fullContext.includes('cv') || fullContext.includes('experience') || fullContext.includes('background') || fullContext.includes('bio'))) {
      setVal(el, d.cvText || d.letter);
    }
  });

  // Remove existing dock if present
  var oldDock = document.getElementById('opo-copilot-dock');
  if (oldDock) oldDock.remove();

  // Inject sleek floating copilot dock
  var dock = document.createElement('div');
  dock.id = 'opo-copilot-dock';
  dock.style.cssText = "position:fixed;bottom:24px;right:24px;z-index:2147483647;background:#064e3b;color:#ecfdf5;padding:16px 18px;border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,0.35);font-family:system-ui,-apple-system,sans-serif;font-size:13px;border:1px solid #10b981;max-width:340px;line-height:1.4;";
  
  dock.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.15);padding-bottom:6px;">' +
    '<strong style="font-size:14px;color:#a7f3d0;display:flex;align-items:center;gap:6px;">🌱 OPO Application Copilot</strong>' +
    '<button id="opo-dock-close" style="background:none;border:none;color:#ecfdf5;cursor:pointer;font-size:18px;line-height:1;">×</button>' +
  '</div>' +
  '<div style="margin-bottom:10px;font-size:12px;color:#d1fae5;">' +
    'Successfully autofilled <strong>' + filled + ' field' + (filled === 1 ? '' : 's') + '</strong> on your behalf! Click any button below to copy custom responses:' +
  '</div>' +
  '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">' +
    '<button id="opo-copy-letter" style="background:#047857;color:#fff;border:none;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;">📋 Cover Letter</button>' +
    '<button id="opo-copy-cv" style="background:#047857;color:#fff;border:none;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;">📋 Full CV</button>' +
    '<button id="opo-copy-port" style="background:#047857;color:#fff;border:none;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;">📋 Portfolio</button>' +
    '<button id="opo-copy-in" style="background:#047857;color:#fff;border:none;padding:6px 8px;border-radius:6px;cursor:pointer;font-size:11px;font-weight:600;">📋 LinkedIn</button>' +
  '</div>' +
  '<div id="opo-dock-toast" style="color:#6ee7b7;font-size:11px;margin-top:6px;min-height:16px;text-align:center;"></div>';

  document.body.appendChild(dock);

  // Wire dock copiers
  function showToast(msg) {
    var t = document.getElementById('opo-dock-toast');
    if (t) {
      t.innerText = msg;
      setTimeout(function() { if (t) t.innerText = ''; }, 2500);
    }
  }

  function copyText(txt, label) {
    if (!txt) { showToast('No ' + label + ' provided'); return; }
    navigator.clipboard.writeText(txt).then(function() {
      showToast('✓ Copied ' + label + ' to clipboard!');
    }).catch(function() {
      showToast('Failed to copy');
    });
  }

  document.getElementById('opo-dock-close').onclick = function() { dock.remove(); };
  document.getElementById('opo-copy-letter').onclick = function() { copyText(d.letter, 'Cover Letter'); };
  document.getElementById('opo-copy-cv').onclick = function() { copyText(d.cvText, 'CV Text'); };
  document.getElementById('opo-copy-port').onclick = function() { copyText(d.portfolio, 'Portfolio'); };
  document.getElementById('opo-copy-in').onclick = function() { copyText(d.linkedin, 'LinkedIn'); };
})();`;
}

/**
 * Generates an executable bookmarklet URL string containing the user's credentials and tailored cover letter.
 * @param {import('./models.js').Profile} profile
 * @param {import('./models.js').Application} [app]
 * @returns {string} javascript:... bookmarklet code
 */
export function generateAutofillBookmarklet(profile, app = null) {
  const runner = getAutofillScript(profile, app);
  return `javascript:${encodeURIComponent(runner)}`;
}

/**
 * Copies a complete credential package to the user's clipboard.
 * @param {import('./models.js').Profile} profile
 * @param {import('./models.js').Application} [app]
 * @returns {Promise<boolean>}
 */
export async function copyApplicationPackageToClipboard(profile, app = null) {
  if (!profile) return false;

  const letter = app?.draft_content?.cover_letter || '';
  const text = `--- APPLICANT DETAILS ---
Full Name: ${profile.name}
Email: ${profile.email}
${profile.portfolio_url ? `Portfolio: ${profile.portfolio_url}\n` : ''}${profile.github_url ? `GitHub: ${profile.github_url}\n` : ''}${profile.linkedin_url ? `LinkedIn: ${profile.linkedin_url}\n` : ''}
--- TAILORED COVER LETTER ---
${letter || 'No tailored letter generated yet.'}

--- CV HIGHLIGHTS ---
${profile.cv_text || 'No CV text provided.'}
`;

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.warn('Clipboard write failed:', err);
    return false;
  }
}
