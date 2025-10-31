//sidepanel.js
class DocumentationGuide {
  constructor() {
    this.currentDomain = null;
    this.currentUrl = null;
    this.aiSession = null;
    this.isInitialized = false;
    this.tokenCount = 0;
    this.conversationHistory = [];
    this.indexingInProgress = false;
    this.searchCache = new Map();
    this.currentChatId = null;
    this.chatHistory = new Map();

    this.init();
  }

  async init() {
    this.setupEventListeners();
    this.setupMessageListener();
    this.setupExternalLinkHandlers();
    await this.checkBackendConnection();
    await this.initializeAI();
    this.requestCurrentTab();
  }

  async initializeAI() {
    try {
      this.updateAIStatus("loading", "Checking AI availability...");

      if (!("LanguageModel" in self)) {
        throw new Error("LanguageModel API not available");
      }

      this.updateAIStatus("loading", "Initializing AI model...");

      const { defaultTopK, maxTopK, defaultTemperature, maxTemperature } =
        await LanguageModel.params();

      this.aiSession = await LanguageModel.create({
        temperature: 0.3,
        topK: 1,
        outputLanguage: "en",
        initialPrompts: [
          {
            role: "system",
            content: `You help users with ${
              this.currentDomain || "website"
            } documentation.

ONLY respond "search-tool" if the user asks about:
- Website features or functionality
- How-to guides for the website
- Specific pages or sections
- Technical details about the website

For everything else (greetings, small talk, general knowledge), just answer directly.`,
          },
          {
            role: "user",
            content: "Hello there",
          },
          {
            role: "assistant",
            content: "Hi! How can I help you today?",
          },
          {
            role: "user",
            content: "What is JavaScript?",
          },
          {
            role: "assistant",
            content:
              "JavaScript is a programming language commonly used for web development. It allows you to add interactivity to websites.",
          },
          {
            role: "user",
            content: "How do I reset my password on this site?",
          },
          {
            role: "assistant",
            content: "search-tool",
          },
          {
            role: "user",
            content: "How are you doing?",
          },
          {
            role: "assistant",
            content:
              "I'm doing well, thanks for asking! Is there anything I can help you with?",
          },
        ],
      });

      this.updateAIStatus("ready", "AI Ready");
      this.isInitialized = true;
      this.updateInputState();
    } catch (error) {
      console.error("AI initialization failed:", error);
      this.updateAIStatus(
        "error",
        "AI unavailable - Please enable Chrome AI features"
      );
      this.showAIError();
    }
  }

  updateAIStatus(status, message) {
    const statusText = document.getElementById("status-text");
    const statusIndicator = document.getElementById("status-indicator");

    if (statusText) statusText.textContent = message;
    if (statusIndicator)
      statusIndicator.className = `status-indicator ${status}`;
  }

  showAIError() {
    const conversation = document.getElementById("conversation");
    const errorMessage = document.createElement("div");
    errorMessage.className = "message ai-message";
    errorMessage.innerHTML = `
      <div class="message-content">
        <p>⚠️ AI features are not available.</p>
        <p>To enable AI features, please join the <a href="https://goo.gle/chrome-ai-dev-preview-join" target="_blank">Chrome AI Early Preview Program</a>.</p>
      </div>
    `;

    const welcomeMessage = conversation.querySelector(".welcome-message");
    if (welcomeMessage) {
      welcomeMessage.replaceWith(errorMessage);
    }
  }

