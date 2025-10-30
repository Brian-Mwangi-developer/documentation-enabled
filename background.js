// background.js
const CONFIG = {
  BACKEND_URL: "http://localhost:3000",
  DEBUG: true,
  MAX_URLS_TO_CRAWL: 5,
};

let indexingStatus = new Map();
let documentCache = new Map();
let userEmail = null;

async function getUserInfo() {
  return new Promise((resolve) => {
    chrome.identity.getProfileUserInfo({ accountStatus: "ANY" }, (userInfo) => {
      console.log("User Info:", userInfo);
      userEmail = userInfo.email;
      resolve(userInfo);
    });
  });
}

chrome.runtime.onInstalled.addListener(async () => {
  console.log("Documentation Guide extension installed");
  await getUserInfo();
  initializeStorage();
});

async function initializeStorage() {
  try {
    const result = await chrome.storage.local.get([
      "indexedDomains",
      "userPreferences",
    ]);
    if (!result.indexedDomains) {
      await chrome.storage.local.set({ indexedDomains: {} });
    }
    if (!result.userPreferences) {
      await chrome.storage.local.set({
        userPreferences: {
          autoIndex: false,
          chunkSize: CONFIG.CHUNK_SIZE,
          maxChunks: CONFIG.MAX_CHUNKS_PER_DOC,
        },
      });
    }
  } catch (error) {
    console.error("Error initializing storage:", error);
  }
}

async function updateIconForDomain(domain, tabId) {
  try {
    const { indexedDomains } = await chrome.storage.local.get([
      "indexedDomains",
    ]);
    const isIndexed = !!indexedDomains[domain];

    const iconPath = isIndexed
      ? {
          16: "images/indexed.png",
          48: "images/indexed.png",
          128: "images/indexed.png",
        }
      : {
          16: "images/logo.png",
          48: "images/logo.png",
          128: "images/logo.png",
        };

    const options = { path: iconPath };
    if (tabId) {
      options.tabId = tabId;
    }

    chrome.action.setIcon(options, () => {
      if (chrome.runtime.lastError) {
        console.error("Icon update error:", chrome.runtime.lastError.message);
      } else if (CONFIG.DEBUG) {
        console.log(
          `Icon updated for ${domain}: ${isIndexed ? "indexed" : "logo"}${
            tabId ? ` (Tab ${tabId})` : " (Global)"
          }`
        );
      }
    });
  } catch (error) {
    console.error("Error updating icon:", error);
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
    sendTabInfoToSidepanel(tab);
  } catch (error) {
    console.error("Error opening side panel:", error);
  }
});
function sendTabInfoToSidepanel(tab) {
  setTimeout(() => {
    chrome.runtime
      .sendMessage({
        type: "TAB_UPDATED",
        tabInfo: { url: tab.url, title: tab.title, id: tab.id },
        domainChanged: true,
      })
      .catch((error) => {
        if (CONFIG.DEBUG) {
          console.log("Sidepanel not ready, message failed:", error.message);
        }
      });
  }, 100);
}

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.url) {
    const url = new URL(tab.url);
    const domain = url.hostname;
    await updateIconForDomain(domain, tabId);
    sendTabInfoToSidepanel(tab);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab.url) {
      const url = new URL(tab.url);
      const domain = url.hostname;
      console.log("Domain is:", domain);
      await updateIconForDomain(domain, activeInfo.tabId);
      sendTabInfoToSidepanel(tab);
    }
  } catch (error) {
    console.error("Error getting active tab:", error);
  }
});

// Message handler
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Background received message:", message);

  switch (message.type) {
    case "GET_CURRENT_TAB":
      handleGetCurrentTab();
      break;
    case "CHECK_INDEXING_STATUS":
      handleCheckIndexingStatus(message.domain, sendResponse);
      return true;
    case "START_INDEXING":
      handleStartIndexing(message.domain, message.baseUrl, sendResponse);
      return true;
    case "SEARCH_DOCUMENTATION":
      handleSearchDocumentation(message.query, message.domain, sendResponse);
      return true;
    case "GET_INDEXING_PROGRESS":
      handleGetIndexingProgress(message.domain, sendResponse);
      return true;
    case "TEST_CONNECTION":
      testBackendConnection(sendResponse);
      return true;
  }

  sendResponse({ received: true });
});

