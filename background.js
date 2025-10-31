
// background.js
const CONFIG = {
  BACKEND_URL: "http://localhost:3000",
  DEBUG: true,
  MAX_URLS_TO_CRAWL: 50,
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
          chunkSize: 1000,
          maxChunks: 50,
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
    try {
      const url = new URL(tab.url);
      const domain = url.hostname;
      await updateIconForDomain(domain, tabId);
      sendTabInfoToSidepanel(tab);
    } catch (error) {
      if (CONFIG.DEBUG) {
        console.log("Error processing tab update:", error.message);
      }
    }
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

// Test backend connection
async function testBackendConnection(sendResponse) {
  try {
    console.log("Testing backend connection...");

    const response = await fetch(`${CONFIG.BACKEND_URL}/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (response.ok) {
      const result = await response.json();
      console.log("✅ Backend Connected:", result);
      sendResponse({
        success: true,
        status: "Backend server is running",
        data: result,
      });
    } else {
      throw new Error(`Backend returned ${response.status}: ${response.statusText}`);
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
    { pattern: /advanced|migration|troubleshooting/i, score: 50 },
    { pattern: /faq|help|support/i, score: 45 },
    { pattern: /\/v\d+\/|version/i, score: 40 },
    { pattern: /changelog|release|updates/i, score: 35 },
  ];

  const structureBoosts = [
    { pattern: /^[^\/]*\/docs?\//i, boost: 20 },
    { pattern: /^[^\/]*\/(guide|tutorial|api)\//i, boost: 15 },
    { pattern: /readme/i, boost: 10 },
    { pattern: /index|home|main/i, boost: 5 },
  ];

  const scoredUrls = urls.map((url) => {
    let score = 0;
    const urlLower = url.toLowerCase();
    const urlPath = url.replace(baseUrl, "").toLowerCase();

    // Apply pattern scoring
    for (const { pattern, score: patternScore } of docPatterns) {
      if (pattern.test(urlLower)) {
        score = Math.max(score, patternScore);
        break;
      }
    }

    // Apply structure boosts
    for (const { pattern, boost } of structureBoosts) {
      if (pattern.test(urlLower)) {
        score += boost;
      }
    }

    // Path depth scoring
    const pathDepth = (urlPath.match(/\//g) || []).length;
    if (pathDepth <= 2) score += 10;
    if (pathDepth <= 1) score += 5;

    // Penalties
    if (url.includes("?")) score -= 10;
    if (url.length > 100) score -= 5;

    // Root path bonus
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
    const isCurrentlyIndexing = indexingStatus.has(domain);

    const status = {
      isIndexed: !!domainInfo,
      lastIndexed: domainInfo?.lastIndexed || null,
      urlCount: domainInfo?.urlCount || 0,
      isCurrentlyIndexing: isCurrentlyIndexing,
    };

    console.log(`📊 Indexing status for ${domain}:`, status);
    sendResponse({ success: true, status });
  } catch (error) {
    console.error("Error checking indexing status:", error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleStartIndexing(domain, baseUrl, sendResponse) {
  try {
    console.log(`🚀 Starting indexing for ${domain} with baseUrl: ${baseUrl}`);

    if (indexingStatus.has(domain)) {
      console.warn(`Already indexing ${domain}`);
      sendResponse({ success: false, error: "Already indexing this domain" });
      return;
    }

    // Initialize indexing status
    indexingStatus.set(domain, {
      status: "starting",
      progress: 0,
      urls: [],
      startTime: Date.now(),
    });

    // Send immediate response
    sendResponse({ success: true, message: "Indexing started" });

    // Start the actual indexing process
    await startDocumentationIndexing(domain, baseUrl);

  } catch (error) {
    console.error("Error starting indexing:", error);
    indexingStatus.delete(domain);
    updateIndexingStatus(domain, "error", 0, `Error: ${error.message}`);
    
    // Don't call sendResponse here as it was already called above
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
  console.log(`📡 Stream event for ${domain}:`, data.type, data.message);

  switch (data.type) {
    case "start":
      updateIndexingStatus(domain, "starting", 5, data.message || "Starting indexing...");
      break;

    case "progress":
      const progress = 10 + (data.progress || 0) * 0.6; // Scale to 10-70%
      updateIndexingStatus(domain, "crawling", progress, data.message || "Processing...");
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
      const completedProgress = 10 + (data.progress || 0) * 0.6;
      const message = data.wasAlreadyIndexed
        ? `Already indexed: ${data.url}`
        : `Completed: ${data.chunks || 0} chunks, ${data.vectors || 0} vectors`;
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
      updateIndexingStatus(domain, "finalizing", 90, data.message || "Finalizing...");
      break;

    case "error":
      throw new Error(data.message || "Unknown error during indexing");
  }
}

async function startDocumentationIndexing(domain, baseUrl) {
  try {
    console.log(`🚀 Starting indexing for ${domain} using backend`);

    // Step 1: Discover URLs using backend sitemap endpoint
    updateIndexingStatus(
      domain,
      "discovering",
      5,
      "Discovering documentation URLs..."
    );

    console.log(`🔍 Fetching sitemap from: ${CONFIG.BACKEND_URL}/api/sitemap`);
    
    const sitemapResponse = await fetch(`${CONFIG.BACKEND_URL}/api/sitemap`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: baseUrl }),
    });

    console.log(`📡 Sitemap response status: ${sitemapResponse.status}`);

    if (!sitemapResponse.ok) {
      const errorText = await sitemapResponse.text();
      console.error(`❌ Sitemap error response:`, errorText);
      throw new Error(`Sitemap extraction failed: ${sitemapResponse.status} - ${errorText}`);
    }

    const sitemapData = await sitemapResponse.json();
    console.log(`📄 Sitemap data received:`, sitemapData);

    if (!sitemapData.success || !sitemapData.urls || sitemapData.urls.length === 0) {
      throw new Error(`No URLs found in sitemap. Response: ${JSON.stringify(sitemapData)}`);
    }

    const allUrls = sitemapData.urls;
    console.log(`📄 Discovered ${allUrls.length} URLs from sitemap`);
    
    updateIndexingStatus(
      domain,
      "prioritizing",
      10,
      "Prioritizing key documentation pages..."
    );

    const prioritizedUrls = prioritizeDocumentationUrls(allUrls, baseUrl);
    const finalUrls = prioritizedUrls.slice(0, CONFIG.MAX_URLS_TO_CRAWL);

    console.log(`🎯 Selected ${finalUrls.length} URLs for indexing:`, finalUrls.slice(0, 5));

    updateIndexingStatus(
      domain,
      "crawling",
      15,
      `Processing ${finalUrls.length} pages...`
    );

    // Step 2: Send URLs to backend for crawling and indexing
    console.log(`🚀 Starting crawl with: ${CONFIG.BACKEND_URL}/api/crawl`);
    
    const crawlResponse = await fetch(`${CONFIG.BACKEND_URL}/api/crawl`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ 
        urls: finalUrls, 
        userEmail: userEmail || 'anonymous@example.com',
        domain: domain
      }),
    });

    console.log(`📡 Crawl response status: ${crawlResponse.status}`);

    if (!crawlResponse.ok) {
      const errorText = await crawlResponse.text();
      console.error(`❌ Crawl error response:`, errorText);
      throw new Error(`Crawling failed: ${crawlResponse.status} - ${errorText}`);
    }

    // Process streaming response
    const reader = crawlResponse.body.getReader();
    const decoder = new TextDecoder();
    let processedCount = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.slice(6));
            console.log(`📊 Stream data:`, data);
            
            await handleStreamEvent(domain, data, finalUrls.length);

            if (data.type === "url_complete") {
              processedCount++;
            }
          } catch (e) {
            console.error("Error parsing SSE data:", e, "Line:", line);
          }
        }
      }
    }

    // Finalization
    updateIndexingStatus(domain, "completing", 95, "Finalizing index...");
    await updateDomainIndex(domain, processedCount);

    updateIndexingStatus(
      domain,
      "complete",
      100,
      `Successfully indexed ${processedCount} pages!`
    );

    // Clean up after 3 seconds
    setTimeout(() => {
      indexingStatus.delete(domain);
      console.log(`✅ Indexing completed for ${domain}`);
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
    .catch((error) => {
      if (CONFIG.DEBUG) {
        console.log("Failed to send status update to sidepanel:", error.message);
      }
    });

  if (CONFIG.DEBUG) {
    console.log(`📊 ${domain}: ${status} - ${progress}% - ${message}`);
  }
}

async function updateDomainIndex(domain, urlCount) {
  try {
    const { indexedDomains } = await chrome.storage.local.get(["indexedDomains"]);

    indexedDomains[domain] = {
      lastIndexed: Date.now(),
      urlCount: urlCount,
      version: "1.0",
    };

    await chrome.storage.local.set({ indexedDomains });
    console.log(`📝 Updated local storage for domain: ${domain}`);

    // Update icon to show indexed status
    await updateIconForDomain(domain);
  } catch (error) {
    console.error("Error updating domain index:", error);
  }
}

async function handleSearchDocumentation(query, domain, sendResponse) {
  try {
    console.log(`🔍 Searching for: "${query}" in domain: ${domain}`);

    const searchResponse = await fetch(`${CONFIG.BACKEND_URL}/api/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: query,
        userEmail: userEmail || 'anonymous@example.com',
        topK: 5,
        domain: domain,
      }),
    });

    console.log(`📡 Search response status: ${searchResponse.status}`);

    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      console.error(`❌ Search error response:`, errorText);
      throw new Error(`Search failed: ${searchResponse.status} - ${errorText}`);
    }

    const searchData = await searchResponse.json();
    console.log(`📊 Search data received:`, searchData);

    if (!searchData.success) {
      throw new Error(`Search process failed: ${searchData.error || 'Unknown error'}`);
    }

    console.log(`📊 Found ${searchData.results?.length || 0} search results`);

    const contextChunks = (searchData.results || []).map((result) => ({
      content: result.text || result.content || '',
      url: result.url || '',
      score: result.score || 0,
      chunkIndex: result.chunkIndex || 0,
      title: result.title || result.url || 'Untitled',
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