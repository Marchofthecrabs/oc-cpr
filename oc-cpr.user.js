// ==UserScript==
// @name         Unicorn Apocalypse - OC CPR Highlighter & Weights
// @namespace    UA-Local-Scripts
// @version      3.2
// @description  Combines local CPR highlighting and TornProbability Weights (TornPDA Fix)
// @match        https://www.torn.com/factions.php*
// @match        https://www.torn.com/organizedcrimes.php*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @connect      raw.githubusercontent.com
// @connect      tornprobability.com
// @noframes
// @downloadURL  https://raw.githubusercontent.com/Marchofthecrabs/oc-cpr/refs/heads/main/oc-cpr.user.js
// @updateURL    https://raw.githubusercontent.com/Marchofthecrabs/oc-cpr/refs/heads/main/oc-cpr.user.js
// ==/UserScript==
(function () {
  "use strict";

  // --- URLs ---
  const CPR_URL = "https://raw.githubusercontent.com/Marchofthecrabs/oc-cpr/refs/heads/main/oc-pass.json";
  const WEIGHT_URL = "https://tornprobability.com:3000/api/GetRoleWeights";

  // --- Styles ---
  injectCSS(`
    /* CPR Borders */
    .oc-cpr-match { border: 4px solid #18a558 !important; border-radius: 10px; }
    .oc-cpr-mismatch { border: 4px solid #e03c31 !important; border-radius: 10px; }
    
    /* Weight Boxes */
    .oc-weight-box {
      margin-top: 6px;
      padding: 6px;
      text-align: center;
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 6px;
      background: rgba(255,255,255,0.03);
    }
    .oc-weight-box .label {
      display: block;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: .05em;
      opacity: .8;
      padding-bottom: 3px;
      margin-bottom: 4px;
      border-bottom: 1px solid rgba(255,255,255,0.2);
    }
    .oc-weight-box .value {
      display: block;
      font-size: 16px;
      font-weight: 700;
      margin-top: 2px;
    }
  `);

  // --- Initialization ---
  let cprDict = null;
  let weightDict = null;

  Promise.all([loadJSON(CPR_URL), loadJSON(WEIGHT_URL)]).then(([cprRaw, weightRaw]) => {
    if (!cprRaw) console.error("[OC Master] Failed to load CPR JSON");
    else cprDict = indexDictCPR(cprRaw);

    if (!weightRaw) console.error("[OC Master] Failed to load Weight JSON");
    else weightDict = indexDictWeight(weightRaw);

    const run = throttle(() => checkAllOCBlocks(), 150);
    new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
    run();
  });

  // ---- Main Logic ----
  function checkAllOCBlocks() {
    const blocks = findOCBlocks();
    if (!blocks.length) return;

    for (const block of blocks) {
      const titleEl = block.querySelector('[class^="panelTitle___"]');
      const ocNameRaw = titleEl ? titleEl.textContent.trim() : "";

      const ocMapCPR = cprDict ? cprDict[normCPR(ocNameRaw)] : null;
      const ocMapWeight = weightDict ? weightDict[normWeight(ocNameRaw)] : null;

      const headers = block.querySelectorAll('[class^="slotHeader___"]');
      headers.forEach((header) => {
        try {
          const roleEl = header.querySelector('[class^="title___"]');
          const cprEl = header.querySelector('[class^="successChance___"]');
          if (!roleEl) return;

          const roleName = (roleEl.textContent || "").trim();
          const card = header.closest('div[class^="wrapper___"]');
          if (!card) return;

          // --- 1. CPR HIGHLIGHTING (Idempotent) ---
          if (cprEl && ocMapCPR) {
            const shown = toInt(cprEl.textContent);
            const required = ocMapCPR.roles[normCPR(roleName)];

            let targetClass = null;
            let targetTitle = null;

            if (typeof required === "number" && Number.isFinite(shown)) {
              const ok = shown >= required;
              targetClass = ok ? "oc-cpr-match" : "oc-cpr-mismatch";
              targetTitle = `[${ocMapCPR.displayName}] ${roleName}: shown ${shown} vs min ${required}`;
            }

            // Only update DOM if the class is missing or incorrect
            const hasMatch = card.classList.contains("oc-cpr-match");
            const hasMismatch = card.classList.contains("oc-cpr-mismatch");

            if (targetClass === "oc-cpr-match") {
              if (hasMismatch) card.classList.remove("oc-cpr-mismatch");
              if (!hasMatch) card.classList.add("oc-cpr-match");
            } else if (targetClass === "oc-cpr-mismatch") {
              if (hasMatch) card.classList.remove("oc-cpr-match");
              if (!hasMismatch) card.classList.add("oc-cpr-mismatch");
            } else {
              // If it shouldn't have any borders, clean them up safely
              if (hasMatch) card.classList.remove("oc-cpr-match");
              if (hasMismatch) card.classList.remove("oc-cpr-mismatch");
            }

            // Only update title if it's different
            if (targetTitle && card.title !== targetTitle) {
              card.title = targetTitle;
            }
          }

          // --- 2. WEIGHT INJECTION (Idempotent) ---
          if (ocMapWeight) {
            const weight = ocMapWeight[normWeight(roleName)];

            if (weight != null) {
              const existingBox = card.querySelector(".oc-weight-box");
              
              // Only create and append the box if it doesn't already exist
              if (!existingBox) {
                const weightBox = document.createElement("div");
                weightBox.className = "oc-weight-box";
                weightBox.innerHTML = `
                  <span class="label">Weight</span>
                  <span class="value">${weight.toFixed(1)}%</span>
                `;
                card.appendChild(weightBox);
              }
            }
          }

        } catch (e) {
          console.warn("[OC Master] Card error:", e);
        }
      });
    }
  }

  // ---- DOM Helpers ----
  function findOCBlocks() {
    const set = new Set();
    document.querySelectorAll('[class^="panelTitle___"]').forEach((titleEl) => {
      let el = titleEl.closest('[class^="panel___"]') || titleEl.parentElement;
      while (el && el !== document.body) {
        const hasTitle = !!el.querySelector('[class^="panelTitle___"]');
        const hasRoles = !!el.querySelector('[class^="slotHeader___"]');
        if (hasTitle && hasRoles) { set.add(el); break; }
        el = el.parentElement;
      }
    });
    return Array.from(set);
  }

  // ---- Data Helpers ----
function loadJSON(url) {
  return new Promise((resolve) => {
    const request =
      typeof GM !== "undefined" &&
      typeof GM.xmlHttpRequest === "function"
        ? GM.xmlHttpRequest.bind(GM)
        : typeof GM_xmlhttpRequest === "function"
          ? GM_xmlhttpRequest
          : null;

    if (!request) {
      console.error("[OC Master] No supported GM HTTP request API");
      resolve(null);
      return;
    }

    request({
      method: "GET",
      url,
      headers: { "Accept": "application/json" },
      timeout: 15000,

      onload: (res) => {
        try {
          if (res.status < 200 || res.status >= 300) {
            console.error("[OC Master] HTTP error:", res.status, url);
            resolve(null);
            return;
          }

          resolve(JSON.parse(res.responseText));
        } catch (e) {
          console.error("[OC Master] JSON parsing failed:", url, e);
          resolve(null);
        }
      },

      onerror: (e) => {
        console.error("[OC Master] Request failed:", url, e);
        resolve(null);
      },

      ontimeout: () => {
        console.error("[OC Master] Request timed out:", url);
        resolve(null);
      }
    });
  });
}

  // CPR JSON Normalizer & Indexer
  const normCPR = (s) => String(s || "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
  function indexDictCPR(raw) {
    const out = {};
    Object.keys(raw).forEach((ocName) => {
      const ocKey = normCPR(ocName);
      const roles = raw[ocName] || {};
      const roleIndex = {};
      Object.keys(roles).forEach((roleName) => {
        roleIndex[normCPR(roleName)] = roles[roleName];
      });
      out[ocKey] = { displayName: ocName, roles: roleIndex };
    });
    return out;
  }

  // Weight JSON Normalizer & Indexer
  const normWeight = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  function indexDictWeight(raw) {
    const out = {};
    Object.keys(raw).forEach((ocName) => {
      const ocKey = normWeight(ocName);
      const roles = raw[ocName] || {};
      const roleIndex = {};
      Object.keys(roles).forEach((roleName) => {
        roleIndex[normWeight(roleName)] = roles[roleName];
      });
      out[ocKey] = roleIndex;
    });
    return out;
  }

  // ---- Utils ----
  function injectCSS(css) {
    const id = "oc-master-style";
    if (document.getElementById(id)) return;
    const tag = document.createElement("style");
    tag.id = id;
    tag.textContent = css;
    document.head.appendChild(tag);
  }

  function throttle(fn, ms) {
    let t = null;
    return (...args) => {
      if (t) clearTimeout(t);
      t = setTimeout(() => { t = null; fn(...args); }, ms);
    };
  }

  const toInt = (s) => parseInt(String(s || "").replace(/[^\d-]/g, ""), 10);
})();