//Test
async function testBackendConnection(sendResponse) {
  try {
    console.log("Testing backend connection...");

    const response = await fetch(`${CONFIG.BACKEND_URL}/health`);
    const result = await response.json();

    if (response.ok) {
      console.log("✅ Backend Connected:", result);
      sendResponse({
        success: true,
        status: "Backend server is running",
        data: result,
      });
    } else {
      throw new Error(`Backend returned ${response.status}`);
    }
  } catch (error) {
    console.error("❌ Backend connection failed:", error);
    sendResponse({
      success: false,
      error: `Backend server not accessible: ${error.message}. Make sure the server is running on port 3000.`,
    });
  }
}
function prioritizeDocumentationUrls(urls, baseUrl) {
 
  const docPatterns = [
    { pattern: /getting.?started|quick.?start|tutorial|guide/i, score: 100 },
    { pattern: /introduction|intro|overview|welcome/i, score: 95 },

    { pattern: /api|reference|docs?\/api/i, score: 90 },
    { pattern: /documentation|docs?\//i, score: 85 },

    { pattern: /install|setup|configuration|config/i, score: 80 },
    { pattern: /authentication|auth|login/i, score: 75 },

    { pattern: /concepts|fundamentals|basics|core/i, score: 70 },
    { pattern: /examples?|samples?|demo/i, score: 65 },


    { pattern: /features?|components?|modules?/i, score: 60 },
    { pattern: /integration|webhook|sdk/i, score: 55 },

    // Lower priority - Advanced topics
    { pattern: /advanced|migration|troubleshooting/i, score: 50 },
    { pattern: /faq|help|support/i, score: 45 },

    // Specific documentation sites patterns
    { pattern: /\/v\d+\/|version/i, score: 40 }, // Version-specific docs
    { pattern: /changelog|release|updates/i, score: 35 },
  ];

  // Additional boost for common documentation URL structures
  const structureBoosts = [
    { pattern: /^[^\/]*\/docs?\//i, boost: 20 }, // /docs/ in path
    { pattern: /^[^\/]*\/(guide|tutorial|api)\//i, boost: 15 }, // /guide/, /tutorial/, /api/
    { pattern: /readme/i, boost: 10 }, // README files
    { pattern: /index|home|main/i, boost: 5 }, // Index pages
  ];

  const scoredUrls = urls.map((url) => {
    let score = 0;
    const urlLower = url.toLowerCase();
    const urlPath = url.replace(baseUrl, "").toLowerCase();

    // Check documentation patterns
    for (const { pattern, score: patternScore } of docPatterns) {
      if (pattern.test(urlLower)) {
        score = Math.max(score, patternScore);
        break; // Take highest matching pattern
      }
    }

    // Apply structure boosts
    for (const { pattern, boost } of structureBoosts) {
      if (pattern.test(urlLower)) {
        score += boost;
      }
    }

    // Boost for shorter, cleaner URLs (likely more important)
    const pathDepth = (urlPath.match(/\//g) || []).length;
    if (pathDepth <= 2) score += 10;
    if (pathDepth <= 1) score += 5;

    // Penalty for very long URLs or query parameters
    if (url.includes("?")) score -= 10;
    if (url.length > 100) score -= 5;

    // Boost for root documentation pages
    if (
      urlPath === "/" ||
      urlPath === "" ||
      urlPath === "/docs" ||
      urlPath === "/documentation"
    ) {
      score += 30;
    }

    return { url, score };
  });

  // Sort by score (highest first) and return URLs
  return scoredUrls
    .sort((a, b) => b.score - a.score)
    .map((item) => {
      if (CONFIG.DEBUG) {
        console.log(`📊 URL Score: ${item.score} - ${item.url}`);
      }
      return item.url;
    });
}

function handleGetCurrentTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]) {
      console.log(
        `Current tab requested - Domain: ${new URL(tabs[0].url).hostname}`
      );
      sendTabInfoToSidepanel(tabs[0]);
    }
  });
}