  setupEventListeners() {
    document.getElementById("chat-form").addEventListener("submit", (e) => {
      e.preventDefault();
      this.handleChatSubmit();
    });

    document.getElementById("reset-button").addEventListener("click", () => {
      this.resetConversation();
    });

    const newChatButton = document.getElementById("new-chat-button");
    if (newChatButton) {
      newChatButton.addEventListener("click", () => {
        console.log("New chat button clicked");
        this.createNewChat();
      });
    }

    const historyButton = document.getElementById("history-button");
    if (historyButton) {
      historyButton.addEventListener("click", () => {
        console.log("History button clicked");
        this.showHistoryModal();
      });
    }

    const deleteButton = document.getElementById("delete-chat-button");
    if (deleteButton) {
      deleteButton.addEventListener("click", () => {
        this.deleteCurrentChat();
      });
    }

    // Refresh/Start indexing button - handled dynamically in updateIndexingUI
    const refreshButton = document.getElementById("start-indexing-btn");
    if (refreshButton) {
      refreshButton.addEventListener("click", () => {
        this.requestCurrentTab();
      });
    }

    const textarea = document.getElementById("prompt-input");
    textarea.addEventListener("input", (e) => {
      this.autoResizeTextarea(e);
      this.updateInputState();
    });

    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.handleChatSubmit();
      }
    });
  }

  setupExternalLinkHandlers() {
    document.addEventListener("click", (e) => {
      const link = e.target.closest("a[data-external-url]");
      if (link) {
        e.preventDefault();
        const url = link.getAttribute("data-external-url");

        chrome.tabs.create({ url: url, active: false });
      }
    });
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      switch (message.type) {
        case "TAB_UPDATED":
        case "CURRENT_TAB":
          this.handleTabUpdate(message.tabInfo);
          break;
        case "INDEXING_STATUS_UPDATE":
          this.handleIndexingStatusUpdate(message.domain, message.statusData);
          break;
      }
      sendResponse({ received: true });
    });
  }

  async loadChatHistory() {
    if (!this.currentDomain) return;
    try {
      const key = `chat_history_${this.currentDomain}`;
      const result = await chrome.storage.local.get([key]);
      const historyData = result[key] || {};
      this.chatHistory = new Map(Object.entries(historyData));

      if (this.chatHistory.size === 0) {
        this.createNewChat();
      } else {
        const entries = Array.from(this.chatHistory.entries());
        const mostRecent = entries.sort(
          (a, b) => b[1].lastUpdated - a[1].lastUpdated
        )[0];
        this.loadChat(mostRecent[0]);
      }
    } catch (error) {
      console.error("Error loading chat history:", error);
      this.createNewChat();
    }
  }

  async saveChatHistory() {
    if (!this.currentDomain) return;
    try {
      const key = `chat_history_${this.currentDomain}`;
      const historyObject = Object.fromEntries(this.chatHistory);
      await chrome.storage.local.set({ [key]: historyObject });
    } catch (error) {
      console.error("Error saving chat history:", error);
    }
  }

  createNewChat() {
    console.log("Creating new chat...");
    this.currentChatId = `chat_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    const newChat = {
      id: this.currentChatId,
      domain: this.currentDomain,
      messages: [],
      created: Date.now(),
      lastUpdated: Date.now(),
      title: "New Chat",
    };

    this.chatHistory.set(this.currentChatId, newChat);
    this.resetConversationUI();
    this.updateDeleteButtonVisibility();
    this.saveChatHistory();
    console.log("New chat created:", this.currentChatId);
  }

  loadChat(chatId) {
    const chat = this.chatHistory.get(chatId);
    if (!chat) return;

    console.log("Loading chat:", chatId);
    this.currentChatId = chatId;
    this.renderChatMessages(chat.messages);
    this.updateDeleteButtonVisibility();
  }

  renderChatMessages(messages) {
    const conversation = document.getElementById("conversation");
    conversation.innerHTML = `
      <div class="welcome-message">
        <div class="message ai-message">
          <div class="message-content">
            <p>👋 Welcome! I'm your AI assistant for documentation. Ask me anything about <span id="welcome-domain">${
              this.currentDomain || "this website"
            }</span>.</p>
            <p>Type your question below to get started!</p>
          </div>
        </div>
      </div>
    `;

    messages.forEach((msg) => {
      this.addMessage(msg.content, msg.type, false, false);
    });

    this.scrollToBottom();
  }

  resetConversationUI() {
    const conversation = document.getElementById("conversation");
    conversation.innerHTML = `
      <div class="welcome-message">
        <div class="message ai-message">
          <div class="message-content">
            <p>👋 Hello! I'm your Documentation Guide AI assistant. I can help you understand and navigate content on <span id="welcome-domain">${
              this.currentDomain || "this website"
            }</span>.</p>
            <p>Feel free to ask me anything about the current page or domain!</p>
          </div>
        </div>
      </div>
    `;

    const welcomeDomain = document.getElementById("welcome-domain");
    if (welcomeDomain && this.currentDomain) {
      welcomeDomain.textContent = this.currentDomain;
    }

    this.scrollToBottom();
  }

  updateDeleteButtonVisibility() {
    const deleteButton = document.getElementById("delete-chat-button");
    if (deleteButton) {
      deleteButton.style.display = this.chatHistory.size > 1 ? "block" : "none";
    }
  }

  deleteCurrentChat() {
    if (this.chatHistory.size <= 1) return;

    if (confirm("Are you sure you want to delete this chat?")) {
      this.chatHistory.delete(this.currentChatId);
      this.saveChatHistory();

      const entries = Array.from(this.chatHistory.entries());
      const mostRecent = entries.sort(
        (a, b) => b[1].lastUpdated - a[1].lastUpdated
      )[0];
      this.loadChat(mostRecent[0]);
    }
  }

  showHistoryModal() {
    console.log("Showing history modal");
    const modal = document.getElementById("history-modal");
    const historyList = document.getElementById("history-list");

    historyList.innerHTML = "";

    const sortedChats = Array.from(this.chatHistory.values()).sort(
      (a, b) => b.lastUpdated - a.lastUpdated
    );

    if (sortedChats.length === 0) {
      historyList.innerHTML = `
        <div style="text-align: center; padding: 20px; color: var(--text-muted);">
          No chat history found
        </div>
      `;
    } else {
      sortedChats.forEach((chat) => {
        const historyItem = document.createElement("div");
        historyItem.className = `history-item ${
          chat.id === this.currentChatId ? "active" : ""
        }`;
        historyItem.innerHTML = `
          <div class="history-item-content">
            <div class="chat-title">${chat.title}</div>
            <div class="chat-preview">${new Date(
              chat.lastUpdated
            ).toLocaleDateString()} • ${chat.messages.length} messages</div>
          </div>
          <button class="delete-chat" data-chat-id="${
            chat.id
          }" title="Delete chat">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3,6 5,6 21,6"></polyline>
              <path d="M19,6V20A2,2 0 0,1 17,22H7A2,2 0 0,1 5,20V6M8,6V4A2,2 0 0,1 10,2H14A2,2 0 0,1 16,4V6"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        `;

        historyItem.addEventListener("click", (e) => {
          if (!e.target.closest(".delete-chat")) {
            this.loadChat(chat.id);
            this.hideHistoryModal();
          }
        });

        const deleteBtn = historyItem.querySelector(".delete-chat");
        deleteBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.deleteChatFromHistory(chat.id);
        });

        historyList.appendChild(historyItem);
      });
    }

    modal.style.display = "flex";

    const closeBtn = document.getElementById("close-history");
    const overlay = modal.querySelector(".history-modal-overlay");

    closeBtn.onclick = () => this.hideHistoryModal();
    overlay.onclick = () => this.hideHistoryModal();
  }

  hideHistoryModal() {
    const modal = document.getElementById("history-modal");
    modal.style.display = "none";
  }

  deleteChatFromHistory(chatId) {
    if (this.chatHistory.size <= 1) {
      alert("Cannot delete the last remaining chat.");
      return;
    }

    if (confirm("Are you sure you want to delete this chat?")) {
      this.chatHistory.delete(chatId);
      this.saveChatHistory();

      if (chatId === this.currentChatId) {
        const entries = Array.from(this.chatHistory.entries());
        const mostRecent = entries.sort(
          (a, b) => b[1].lastUpdated - a[1].lastUpdated
        )[0];
        this.loadChat(mostRecent[0]);
      }

      this.showHistoryModal();
    }
  }

  async checkBackendConnection() {
    try {
      const response = await this.sendMessage({ type: "TEST_CONNECTION" });
      if (response.success) {
        console.log("✅ Backend connection successful");
        this.updateConnectionStatus(true);
      } else {
        throw new Error(response.error);
      }
    } catch (error) {
      console.error("❌ Backend connection failed:", error);
      this.updateConnectionStatus(false, error.message);
    }
  }

  updateConnectionStatus(connected, errorMessage = "") {
    const statusSection = document.getElementById("status-section");
    const statusMessage = document.getElementById("status-message");

    if (!connected) {
      statusSection.style.display = "block";
      statusMessage.innerHTML = `
        <div class="status-icon">⚠️</div>
        <p><strong>Backend Server Error</strong></p>
        <p>${errorMessage}</p>
        <p>Please ensure the server is running on port 3000.</p>
      `;
      this.showChatSection(false);
    }
  }

  requestCurrentTab() {
    chrome.runtime.sendMessage({ type: "GET_CURRENT_TAB" });
  }

  handleTabUpdate(tabInfo) {
    if (
      !tabInfo.url ||
      tabInfo.url.startsWith("chrome://") ||
      tabInfo.url.startsWith("chrome-extension://")
    ) {
      this.showInvalidUrlMessage();
      return;
    }

    try {
      const url = new URL(tabInfo.url);
      const domain = url.hostname;
      const previousDomain = this.currentDomain;

      this.currentUrl = tabInfo.url;

      if (previousDomain && previousDomain !== domain) {
        console.log(`Domain changed from ${previousDomain} to ${domain}`);
        this.saveChatHistory();
        this.currentChatId = null;
        this.chatHistory.clear();
        this.searchCache.clear();
      }

      this.currentDomain = domain;

      if (!previousDomain || previousDomain !== domain) {
        this.loadChatHistory();
      }

      this.updateDomainDisplay(domain);
      this.checkIndexingStatus(domain);
      this.showChatSection(true);
    } catch (error) {
      console.error("Error parsing URL:", error);
      this.showInvalidUrlMessage();
    }
  }

  showInvalidUrlMessage() {
    const statusSection = document.getElementById("status-section");
    const statusMessage = document.getElementById("status-message");

    statusSection.style.display = "block";
    statusMessage.innerHTML = `
      <div class="status-icon">⚠️</div>
      <p>Please navigate to a website to start using the Documentation Guide.</p>
    `;

    this.showChatSection(false);
    this.updateDomainDisplay("No domain detected");
  }

  updateDomainDisplay(domain) {
    const domainText = document.getElementById("domain-text");
    const welcomeDomain = document.getElementById("welcome-domain");

    if (domainText) domainText.textContent = domain;
    if (welcomeDomain) welcomeDomain.textContent = domain;
  }

  showChatSection(show) {
    const statusSection = document.getElementById("status-section");
    const chatSection = document.getElementById("chat-section");

    if (show) {
      statusSection.style.display = "none";
      chatSection.style.display = "block";
    } else {
      statusSection.style.display = "block";
      chatSection.style.display = "none";
    }

    this.updateInputState();
  }

  async checkIndexingStatus(domain) {
    try {
      const response = await this.sendMessage({
        type: "CHECK_INDEXING_STATUS",
        domain,
      });

      if (response.success) {
        this.updateIndexingUI(response.status);
      }
    } catch (error) {
      console.error("Error checking indexing status:", error);
    }
  }

  updateIndexingUI(status) {
    const statusIndicator = document.getElementById("status-indicator");
    const statusText = document.getElementById("status-text");

    if (status.isCurrentlyIndexing) {
      statusIndicator.className = "status-indicator loading";
      statusText.textContent = "Indexing in progress...";
      this.indexingInProgress = true;
    } else if (status.isIndexed) {
      statusIndicator.className = "status-indicator ready";
      statusText.textContent = this.isInitialized
        ? "AI Ready"
        : "Initializing AI...";
      this.indexingInProgress = false;
    } else {
      statusIndicator.className = "status-indicator";
      statusText.innerHTML = `
        <button class="index-button" id="start-indexing-btn">
          Start Indexing
        </button>
      `;
      this.indexingInProgress = false;

      // Add event listener to dynamically created button
      setTimeout(() => {
        const btn = document.getElementById("start-indexing-btn");
        if (btn) {
          btn.addEventListener("click", () => {
            console.log("Start indexing button clicked");
            this.startIndexing();
          });
        }
      }, 0);
    }

    this.updateInputState();
  }

  handleIndexingStatusUpdate(domain, statusData) {
    console.log("Received indexing status update:", { domain, statusData });

    if (domain !== this.currentDomain) return;

    const statusIndicator = document.getElementById("status-indicator");
    const statusText = document.getElementById("status-text");

    if (!statusIndicator || !statusText) {
      console.error("Status elements not found in DOM");
      return;
    }

    switch (statusData.status) {
      case "starting":
      case "discovering":
      case "crawling":
      case "scraping":
      case "processing":
      case "embedding":
      case "indexing":
      case "finalizing":
        statusIndicator.className = "status-indicator loading";
        const progressText = statusData.progress
          ? `${statusData.message} (${Math.round(statusData.progress)}%)`
          : statusData.message;
        statusText.textContent = progressText;
        this.indexingInProgress = true;
        break;

      case "complete":
        statusIndicator.className = "status-indicator ready";
        statusText.textContent = this.isInitialized
          ? "AI Ready"
          : "Initializing AI...";
        this.indexingInProgress = false;
        this.updateIndexingUI({ isIndexed: true, isCurrentlyIndexing: false });
        break;

      case "error":
        statusIndicator.className = "status-indicator error";
        statusText.textContent = `Error: ${statusData.message}`;
        this.indexingInProgress = false;
        break;

      default:
        console.warn("Unknown indexing status:", statusData.status);
    }

    this.updateInputState();
  }

  startIndexingProgressCheck() {
    if (!this.indexingInProgress) return;

    const checkProgress = async () => {
      try {
        const response = await this.sendMessage({
          type: "GET_INDEXING_PROGRESS",
          domain: this.currentDomain,
        });

        if (response.success && this.indexingInProgress) {
          setTimeout(checkProgress, 2000);
        }
      } catch (error) {
        console.error("Error checking progress:", error);
      }
    };

    setTimeout(checkProgress, 2000);
  }

  // FIXED: Added the missing startIndexing method
  async startIndexing() {
    console.log("🚀 Starting indexing process...");

    if (!this.currentDomain || !this.currentUrl) {
      console.error("No domain or URL available for indexing");
      return;
    }

    try {
      const url = new URL(this.currentUrl);
      const baseUrl = `${url.protocol}//${url.host}`;

      console.log(
        `Starting indexing for domain: ${this.currentDomain}, baseUrl: ${baseUrl}`
      );

      const response = await this.sendMessage({
        type: "START_INDEXING",
        domain: this.currentDomain,
        baseUrl: baseUrl,
      });

      console.log("Indexing response:", response);

      if (response.success) {
        this.indexingInProgress = true;
        this.updateIndexingUI({ isCurrentlyIndexing: true });
        this.startIndexingProgressCheck();
        console.log("✅ Indexing started successfully");
      } else {
        throw new Error(response.error);
      }
    } catch (error) {
      console.error("Error starting indexing:", error);
      this.showError(`Failed to start indexing: ${error.message}`);
    }
  }

  updateInputState() {
    const sendButton = document.getElementById("send-button");
    const promptInput = document.getElementById("prompt-input");

    const canChat = this.isInitialized && !this.indexingInProgress;
    const hasText = promptInput && promptInput.value.trim();

    if (sendButton) sendButton.disabled = !canChat || !hasText;
    if (promptInput) {
      promptInput.disabled = !canChat;
      promptInput.placeholder = canChat
        ? `Ask me anything about ${this.currentDomain || "this domain"}...`
        : this.indexingInProgress
        ? "Indexing in progress..."
        : "Initializing...";
    }
  }

  async handleChatSubmit() {
    const promptInput = document.getElementById("prompt-input");
    const query = promptInput.value.trim();

    if (!query || !this.isInitialized || this.indexingInProgress) return;

    promptInput.value = "";
    this.autoResizeTextarea({ target: promptInput });
    this.updateInputState();

    this.addMessage(query, "user");

    try {
      await this.processWithAI(query);
    } catch (error) {
      console.error("Chat error:", error);
      this.addMessage(`Error: ${error.message}`, "ai");
    }
  }

  async processWithAI(query) {
    const responseDiv = this.addMessage("", "ai");
    const messageContent = responseDiv.querySelector(".message-content");

    try {
      messageContent.innerHTML = "<p></p>";
      messageContent.classList.add("generating");

      const initialPrompt = `
You are a documentation assistant for ${this.currentDomain}.

If the user's question is about website features, how-to guides, specific pages, or technical details, reply ONLY with "search-tool".

If the question is a greeting, general knowledge, or casual chat, answer directly and DO NOT reply with "search-tool".

Examples:
User: Hello
Assistant: Hi! How can I help you today?

User: What is JavaScript?
Assistant: JavaScript is a programming language used for web development.

User: How do I reset my password on this site?
Assistant: search-tool

User: How are you?
Assistant: I'm doing well, thanks! How can I assist you?

User question: "${query}"
Assistant:
`;

      const stream = await this.aiSession.promptStreaming(initialPrompt);
      let result = "";
      let previousChunk = "";

      for await (const chunk of stream) {
        const newChunk = chunk.startsWith(previousChunk)
          ? chunk.slice(previousChunk.length)
          : chunk;
        result += newChunk;
        previousChunk = chunk;
      }
      result = result.trim();

      const isSearchNeeded =
        result === "search-tool" ||
        result.startsWith("search-tool\n") ||
        result.startsWith("search-tool\r");

      if (isSearchNeeded) {
        messageContent.innerHTML = "<p>🔍 Searching documentation...</p>";

        const searchResults = await this.searchDocumentation(query);

        if (searchResults && searchResults.length > 0) {
          messageContent.innerHTML = "<p>📝 Generating response...</p>";
          await this.generateContextualResponse(
            query,
            searchResults,
            messageContent
          );
        } else {
          messageContent.classList.remove("generating");
          messageContent.innerHTML = `<p>No documentation found for this query. Please try indexing the website or ask differently.</p>`;
        }
      } else {
        messageContent.classList.remove("generating");
        const formattedResult = this.formatMarkdown(result);
        messageContent.innerHTML = formattedResult;
        this.saveMessageToHistory(result, "ai");
      }

      this.updateTokenCount();
      this.scrollToBottom();
    } catch (error) {
      console.error("AI processing error:", error);
      messageContent.classList.remove("generating");
      messageContent.innerHTML = `<p>❌ Sorry, I encountered an error: ${error.message}</p>`;
      this.saveMessageToHistory("Error: " + error.message, "ai");
    }
  }

  async generateContextualResponse(query, searchResults, messageContent) {
    try {
      const context =
        searchResults && searchResults.length > 0
          ? searchResults
              .map(
                (result, index) =>
                  `[Source ${index + 1}: ${result.title} - ${result.url}]\n${
                    result.content
                  }`
              )
              .join("\n\n")
          : "";

      const contextualPrompt = context
        ? `Context from ${this.currentDomain} documentation:
${context}

User question: ${query}

Please answer using the provided context. Be specific and cite sources when referencing information. If the context doesn't contain enough information, mention this limitation.`
        : `The user is asking about ${this.currentDomain}: "${query}"

Please provide helpful information. Note that specific documentation context is not available, so provide general guidance.`;

      const stream = await this.aiSession.promptStreaming(contextualPrompt);
      let result = "";
      let previousChunk = "";

      messageContent.classList.remove("generating");

      for await (const chunk of stream) {
        const newChunk = chunk.startsWith(previousChunk)
          ? chunk.slice(previousChunk.length)
          : chunk;
        result += newChunk;

        const formattedResult = this.formatMarkdown(result);
        messageContent.innerHTML = formattedResult;

        this.scrollToBottom();
        previousChunk = chunk;
      }

      if (searchResults && searchResults.length > 0) {
        this.addSourceLinks(messageContent, searchResults);
      }
      this.saveMessageToHistory(result, "ai");
    } catch (error) {
      console.error("Contextual response error:", error);
      messageContent.innerHTML = `<p>❌ Error generating response: ${error.message}</p>`;
      this.saveMessageToHistory("Error: " + error.message, "ai");
    }
  }

  async searchDocumentation(query) {
    if (!this.currentDomain) return [];

    const cacheKey = `${this.currentDomain}:${query}`;
    if (this.searchCache.has(cacheKey)) {
      return this.searchCache.get(cacheKey);
    }

    try {
      const response = await this.sendMessage({
        type: "SEARCH_DOCUMENTATION",
        query: query,
        domain: this.currentDomain,
      });

      if (response.success && response.results) {
        this.searchCache.set(cacheKey, response.results);

        if (this.searchCache.size > 50) {
          const firstKey = this.searchCache.keys().next().value;
          this.searchCache.delete(firstKey);
        }

        return response.results;
      }

      return [];
    } catch (error) {
      console.error("Error searching documentation:", error);
      return [];
    }
  }

  addSourceLinks(contentDiv, searchResults) {
    const sourceSection = document.createElement("div");
    sourceSection.className = "source-links";

    const uniqueUrls = [...new Set(searchResults.map((r) => r.url))];

    sourceSection.innerHTML = `
      <div class="sources-header">📚 Sources:</div>
      <div class="sources-list">
        ${uniqueUrls
          .slice(0, 3)
          .map((url, index) => {
            const result = searchResults.find((r) => r.url === url);
            return `
            <a href="${url}" target="_blank" class="source-link">
              <span class="source-number">${index + 1}</span>
              <span class="source-title">${result.url}</span>
            </a>
          `;
          })
          .join("")}
      </div>
    `;

    contentDiv.appendChild(sourceSection);
  }

  addMessage(content, type, isLoading = false, saveToHistory = true) {
    const conversation = document.getElementById("conversation");
    const messageDiv = document.createElement("div");
    messageDiv.className = `message ${type}-message${
      isLoading ? " loading" : ""
    }`;

    const formattedContent = content
      ? type === "ai"
        ? this.formatMarkdown(content)
        : `<p>${content}</p>`
      : "<p></p>";

    messageDiv.innerHTML = `
  <div class="message-content">
    ${formattedContent}
  </div>
`;

    if (saveToHistory && this.currentChatId) {
      messageDiv.setAttribute("data-save-to-history", "true");
      messageDiv.setAttribute("data-message-type", type);
      if (type === "user" && content.trim()) {
        this.saveMessageToHistory(content, type);
      }
    }

    conversation.appendChild(messageDiv);
    this.scrollToBottom();

    return messageDiv;
  }

  saveMessageToHistory(content, type) {
    if (!this.currentChatId || !content.trim()) return;

    const chat = this.chatHistory.get(this.currentChatId);
    if (chat) {
      chat.messages.push({
        content: content.trim(),
        type,
        timestamp: Date.now(),
      });
      chat.lastUpdated = Date.now();

      if (
        type === "user" &&
        chat.messages.filter((m) => m.type === "user").length === 1
      ) {
        chat.title =
          content.substring(0, 50) + (content.length > 50 ? "..." : "");
      }

      this.saveChatHistory();
    }
  }

  async resetConversation() {
    try {
      if (this.aiSession) {
        this.aiSession.destroy();
      }

      this.resetConversationUI();
      this.conversationHistory = [];
      this.searchCache.clear();
      this.scrollToBottom();

      await this.initializeAI();
      this.tokenCount = 0;
      this.updateTokenCount();
    } catch (error) {
      console.error("Error resetting session:", error);
    }
  }

  updateTokenCount() {
    const tokensUsed = document.getElementById("tokens-used");
    if (tokensUsed) {
      if (this.aiSession && this.aiSession.tokensSoFar !== undefined) {
        this.tokenCount = this.aiSession.tokensSoFar;
        tokensUsed.textContent = `${this.tokenCount}`;
      } else {
        const totalText = this.conversationHistory.join(" ");
        const estimatedTokens = Math.ceil(totalText.length / 4);
        tokensUsed.textContent = `${estimatedTokens}`;
      }
    }
  }

  formatTables(text) {
    const tableRegex = /\|.*\|\n\|[-:\s|]+\|\n(\|.*\|\n?)+/g;

    return text.replace(tableRegex, (match) => {
      const rows = match.trim().split("\n");
      const headerRow = rows[0];
      const separatorRow = rows[1];
      const dataRows = rows.slice(2);

      const headers = headerRow
        .split("|")
        .slice(1, -1)
        .map((h) => h.trim());
      const data = dataRows.map((row) =>
        row
          .split("|")
          .slice(1, -1)
          .map((cell) => cell.trim())
      );

      let table = "<table><thead><tr>";
      headers.forEach((header) => {
        table += `<th>${header}</th>`;
      });
      table += "</tr></thead><tbody>";

      data.forEach((row) => {
        table += "<tr>";
        row.forEach((cell) => {
          table += `<td>${cell}</td>`;
        });
        table += "</tr>";
      });

      table += "</tbody></table>";
      return table;
    });
  }

  formatLists(text) {
    text = text.replace(/^(\s*)[-*+] (.+)$/gm, (match, indent, content) => {
      const level = Math.floor(indent.length / 2);
      return `<li style="margin-left: ${level * 20}px">${content}</li>`;
    });

    text = text.replace(/^(\s*)\d+\. (.+)$/gm, (match, indent, content) => {
      const level = Math.floor(indent.length / 2);
      return `<li style="margin-left: ${level * 20}px">${content}</li>`;
    });

    text = text.replace(/(<li[^>]*>.*<\/li>\n?)+/g, (match) => {
      const hasNumbers =
        match.includes("1.") || match.includes("2.") || match.includes("3.");
      const listType = hasNumbers ? "ol" : "ul";
      return `<${listType}>${match}</${listType}>`;
    });

    return text;
  }

  formatMarkdown(text) {
    if (!text) return "";

    text = text.replace(
      /```(\w+)?\n?([\s\S]*?)```/g,
      (match, language, code) => {
        const lang = language ? language.toLowerCase() : "text";
        const langDisplay = language ? language.toUpperCase() : "CODE";
        const codeId = "code_" + Math.random().toString(36).substr(2, 9);

        return `<div class="code-block">
        <div class="code-header">
          <span class="code-language">${langDisplay}</span>
          <button class="copy-button" onclick="window.copyCode('${codeId}')">Copy</button>
        </div>
        <div class="code-content">
          <pre id="${codeId}"><code class="language-${lang}">${this.escapeHtml(
          code.trim()
        )}</code></pre>
        </div>
      </div>`;
      }
    );

    text = text.replace(/`([^`]+)`/g, "<code>$1</code>");

    text = text.replace(/^### (.*$)/gm, "<h3>$1</h3>");
    text = text.replace(/^## (.*$)/gm, "<h2>$1</h2>");
    text = text.replace(/^# (.*$)/gm, "<h1>$1</h1>");

    text = text.replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>");
    text = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/\*(.*?)\*/g, "<em>$1</em>");

    text = text.replace(/~~(.*?)~~/g, "<del>$1</del>");

    text = text.replace(/^> (.*$)/gm, "<blockquote>$1</blockquote>");

    text = text.replace(/^---$/gm, "<hr>");

    text = this.formatTables(text);

    text = this.formatLists(text);

    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, linkText, url) => {
      const isExternal =
        url.startsWith("http://") || url.startsWith("https://");

      if (isExternal) {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="external-link" data-external-url="${url}">
        ${linkText}
        <span class="external-link-icon">↗</span>
      </a>`;
      }

      return `<a href="${url}" class="internal-link">${linkText}</a>`;
    });

    text = text.replace(
      /(?<!href="|data-external-url=")(https?:\/\/[^\s<>"]+)/g,
      '<a href="$1" target="_blank" rel="noopener noreferrer" class="external-link" data-external-url="$1">$1 <span class="external-link-icon">↗</span></a>'
    );

    text = text.replace(/\n\n/g, "</p><p>");
    text = text.replace(/\n/g, "<br>");

    if (
      !text.includes("<p>") &&
      !text.includes("<div>") &&
      !text.includes("<ul>") &&
      !text.includes("<ol>")
    ) {
      text = "<p>" + text + "</p>";
    }

    return text;
  }

  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  copyCode(codeId) {
    const codeElement = document.getElementById(codeId);
    if (codeElement) {
      const text = codeElement.textContent;
      navigator.clipboard.writeText(text).then(() => {
        const button = event.target;
        const originalText = button.textContent;
        button.textContent = "Copied!";
        button.style.background = "var(--success-color)";
        setTimeout(() => {
          button.textContent = originalText;
          button.style.background = "";
        }, 2000);
      });
    }
  }

  scrollToBottom() {
    requestAnimationFrame(() => {
      const conversation = document.getElementById("conversation");
      if (conversation) {
        conversation.scrollTop = conversation.scrollHeight;
      }
    });
  }

  autoResizeTextarea(event) {
    const textarea = event.target;
    textarea.style.height = "auto";
    const newHeight = Math.min(textarea.scrollHeight, 120);
    textarea.style.height = newHeight + "px";
  }

  showError(message) {
    const statusSection = document.getElementById("status-section");
    const statusMessage = document.getElementById("status-message");

    statusSection.style.display = "block";
    statusMessage.innerHTML = `
      <div class="status-icon">❌</div>
      <p><strong>Error</strong></p>
      <p>${message}</p>
    `;

    setTimeout(() => {
      statusSection.style.display = "none";
    }, 5000);
  }

  sendMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }
}

// Expose copyCode function globally for onclick handlers
window.copyCode = function (codeId) {
  const codeElement = document.getElementById(codeId);
  if (codeElement) {
    const text = codeElement.textContent;
    navigator.clipboard.writeText(text).then(() => {
      const button = event.target;
      const originalText = button.textContent;
      button.textContent = "Copied!";
      button.style.background = "var(--success-color)";
      setTimeout(() => {
        button.textContent = originalText;
        button.style.background = "";
      }, 2000);
    });
  }
};

document.addEventListener("DOMContentLoaded", () => {
  new DocumentationGuide();
});
