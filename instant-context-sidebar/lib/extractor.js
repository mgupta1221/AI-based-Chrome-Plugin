/**
 * Extract meaningful text content from the current page.
 * Strips navigation, ads, scripts, and other non-content elements.
 */
function extractPageContent() {
  // Clone body to avoid modifying the actual page
  const clone = document.body.cloneNode(true);

  // Remove non-content elements
  const removeSelectors = [
    "script", "style", "noscript", "iframe", "svg",
    "nav", "header", "footer",
    "[role='navigation']", "[role='banner']", "[role='contentinfo']",
    ".sidebar", ".nav", ".menu", ".ad", ".advertisement",
    ".cookie-banner", ".popup", ".modal"
  ];

  removeSelectors.forEach((sel) => {
    clone.querySelectorAll(sel).forEach((el) => el.remove());
  });

  // Get text content
  let text = clone.innerText || clone.textContent || "";

  // Clean up whitespace
  text = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");

  // Truncate to ~6000 chars to stay within API limits
  if (text.length > 6000) {
    text = text.substring(0, 6000) + "\n[Content truncated...]";
  }

  return text;
}

/**
 * Extract links already present on the page for the "related links" section.
 */
function extractPageLinks() {
  const links = [];
  const seen = new Set();

  document.querySelectorAll("a[href]").forEach((a) => {
    const href = a.href;
    const text = (a.innerText || a.textContent || "").trim();

    // Skip empty, anchor-only, javascript, and duplicate links
    if (
      !text ||
      text.length < 3 ||
      href.startsWith("javascript:") ||
      href === window.location.href ||
      href === window.location.href + "#" ||
      seen.has(href)
    ) {
      return;
    }

    seen.add(href);
    links.push({ title: text.substring(0, 100), url: href });
  });

  return links.slice(0, 10);
}