async function handleCheckIndexingStatus(domain, sendResponse) {
  try {
    const { indexedDomains } = await chrome.storage.local.get([
      "indexedDomains",
    ]);
    const domainInfo = indexedDomains[domain];

    // Check if currently indexing
    const isCurrentlyIndexing = indexingStatus.has(domain);

    const status = {
      isIndexed: !!domainInfo,
      lastIndexed: domainInfo?.lastIndexed || null,
      urlCount: domainInfo?.urlCount || 0,
      isCurrentlyIndexing: isCurrentlyIndexing,
    };

    sendResponse({ success: true, status });
  } catch (error) {
    console.error("Error checking indexing status:", error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleStartIndexing(domain, baseUrl, sendResponse) {
  try {
    if (indexingStatus.has(domain)) {
      sendResponse({ success: false, error: "Already indexing this domain" });
      return;
    }

    indexingStatus.set(domain, {
      status: "starting",
      progress: 0,
      urls: [],
      startTime: Date.now(),
    });

    sendResponse({ success: true, message: "Indexing started" });

    console.log(`the Base Url is ${baseUrl}`);
    await fetch("http://localhost:3000/api/sitemap");
    startDocumentationIndexing(domain, baseUrl);
  } catch (error) {
    console.error("Error starting indexing:", error);
    indexingStatus.delete(domain);
    sendResponse({ success: false, error: error.message });
  }
}

function handleGetIndexingProgress(domain, sendResponse) {
  const progress = indexingStatus.get(domain);
  if (progress) {
    sendResponse({ success: true, progress });
  } else {
    sendResponse({
      success: false,
      error: "No indexing in progress for this domain",
    });
  }
}
async function handleStreamEvent(domain, data, totalUrls) {
  switch (data.type) {
    case "start":
      updateIndexingStatus(domain, "starting", 25, data.message);
      break;

    case "progress":
      const progress = 25 + data.progress * 0.6; // Scale to 25-85%
      updateIndexingStatus(domain, "crawling", progress, data.message);
      break;

    case "scraping":
      updateIndexingStatus(domain, "scraping", null, `Scraping: ${data.url}`);
      break;

    case "chunking":
      updateIndexingStatus(
        domain,
        "processing",
        null,
        `Processing content: ${data.url}`
      );
      break;

    case "embedding":
      updateIndexingStatus(
        domain,
        "embedding",
        null,
        `Creating embeddings (${data.totalChunks} chunks)...`
      );
      break;

    case "indexing":
      updateIndexingStatus(
        domain,
        "indexing",
        null,
        `Storing in database: ${data.url}`
      );
      break;

    case "url_complete":
      const completedProgress = 25 + (data.progress || 0) * 0.6;
      const message = data.wasAlreadyIndexed
        ? `Domain already indexed: ${data.url}`
        : `Completed: ${data.chunks} chunks, ${data.vectors} vectors`;
      updateIndexingStatus(domain, "processing", completedProgress, message);
      break;

    case "url_error":
      console.warn(`⚠️ URL failed: ${data.url} - ${data.error}`);
      updateIndexingStatus(
        domain,
        "processing",
        null,
        `Error processing: ${data.url}`
      );
      break;

    case "complete":
      updateIndexingStatus(domain, "finalizing", 90, data.message);
      break;

    case "error":
      throw new Error(data.message);
  }
}

async function startDocumentationIndexing(domain, baseUrl) {
  try {
    console.log(`🚀 Starting indexing for ${domain} using backend`);

    // Step 1: Discover URLs using backend sitemap endpoint
    updateIndexingStatus(
      domain,
      "discovering",
      10,
      "Discovering documentation URLs..."
    );

    const sitemapResponse = await fetch(`${CONFIG.BACKEND_URL}/api/sitemap`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: baseUrl }),
    });

    if (!sitemapResponse.ok) {
      throw new Error(`Sitemap extraction failed: ${sitemapResponse.status}`);
    }

    const sitemapData = await sitemapResponse.json();

    if (
      !sitemapData.success ||
      !sitemapData.urls ||
      sitemapData.urls.length === 0
    ) {
      throw new Error("No URLs found in sitemap");
    }

    const urls = sitemapData.urls;
    console.log(`📄 Discovered ${urls.length} URLs from sitemap`);

    updateIndexingStatus(
      domain,
      "crawling",
      30,
      `Processing ${urls.length} pages...`
    );

    // Step 2: Send URLs to backend for crawling and indexing
    const crawlResponse = await fetch(`${CONFIG.BACKEND_URL}/api/crawl`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ urls: urls, userEmail: userEmail }),
    });

    if (!crawlResponse.ok) {
      throw new Error(`Crawling failed: ${crawlResponse.status}`);
    }

    const reader = crawlResponse.body.getReader();
    const decoder = new TextDecoder();

    let processedCount = 0;
    let totalUrls = Math.min(sitemapData.urls.length, 5);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            await handleStreamEvent(domain, data, totalUrls);

            if (data.type === "url_complete") {
              processedCount++;
            }
          } catch (e) {
            console.error("Error parsing SSE data:", e);
          }
        }
      }
    }

    // Finalization
    updateIndexingStatus(domain, "completing", 95, "Finalizing index...");
    await updateDomainIndex(domain, processedCount);

    updateIndexingStatus(
      domain,
      "completed",
      100,
      `Successfully indexed ${processedCount} pages!`
    );

    setTimeout(() => {
      indexingStatus.delete(domain);
    }, 3000);
  } catch (error) {
    console.error(`❌ Indexing failed for ${domain}:`, error);
    updateIndexingStatus(domain, "error", 0, `Error: ${error.message}`);

    setTimeout(() => {
      indexingStatus.delete(domain);
    }, 5000);

    throw error;
  }
}

