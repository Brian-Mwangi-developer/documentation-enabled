// Configuration for Documentation Guide extension
// config.js - Frontend configuration

const EXTENSION_CONFIG = {
  // Backend server configuration
  BACKEND_URL: "http://localhost:3000",

  // API endpoints
  ENDPOINTS: {
    HEALTH: "/health",
    SITEMAP: "/api/sitemap",
    CRAWL: "/api/crawl",
    SEARCH: "/api/search",
  },

  // UI configuration
  UI: {
    MAX_URLS_DISPLAY: 5,
    SEARCH_RESULTS_LIMIT: 5,
    AUTO_RESIZE_TEXTAREA: true,
    CONVERSATION_SCROLL_BEHAVIOR: "smooth",
  },

  // Timing configuration
  TIMING: {
    TAB_UPDATE_DELAY: 500,
    PROGRESS_CHECK_INTERVAL: 2000,
    ERROR_DISPLAY_DURATION: 5000,
    COMPLETION_CLEANUP_DELAY: 3000,
  },

  // Feature flags
  FEATURES: {
    DEBUG_MODE: true,
    AUTO_INDEX: false,
    STREAMING_RESPONSES: true,
  },
};

// Export for use in extension scripts
if (typeof module !== "undefined" && module.exports) {
  module.exports = EXTENSION_CONFIG;
}

// Make available globally for extension scripts
if (typeof window !== "undefined") {
  window.EXTENSION_CONFIG = EXTENSION_CONFIG;
}
