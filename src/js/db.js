/**
 * @file db.js
 * Zero-Knowledge Local Storage for opo — Personal Opportunity Agent.
 * All data lives strictly in the user's browser (localStorage / IndexedDB).
 * No accounts, no server logging, no cross-device sync in V1.
 */

const STORAGE_KEYS = Object.freeze({
  PROFILE: 'opo_user_profile',
  GROQ_KEY: 'opo_groq_api_key',
  DRAFTS: 'opo_draft_vault',
  LISTINGS_CACHE: 'opo_listings_cache',
  ANSWERS: 'opo_answer_library'
});

export const Storage = {
  /**
   * Profile Management
   */
  getProfile() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.PROFILE);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      console.error('Failed to read profile from storage:', e);
      return null;
    }
  },

  saveProfile(profile) {
    try {
      localStorage.setItem(STORAGE_KEYS.PROFILE, JSON.stringify(profile));
      return true;
    } catch (e) {
      console.error('Failed to save profile to storage:', e);
      return false;
    }
  },

  /**
   * Groq API Key Management
   * Stored ONLY in browser localStorage. Never sent to any developer-controlled server.
   */
  getGroqApiKey() {
    try {
      return localStorage.getItem(STORAGE_KEYS.GROQ_KEY) || '';
    } catch {
      return '';
    }
  },

  saveGroqApiKey(key) {
    try {
      if (!key) {
        localStorage.removeItem(STORAGE_KEYS.GROQ_KEY);
      } else {
        localStorage.setItem(STORAGE_KEYS.GROQ_KEY, key.trim());
      }
      return true;
    } catch (e) {
      console.error('Failed to save Groq API key:', e);
      return false;
    }
  },

  /**
   * Answer Library (Reusable answers to recurring application questions)
   */
  getAnswerLibrary() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.ANSWERS);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  },

  saveAnswer(questionKey, answerText) {
    try {
      const answers = this.getAnswerLibrary();
      answers[questionKey] = answerText;
      localStorage.setItem(STORAGE_KEYS.ANSWERS, JSON.stringify(answers));

      // Also update inside profile if present
      const profile = this.getProfile();
      if (profile) {
        profile.answer_library = profile.answer_library || {};
        profile.answer_library[questionKey] = answerText;
        this.saveProfile(profile);
      }
      return true;
    } catch (e) {
      console.error('Failed to save answer:', e);
      return false;
    }
  },

  /**
   * Draft Vault (Applications across all lifecycle states)
   * State machine: discovered → shortlisted → drafting → needs_input → ready → submitted → outcome
   */
  getDrafts() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.DRAFTS);
      if (!raw) return [];
      const drafts = JSON.parse(raw);
      for (const d of drafts) {
        if (d?.listing && Array.isArray(d.listing.source_urls)) {
          d.listing.source_urls = d.listing.source_urls.map(u => {
            if (typeof u === 'string' && (u.includes('example.org') || u.includes('example.com'))) {
              if (d.listing.opportunity_type === 'fellowship') return 'https://fellowship.mlh.io/';
              if (d.listing.opportunity_type === 'scholarship') return 'https://www.daad.de/en/study-and-research-in-germany/scholarships/';
              if (d.listing.opportunity_type === 'internship') return 'https://summerofcode.withgoogle.com/';
              return 'https://foundation.mozilla.org/en/what-we-fund/awards/';
            }
            return u;
          });
        }
      }
      return drafts;
    } catch (e) {
      console.error('Failed to get drafts:', e);
      return [];
    }
  },

  getDraft(applicationId) {
    const drafts = this.getDrafts();
    return drafts.find(d => d.id === applicationId || d.listing_id === applicationId) || null;
  },

  saveDraft(application) {
    try {
      const drafts = this.getDrafts();
      const idx = drafts.findIndex(d => d.id === application.id || d.listing_id === application.listing_id);
      application.updated_at = new Date().toISOString();

      if (idx >= 0) {
        drafts[idx] = application;
      } else {
        drafts.unshift(application);
      }
      localStorage.setItem(STORAGE_KEYS.DRAFTS, JSON.stringify(drafts));
      return true;
    } catch (e) {
      console.error('Failed to save draft:', e);
      return false;
    }
  },

  deleteDraft(applicationId) {
    try {
      let drafts = this.getDrafts();
      drafts = drafts.filter(d => d.id !== applicationId && d.listing_id !== applicationId);
      localStorage.setItem(STORAGE_KEYS.DRAFTS, JSON.stringify(drafts));
      return true;
    } catch (e) {
      console.error('Failed to delete draft:', e);
      return false;
    }
  },

  /**
   * Opportunity Listings Cache
   */
  getCachedListings() {
    const CACHE_VERSION_KEY = 'opo_cache_ver';
    const CURRENT_CACHE_VER = 'v4_live_verified';

    try {
      const ver = localStorage.getItem(CACHE_VERSION_KEY);
      if (ver !== CURRENT_CACHE_VER) {
        // Automatically purge older stale cache
        localStorage.removeItem(STORAGE_KEYS.LISTINGS_CACHE);
        localStorage.setItem(CACHE_VERSION_KEY, CURRENT_CACHE_VER);
        return [];
      }
      const raw = localStorage.getItem(STORAGE_KEYS.LISTINGS_CACHE);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  clearListingsCache() {
    try {
      localStorage.removeItem(STORAGE_KEYS.LISTINGS_CACHE);
    } catch (e) {
      console.error('Failed to clear listings cache:', e);
    }
  },

  saveCachedListings(listings) {
    try {
      localStorage.setItem(STORAGE_KEYS.LISTINGS_CACHE, JSON.stringify(listings));
      return true;
    } catch (e) {
      console.error('Failed to cache listings:', e);
      return false;
    }
  },

  /**
   * Export / Import / Reset
   */
  exportData() {
    return JSON.stringify({
      profile: this.getProfile(),
      drafts: this.getDrafts(),
      answers: this.getAnswerLibrary(),
      exported_at: new Date().toISOString(),
      version: '1.0'
    }, null, 2);
  },

  importData(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (data.profile) this.saveProfile(data.profile);
      if (Array.isArray(data.drafts)) localStorage.setItem(STORAGE_KEYS.DRAFTS, JSON.stringify(data.drafts));
      if (data.answers) localStorage.setItem(STORAGE_KEYS.ANSWERS, JSON.stringify(data.answers));
      return true;
    } catch (e) {
      console.error('Import failed:', e);
      return false;
    }
  },

  clearAll() {
    Object.values(STORAGE_KEYS).forEach(key => localStorage.removeItem(key));
  }
};