function updateIndexingStatus(domain, status, progress, message) {
  const statusData = {
    status,
    progress,
    message,
    timestamp: Date.now(),
  };

  indexingStatus.set(domain, statusData);

  // Broadcast status update to sidepanel
  chrome.runtime
    .sendMessage({
      type: "INDEXING_STATUS_UPDATE",
      domain,
      statusData,
    })
    .catch(() => {});

  if (CONFIG.DEBUG) {
    console.log(`📊 ${domain}: ${status} - ${progress}% - ${message}`);
  }
}

async function updateDomainIndex(domain, urlCount) {
  const { indexedDomains } = await chrome.storage.local.get(["indexedDomains"]);

  indexedDomains[domain] = {
    lastIndexed: Date.now(),
    urlCount: urlCount,
    version: "1.0",
  };

  await chrome.storage.local.set({ indexedDomains });
  console.log(`📝 Updated local storage for domain: ${domain}`);
}

async function handleSearchDocumentation(query, domain, sendResponse) {
  try {
    console.log(`🔍 Searching for: "${query}" using backend`);

    const searchResponse = await fetch(`${CONFIG.BACKEND_URL}/api/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: query,
        userEmail: userEmail,
        topK: 5,
        domain: domain,
      }),
    });

    if (!searchResponse.ok) {
      throw new Error(`Search failed: ${searchResponse.status}`);
    }

    const searchData = await searchResponse.json();

    if (!searchData.success) {
      throw new Error("Search process failed");
    }

    console.log(`📊 Found ${searchData.results.length} search results`);

    // Format results for the AI
    const contextChunks = searchData.results.map((result) => ({
      content: result.text,
      url: result.url,
      score: result.score,
      chunkIndex: result.chunkIndex,
    }));

    sendResponse({
      success: true,
      results: contextChunks,
      query: query,
    });
  } catch (error) {
    console.error("❌ Search failed:", error);
    sendResponse({
      success: false,
      error: error.message,
    });
  }
}
