// ============================================================
// Instant Context Sidebar - Content Script
// Injected into every page. Manages the floating toggle button,
// sidebar UI, history, and Azure OpenAI API for content generation.
// ============================================================

(function () {
  "use strict";

  if (document.getElementById("ics-sidebar-container")) return;

  const api = typeof browser !== "undefined" ? browser : chrome;
  const MAX_HISTORY = 30;

  // ---- Azure OpenAI API ----

  let azureConfig = null;

  async function loadConfig() {
    if (azureConfig) return azureConfig;
    const configUrl = api.runtime.getURL("config.json");
    const response = await fetch(configUrl);
    if (!response.ok) throw new Error("Failed to load config.json");
    const config = await response.json();
    azureConfig = config.azure_openai;
    return azureConfig;
  }

  async function callAzureOpenAI(prompt) {
    const cfg = await loadConfig();
    const url = `${cfg.endpoint}/openai/deployments/${cfg.deployment_name}/chat/completions?api-version=${cfg.api_version}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": cfg.api_key,
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "You are a helpful assistant that analyzes webpage content." },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 2048,
      }),
    });
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Azure OpenAI error (${response.status}): ${err}`);
    }
    const data = await response.json();
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new Error("No response from Azure OpenAI");
    return text;
  }

  async function generateSummary(content) {
    return callAzureOpenAI(
      `Given the following webpage content, provide a concise "What this page is really about" summary in 2-4 sentences. Focus on the core message, purpose, and key takeaway. Do not use markdown formatting.\n\nWebpage content:\n${content}`
    );
  }

  async function generateKeyword(content) {
    return callAzureOpenAI(
      `Given the following webpage content, generate a single short keyword or phrase (2-5 words max) that best describes the main topic of this page. Return ONLY the keyword, nothing else.\n\nWebpage content:\n${content}`
    );
  }

  async function generateDefinitions(content) {
    const result = await callAzureOpenAI(
      `Given the following webpage content, identify up to 8 important technical terms, jargon, or key concepts that a reader might not immediately understand. For each, provide a brief, clear definition (1-2 sentences).\n\nReturn ONLY a JSON array of objects with "term" and "definition" fields. No other text.\n\nWebpage content:\n${content}`
    );
    try {
      const match = result.match(/\[[\s\S]*\]/);
      return match ? JSON.parse(match[0]) : JSON.parse(result);
    } catch {
      return [];
    }
  }

  async function generateRelatedLinks(content, url) {
    const result = await callAzureOpenAI(
      `Given the following webpage content and URL, suggest up to 6 related topics or resources that would help the reader explore further.\n\nFor each, provide a title and a Google search URL (https://www.google.com/search?q=<encoded query>).\n\nReturn ONLY a JSON array of objects with "title" and "url" fields. No other text.\n\nPage URL: ${url}\n\nWebpage content:\n${content}`
    );
    try {
      const match = result.match(/\[[\s\S]*\]/);
      return match ? JSON.parse(match[0]) : JSON.parse(result);
    } catch {
      return [];
    }
  }

  // ---- History helpers ----

  async function getHistory() {
    return new Promise((resolve) => {
      api.storage.local.get("ics_history", (result) => {
        resolve(result.ics_history || []);
      });
    });
  }

  async function saveToHistory(entry) {
    const history = await getHistory();
    // Remove duplicate URL if exists
    const filtered = history.filter((h) => h.url !== entry.url);
    filtered.unshift(entry);
    // Keep max entries
    const trimmed = filtered.slice(0, MAX_HISTORY);
    return new Promise((resolve) => {
      api.storage.local.set({ ics_history: trimmed }, resolve);
    });
  }

  async function clearHistory() {
    return new Promise((resolve) => {
      api.storage.local.set({ ics_history: [] }, resolve);
    });
  }

  function timeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return "Just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
  }

  // ---- Page content extraction ----

  function extractPageContent() {
    const clone = document.body.cloneNode(true);
    const remove = [
      "script","style","noscript","iframe","svg","nav","header","footer",
      "[role='navigation']","[role='banner']","[role='contentinfo']",
      ".sidebar",".nav",".menu",".ad",".advertisement",".cookie-banner",".popup",".modal",
      "#ics-sidebar-container","#ics-fab",
    ];
    remove.forEach((s) => clone.querySelectorAll(s).forEach((el) => el.remove()));
    let text = (clone.innerText || clone.textContent || "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .join("\n");
    return text.length > 6000 ? text.substring(0, 6000) + "\n[Content truncated...]" : text;
  }

  function extractPageLinks() {
    const links = [];
    const seen = new Set();
    document.querySelectorAll("a[href]").forEach((a) => {
      const href = a.href;
      const text = (a.innerText || "").trim();
      if (!text || text.length < 3 || href.startsWith("javascript:") || href === location.href || seen.has(href)) return;
      seen.add(href);
      links.push({ title: text.substring(0, 100), url: href });
    });
    return links.slice(0, 10);
  }

  // ---- SVG Icons ----

  const ICONS = {
    bolt: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    close: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/></svg>`,
    sun: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="3"/><line x1="8" y1="1" x2="8" y2="3"/><line x1="8" y1="13" x2="8" y2="15"/><line x1="1" y1="8" x2="3" y2="8"/><line x1="13" y1="8" x2="15" y2="8"/><line x1="3.05" y1="3.05" x2="4.46" y2="4.46"/><line x1="11.54" y1="11.54" x2="12.95" y2="12.95"/><line x1="3.05" y1="12.95" x2="4.46" y2="11.54"/><line x1="11.54" y1="4.46" x2="12.95" y2="3.05"/></svg>`,
    moon: `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M13.5 8.5a5.5 5.5 0 0 1-7-7 5.5 5.5 0 1 0 7 7z"/></svg>`,
    link: `<svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M7.5 10.5a3 3 0 0 0 4.24 0l2.5-2.5a3 3 0 0 0-4.24-4.24l-1.5 1.5"/><path d="M10.5 7.5a3 3 0 0 0-4.24 0l-2.5 2.5a3 3 0 0 0 4.24 4.24l1.5-1.5"/></svg>`,
    refresh: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 4v4h4"/><path d="M15 12V8h-4"/><path d="M2.67 10.67a6 6 0 0 0 10.33-1.34"/><path d="M13.33 5.33a6 6 0 0 0-10.33 1.34"/></svg>`,
    sparkle: `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0L9.5 5.5L15 7L9.5 8.5L8 14L6.5 8.5L1 7L6.5 5.5Z" opacity="0.9"/></svg>`,
    summary: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2" y="2" width="12" height="12" rx="2"/><line x1="5" y1="6" x2="11" y2="6"/><line x1="5" y1="8.5" x2="11" y2="8.5"/><line x1="5" y1="11" x2="8" y2="11"/></svg>`,
    globe: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><path d="M2 8h12"/><path d="M8 2a10 10 0 0 1 3 6 10 10 0 0 1-3 6"/><path d="M8 2a10 10 0 0 0-3 6 10 10 0 0 0 3 6"/></svg>`,
    pageLink: `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 12l8-8"/><path d="M4 4h8v8"/></svg>`,
    clock: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="6"/><polyline points="8 4 8 8 11 10"/></svg>`,
    trash: `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 4h12"/><path d="M5 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M12 4v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4"/></svg>`,
    tag: `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1 9V2a1 1 0 0 1 1-1h7l6 6-7 7-6-6z"/><circle cx="5" cy="5" r="1" fill="currentColor"/></svg>`,
  };

  // ---- Build Floating Action Button ----

  const fab = document.createElement("button");
  fab.id = "ics-fab";
  fab.innerHTML = ICONS.bolt;
  fab.title = "Toggle Instant Context Sidebar";
  document.body.appendChild(fab);

  // ---- Build Sidebar DOM ----

  const container = document.createElement("div");
  container.id = "ics-sidebar-container";

  container.innerHTML = `
    <div class="ics-header">
      <div class="ics-header-left">
        <div class="ics-header-logo">${ICONS.sparkle}</div>
        <div class="ics-header-text">
          <span class="ics-header-title">Instant Context</span>
          <span class="ics-header-subtitle">AI-powered page insights</span>
        </div>
      </div>
      <div class="ics-header-actions">
        <button class="ics-btn-icon" id="ics-theme-toggle" title="Toggle theme">${ICONS.moon}</button>
        <button class="ics-btn-icon" id="ics-close-btn" title="Close sidebar">${ICONS.close}</button>
      </div>
    </div>
    <div class="ics-tabs">
      <button class="ics-tab ics-active" data-tab="summary">Summary</button>
      <button class="ics-tab" data-tab="definitions">Definitions</button>
      <button class="ics-tab" data-tab="links">Links</button>
      <button class="ics-tab" data-tab="history">History</button>
    </div>
    <div class="ics-tabs-divider"></div>
    <div class="ics-content">
      <div class="ics-panel ics-active" id="ics-panel-summary">
        <div class="ics-loading"><div class="ics-spinner"></div><span class="ics-loading-text">Waiting to analyze...</span></div>
      </div>
      <div class="ics-panel" id="ics-panel-definitions">
        <div class="ics-loading"><div class="ics-spinner"></div><span class="ics-loading-text">Waiting to analyze...</span></div>
      </div>
      <div class="ics-panel" id="ics-panel-links">
        <div class="ics-loading"><div class="ics-spinner"></div><span class="ics-loading-text">Waiting to analyze...</span></div>
      </div>
      <div class="ics-panel" id="ics-panel-history">
        <div class="ics-loading"><div class="ics-spinner"></div><span class="ics-loading-text">Loading history...</span></div>
      </div>
    </div>
    <div class="ics-refresh-bar">
      <button class="ics-btn-refresh" id="ics-refresh-btn">${ICONS.refresh} Re-analyze Page</button>
    </div>
    <div class="ics-footer">Powered by Azure OpenAI</div>
  `;

  document.body.appendChild(container);

  // ---- State ----

  let isDark = false;
  let isOpen = false;
  let isAnalyzing = false;
  let analysisCache = { summary: null, definitions: null, links: null };

  // ---- Theme ----

  api.storage.local.get("ics_theme", (result) => {
    if (result.ics_theme === "dark") {
      isDark = true;
      container.classList.add("ics-dark");
      document.getElementById("ics-theme-toggle").innerHTML = ICONS.sun;
    }
  });

  document.getElementById("ics-theme-toggle").addEventListener("click", () => {
    isDark = !isDark;
    container.classList.toggle("ics-dark", isDark);
    document.getElementById("ics-theme-toggle").innerHTML = isDark ? ICONS.sun : ICONS.moon;
    api.storage.local.set({ ics_theme: isDark ? "dark" : "light" });
  });

  // ---- Tabs ----

  container.querySelectorAll(".ics-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      container.querySelectorAll(".ics-tab").forEach((t) => t.classList.remove("ics-active"));
      container.querySelectorAll(".ics-panel").forEach((p) => p.classList.remove("ics-active"));
      tab.classList.add("ics-active");
      const panel = document.getElementById(`ics-panel-${tab.dataset.tab}`);
      panel.classList.add("ics-active");
      panel.style.animation = "none";
      panel.offsetHeight;
      panel.style.animation = "";
      // Load history when tab is clicked
      if (tab.dataset.tab === "history") {
        renderHistory();
      }
    });
  });

  // ---- Close button ----

  document.getElementById("ics-close-btn").addEventListener("click", () => closeSidebar());

  // ---- Refresh ----

  document.getElementById("ics-refresh-btn").addEventListener("click", () => {
    analysisCache = { summary: null, definitions: null, links: null };
    analyzePage();
  });

  // ---- FAB click ----

  fab.addEventListener("click", () => toggleSidebar());

  // ---- Open / Close ----

  function openSidebar() {
    isOpen = true;
    container.classList.add("ics-open");
    fab.classList.add("ics-fab-hidden");
    if (!analysisCache.summary && !isAnalyzing) {
      analyzePage();
    }
  }

  function closeSidebar() {
    isOpen = false;
    container.classList.remove("ics-open");
    fab.classList.remove("ics-fab-hidden");
  }

  function toggleSidebar() {
    if (isOpen) closeSidebar();
    else openSidebar();
  }

  // ---- Render helpers ----

  function showLoading(panelId, message) {
    document.getElementById(panelId).innerHTML = `
      <div class="ics-loading">
        <div class="ics-spinner"></div>
        <span class="ics-loading-text">${message}</span>
      </div>`;
  }

  function showError(panelId, message) {
    document.getElementById(panelId).innerHTML = `
      <div class="ics-error">${message}</div>`;
  }

  function showConfigError(panelId) {
    document.getElementById(panelId).innerHTML = `
      <div class="ics-error">
        Azure OpenAI not configured. Please update <strong>config.json</strong> in the extension folder with your endpoint, deployment name, and API key, then reload the extension.
      </div>`;
  }

  // ---- Render history ----

  async function renderHistory() {
    const panel = document.getElementById("ics-panel-history");
    const history = await getHistory();

    if (history.length === 0) {
      panel.innerHTML = `
        <div class="ics-empty">
          <svg class="ics-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          No pages analyzed yet. Your history will appear here.
        </div>`;
      return;
    }

    let html = `
      <div class="ics-history-header">
        <div class="ics-history-header-left">
          ${ICONS.clock}
          <span>Recent Pages</span>
        </div>
        <button class="ics-history-clear" id="ics-clear-history">${ICONS.trash} Clear</button>
      </div>
      <div class="ics-history-list">`;

    html += history
      .map((entry, i) => `
        <a class="ics-history-card" href="${escapeAttr(entry.url)}" target="_blank" rel="noopener noreferrer" style="animation-delay: ${i * 0.05}s">
          <div class="ics-history-card-top">
            <span class="ics-history-keyword">${ICONS.tag} ${escapeHtml(entry.keyword)}</span>
            <span class="ics-history-time">${timeAgo(entry.timestamp)}</span>
          </div>
          <div class="ics-history-summary">${escapeHtml(entry.summary)}</div>
          <div class="ics-history-url">${escapeHtml(entry.hostname)}</div>
        </a>`)
      .join("");

    html += `</div>`;
    panel.innerHTML = html;

    // Clear history button
    document.getElementById("ics-clear-history").addEventListener("click", async (e) => {
      e.preventDefault();
      await clearHistory();
      renderHistory();
    });
  }

  // ---- Analyze page ----

  async function analyzePage() {
    let cfg;
    try {
      cfg = await loadConfig();
    } catch (e) {
      showConfigError("ics-panel-summary");
      showConfigError("ics-panel-definitions");
      showConfigError("ics-panel-links");
      return;
    }

    if (
      !cfg.api_key ||
      !cfg.endpoint ||
      !cfg.deployment_name ||
      cfg.api_key === "YOUR-AZURE-OPENAI-API-KEY" ||
      cfg.endpoint === "https://YOUR-RESOURCE-NAME.openai.azure.com"
    ) {
      showConfigError("ics-panel-summary");
      showConfigError("ics-panel-definitions");
      showConfigError("ics-panel-links");
      return;
    }

    isAnalyzing = true;
    const pageContent = extractPageContent();
    const pageUrl = window.location.href;

    showLoading("ics-panel-summary", "Generating summary...");
    showLoading("ics-panel-definitions", "Finding key terms...");
    showLoading("ics-panel-links", "Discovering related content...");

    const [summaryResult, keywordResult, definitionsResult, linksResult] = await Promise.allSettled([
      generateSummary(pageContent),
      generateKeyword(pageContent),
      generateDefinitions(pageContent),
      generateRelatedLinks(pageContent, pageUrl),
    ]);

    // ---- Save to history ----
    if (summaryResult.status === "fulfilled") {
      const keyword = keywordResult.status === "fulfilled"
        ? keywordResult.value.replace(/^["']|["']$/g, "").trim()
        : document.title.substring(0, 40);
      const summaryText = summaryResult.value;

      let hostname;
      try { hostname = new URL(pageUrl).hostname; } catch { hostname = pageUrl; }

      await saveToHistory({
        url: pageUrl,
        keyword: keyword.substring(0, 50),
        summary: summaryText.substring(0, 200),
        hostname: hostname,
        timestamp: Date.now(),
      });
    }

    // ---- Render summary ----
    if (summaryResult.status === "fulfilled") {
      analysisCache.summary = summaryResult.value;
      document.getElementById("ics-panel-summary").innerHTML = `
        <div class="ics-summary-section-label">${ICONS.summary} What this page is about</div>
        <div class="ics-summary-text">${escapeHtml(summaryResult.value)}</div>`;
    } else {
      showError("ics-panel-summary", `Failed to generate summary: ${escapeHtml(summaryResult.reason?.message || "Unknown error")}`);
    }

    // ---- Render definitions ----
    if (definitionsResult.status === "fulfilled" && definitionsResult.value.length > 0) {
      analysisCache.definitions = definitionsResult.value;
      const cards = definitionsResult.value
        .map((d, i) => `
          <div class="ics-definition-card" style="animation-delay: ${i * 0.07}s">
            <div class="ics-definition-term">
              <span class="ics-term-badge">${i + 1}</span>
              ${escapeHtml(d.term)}
            </div>
            <div class="ics-definition-text">${escapeHtml(d.definition)}</div>
          </div>`)
        .join("");
      document.getElementById("ics-panel-definitions").innerHTML = `
        <div class="ics-definitions-list">${cards}</div>`;
    } else if (definitionsResult.status === "fulfilled") {
      document.getElementById("ics-panel-definitions").innerHTML = `
        <div class="ics-empty">
          <svg class="ics-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          No notable terms or jargon found on this page.
        </div>`;
    } else {
      showError("ics-panel-definitions", `Failed to find definitions: ${escapeHtml(definitionsResult.reason?.message || "Unknown error")}`);
    }

    // ---- Render related links ----
    if (linksResult.status === "fulfilled" && linksResult.value.length > 0) {
      analysisCache.links = linksResult.value;

      let html = `<div class="ics-links-group-title">${ICONS.globe} Suggested Topics</div>`;
      html += `<div class="ics-links-list">`;
      html += linksResult.value
        .map((l, i) => `
          <a class="ics-link-item" href="${escapeAttr(l.url)}" target="_blank" rel="noopener noreferrer" style="animation-delay: ${i * 0.06}s">
            <div class="ics-link-icon-wrap">${ICONS.link}</div>
            <span class="ics-link-title">${escapeHtml(l.title)}</span>
          </a>`)
        .join("");
      html += `</div>`;

      const pageLinks = extractPageLinks();
      if (pageLinks.length > 0) {
        html += `<div class="ics-links-spacer"></div>`;
        html += `<div class="ics-links-group-title">${ICONS.pageLink} Links on This Page</div>`;
        html += `<div class="ics-links-list">`;
        html += pageLinks
          .map((l, i) => `
            <a class="ics-link-item" href="${escapeAttr(l.url)}" target="_blank" rel="noopener noreferrer" style="animation-delay: ${(linksResult.value.length + i) * 0.06}s">
              <div class="ics-link-icon-wrap">${ICONS.pageLink}</div>
              <span class="ics-link-title">${escapeHtml(l.title)}</span>
            </a>`)
          .join("");
        html += `</div>`;
      }

      document.getElementById("ics-panel-links").innerHTML = html;
    } else if (linksResult.status === "fulfilled") {
      document.getElementById("ics-panel-links").innerHTML = `
        <div class="ics-empty">
          <svg class="ics-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          No related links found.
        </div>`;
    } else {
      showError("ics-panel-links", `Failed to find related links: ${escapeHtml(linksResult.reason?.message || "Unknown error")}`);
    }

    isAnalyzing = false;
  }

  // ---- Utility ----

  function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function escapeAttr(str) {
    return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // ---- Listen for messages from background script ----

  api.runtime.onMessage.addListener((message) => {
    if (message.action === "toggle-sidebar") {
      toggleSidebar();
    }
  });
})();
