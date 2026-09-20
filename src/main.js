import './css/app.css';
import { Storage } from './js/db.js';
import { renderDailyReport } from './js/views/daily_report.js';
import { renderDraftVault } from './js/views/draft_vault.js';
import { renderProfileView } from './js/views/profile_view.js';
import { renderOnboarding } from './js/views/onboarding.js';

// Register Service Worker for PWA installation
if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('SW registration skipped:', err);
    });
  });
}

// Router State
let currentTab = 'feed';

function initApp() {
  const appEl = document.getElementById('app');
  if (!appEl) return;

  const profile = Storage.getProfile();

  // If no profile exists, boot directly into onboarding
  if (!profile) {
    appEl.innerHTML = '<div id="view-content" style="padding-top: 10px;"></div>';
    const viewContainer = document.getElementById('view-content');
    renderOnboarding(viewContainer, () => {
      currentTab = 'feed';
      initApp();
    });
    return;
  }

  const drafts = Storage.getDrafts();
  const readyCount = drafts.filter(d => d.state === 'ready').length;

  appEl.innerHTML = `
    <!-- PWA Header -->
    <header class="app-header">
      <div class="brand-group" id="brand-home-btn" style="cursor: pointer;">
        <div class="brand-icon">🌱</div>
        <div class="brand-text">
          <h1>opo</h1>
          <p class="brand-tagline">Personal Opportunity Agent — Draft-then-approve</p>
        </div>
      </div>

      <!-- Navigation Pills -->
      <nav class="nav-pills">
        <button id="nav-feed-btn" class="nav-pill-btn ${currentTab === 'feed' ? 'active' : ''}">
          Today's Feed
        </button>
        <button id="nav-vault-btn" class="nav-pill-btn ${currentTab === 'vault' ? 'active' : ''}">
          Draft Vault
          ${readyCount > 0 ? `<span class="nav-badge">${readyCount}</span>` : ''}
        </button>
        <button id="nav-profile-btn" class="nav-pill-btn ${currentTab === 'profile' ? 'active' : ''}">
          Profile
        </button>
      </nav>
    </header>

    <!-- Main View Content Area -->
    <main id="view-content">
      <!-- Injected dynamically by router -->
    </main>
  `;

  // Attach Navigation Listeners
  const feedBtn = document.getElementById('nav-feed-btn');
  const vaultBtn = document.getElementById('nav-vault-btn');
  const profileBtn = document.getElementById('nav-profile-btn');
  const brandBtn = document.getElementById('brand-home-btn');
  const viewContent = document.getElementById('view-content');

  function navigateTo(tab) {
    currentTab = tab;
    [feedBtn, vaultBtn, profileBtn].forEach(b => b?.classList.remove('active'));

    if (tab === 'feed') feedBtn?.classList.add('active');
    if (tab === 'vault') vaultBtn?.classList.add('active');
    if (tab === 'profile') profileBtn?.classList.add('active');

    viewContent.innerHTML = '';

    if (tab === 'feed') {
      renderDailyReport(viewContent, navigateTo);
    } else if (tab === 'vault') {
      renderDraftVault(viewContent, navigateTo);
    } else if (tab === 'profile') {
      renderProfileView(viewContent, navigateTo);
    } else if (tab === 'onboarding') {
      renderOnboarding(viewContent, () => navigateTo('feed'));
    }
  }

  feedBtn.onclick = () => navigateTo('feed');
  vaultBtn.onclick = () => navigateTo('vault');
  profileBtn.onclick = () => navigateTo('profile');
  brandBtn.onclick = () => navigateTo('feed');

  // Render initial view
  navigateTo(currentTab);
}

// Boot application when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
