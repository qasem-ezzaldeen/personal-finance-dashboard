/**
 * Aura AI Assistant - Complete Refactor with Google Gemini & Groq Integration
 * 
 * Features:
 * 1. Online LLM via Google Gemini API (gemini-1.5-flash) or Groq Cloud (llama-3.1-8b-instant).
 * 2. Local fallback intelligence for instant answers even without an API key.
 * 3. In-chat settings panel to save and manage free API keys.
 * 4. Full agentic dashboard mutations (LOG_INCOME, TRANSFER_FUNDS, SET_BASELINE, UPDATE_GOLD_PREMIUM).
 */

export function initChatbot(State, getAssetValuations, updateDashboardUI, getSupabaseClient = null) {
  const trigger = document.getElementById("chatbot-trigger");
  const windowEl = document.getElementById("chatbot-window");
  const closeBtn = document.getElementById("chatbot-close");
  const messageContainer = document.getElementById("chatbot-messages");
  const form = document.getElementById("chatbot-form");
  const input = document.getElementById("chatbot-input");
  const suggestionsContainer = document.getElementById("chatbot-suggestions");
  const settingsToggle = document.getElementById("chatbot-settings-toggle");
  const apiPanel = document.getElementById("chatbot-api-panel");
  const apiKeyInput = document.getElementById("chatbot-api-key-input");
  const saveApiKeyBtn = document.getElementById("chatbot-save-api-key-btn");
  const statusText = document.getElementById("chatbot-status-text");

  if (!trigger || !windowEl || !closeBtn || !messageContainer || !form || !input) {
    console.error("[Chatbot] Required DOM elements missing.");
    return;
  }

  // Default Universal AI Model Key (Never commit real API keys to client-side code / Git)
  const DEFAULT_AI_API_KEY = "";

  // One-time private link setup: allow passing #ai_key=... in the URL.
  // It saves the key to localStorage and immediately cleans the URL hash so it isn't saved in history or exposed.
  try {
    if (window.location.hash && window.location.hash.includes("ai_key=")) {
      const hashParams = new URLSearchParams(window.location.hash.slice(1));
      const urlKey = hashParams.get("ai_key");
      if (urlKey && urlKey.trim()) {
        const cleanedKey = urlKey.trim().replace(/^["']|["']$/g, "");
        localStorage.setItem("aura_ai_api_key", cleanedKey);
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    }
  } catch (e) {
    console.warn("[Chatbot] Hash parameter parsing error:", e);
  }

  // Automatically purge the old revoked key if it is cached in the browser's localStorage
  const OLD_REVOKED_KEY = "AQ.Ab8RN6JPDRamqIYAu2MZR-dZ_KW0-8BVSMjdiKCT2o1IufuCCg";
  if (localStorage.getItem("aura_ai_api_key") === OLD_REVOKED_KEY) {
    localStorage.removeItem("aura_ai_api_key");
  }

  // Load saved AI API key from localStorage or use default universal key
  let aiApiKey = localStorage.getItem("aura_ai_api_key") || DEFAULT_AI_API_KEY;
  if (apiKeyInput) {
    if (aiApiKey) {
      apiKeyInput.value = aiApiKey;
    } else if (getSupabaseClient) {
      apiKeyInput.placeholder = "Supabase Edge Proxy Active (No local key needed)";
    }
  }
  updateStatusBadge();

  function updateStatusBadge() {
    if (!statusText) return;
    if (aiApiKey || getSupabaseClient) {
      statusText.textContent = "Aura AI Online";
      statusText.style.color = "var(--color-savings)";
    } else {
      statusText.textContent = "Local Mode";
      statusText.style.color = "var(--text-secondary)";
    }
  }

  // Toggle chat window
  trigger.addEventListener("click", () => {
    windowEl.classList.add("active");
    trigger.classList.add("hidden");
    scrollToBottom();
    input.focus();
  });

  closeBtn.addEventListener("click", () => {
    windowEl.classList.remove("active");
    trigger.classList.remove("hidden");
  });

  const expandToggle = document.getElementById("chatbot-expand-toggle");
  if (expandToggle) {
    expandToggle.addEventListener("click", () => {
      windowEl.classList.toggle("maximized");
      const isMax = windowEl.classList.contains("maximized");
      expandToggle.title = isMax ? "Restore Chat Window" : "Expand / Maximize Chat Window";
      expandToggle.textContent = isMax ? "❐" : "⛶";
      scrollToBottom();
    });
  }

  const keyStatusEl = document.getElementById("chatbot-key-status");

  function showKeyStatus(message, isError = false) {
    if (!keyStatusEl) return;
    keyStatusEl.style.display = "block";
    keyStatusEl.style.background = isError ? "rgba(239, 68, 68, 0.15)" : "rgba(34, 197, 94, 0.15)";
    keyStatusEl.style.color = isError ? "var(--color-danger)" : "var(--color-savings)";
    keyStatusEl.style.border = `1px solid ${isError ? "rgba(239, 68, 68, 0.3)" : "rgba(34, 197, 94, 0.3)"}`;
    keyStatusEl.innerHTML = message;
  }

  // Verification tester for API keys
  async function verifyApiKey(key) {
    const cleanKey = key.trim().replace(/^["']|["']$/g, "");
    if (!cleanKey) {
      return { success: false, message: "Please enter an API key." };
    }

    // Detect accidental Twelve Data key
    const twelveDataKey = localStorage.getItem("twelve_data_api_key");
    if ((twelveDataKey && cleanKey === twelveDataKey) || (!cleanKey.startsWith("AIza") && !cleanKey.startsWith("gsk_") && !cleanKey.startsWith("AQ.") && cleanKey.length === 32)) {
      return {
        success: false,
        message: "⚠️ This looks like your Twelve Data stock API key! For the chatbot, get a free key from <a href='https://aistudio.google.com/app/apikey' target='_blank' style='color:var(--color-savings);text-decoration:underline;'>Google AI Studio</a> or <a href='https://console.groq.com/keys' target='_blank' style='color:#60a5fa;text-decoration:underline;'>Groq</a>."
      };
    }

    if (cleanKey.startsWith("gsk_")) {
      // Test Groq Cloud
      try {
        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${cleanKey}`
          },
          body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 2
          })
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          return { success: false, message: `Groq Error: ${errData?.error?.message || res.statusText}` };
        }
        return { success: true, provider: "Groq Cloud (Llama 3.1)", key: cleanKey };
      } catch (err) {
        return { success: false, message: `Connection to Groq failed: ${err.message}` };
      }
    } else {
      // Test Google Gemini with auto-fallback to newest models (gemini-3.6-flash, etc.)
      const models = ["gemini-3.6-flash", "gemini-2.5-flash", "gemini-1.5-flash"];
      let lastErrMsg = "";

      for (const m of models) {
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${cleanKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: "ping" }] }],
              generationConfig: { maxOutputTokens: 2 }
            })
          });

          if (res.ok) {
            return { success: true, provider: `Google Gemini (${m})`, key: cleanKey };
          }

          const errData = await res.json().catch(() => ({}));
          lastErrMsg = errData?.error?.message || `HTTP ${res.status}`;

          // If invalid key, no need to cycle through other models
          if (res.status === 400 && lastErrMsg.includes("API key not valid")) {
            return { success: false, message: `Google Gemini: ${lastErrMsg}` };
          }
        } catch (err) {
          lastErrMsg = err.message;
        }
      }

      return { success: false, message: `Google Gemini: ${lastErrMsg}` };
    }
  }

  // Toggle API Key settings panel
  if (settingsToggle && apiPanel) {
    settingsToggle.addEventListener("click", () => {
      apiPanel.style.display = (apiPanel.style.display === "none" || !apiPanel.style.display) ? "block" : "none";
      if (apiPanel.style.display === "block" && apiKeyInput) {
        apiKeyInput.focus();
      }
    });
  }

  // Test & Save API Key button
  if (saveApiKeyBtn && apiKeyInput) {
    saveApiKeyBtn.addEventListener("click", async () => {
      const raw = apiKeyInput.value.trim();
      if (!raw) {
        aiApiKey = "";
        localStorage.removeItem("aura_ai_api_key");
        showKeyStatus("ℹ️ API key cleared. Running in Local Financial Mode.");
        updateStatusBadge();
        setTimeout(() => {
          if (keyStatusEl) keyStatusEl.style.display = "none";
          if (apiPanel) apiPanel.style.display = "none";
        }, 1500);
        return;
      }

      saveApiKeyBtn.disabled = true;
      saveApiKeyBtn.textContent = "Testing...";
      showKeyStatus("⏳ Testing API connection...");

      const testResult = await verifyApiKey(raw);
      saveApiKeyBtn.disabled = false;
      saveApiKeyBtn.textContent = "Test & Save";

      if (testResult.success) {
        aiApiKey = testResult.key;
        localStorage.setItem("aura_ai_api_key", aiApiKey);
        showKeyStatus(`✅ Verified! Connected to ${testResult.provider}.`);
        updateStatusBadge();
        appendMessage(`🔑 <strong>Connected to ${testResult.provider}!</strong> You can now chat freely or command financial edits.`, "assistant");
        setTimeout(() => {
          if (keyStatusEl) keyStatusEl.style.display = "none";
          if (apiPanel) apiPanel.style.display = "none";
        }, 1600);
      } else {
        showKeyStatus(`❌ ${testResult.message}`, true);
      }
    });
  }

  // Form submission handler
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (!query) return;

    appendMessage(query, "user");
    input.value = "";
    showTypingIndicator();

    try {
      const response = await processQuery(query);
      removeTypingIndicator();
      appendMessage(response, "assistant");
    } catch (err) {
      removeTypingIndicator();
      appendMessage(`<span style="color: var(--color-danger);">Error: ${err.message}</span>`, "assistant");
    }
  });

  // Handle clicking suggestion pills
  if (suggestionsContainer) {
    suggestionsContainer.addEventListener("click", async (e) => {
      const pill = e.target.closest(".suggestion-pill");
      if (pill) {
        const text = pill.dataset.query;
        appendMessage(text, "user");
        showTypingIndicator();
        try {
          const response = await processQuery(text);
          removeTypingIndicator();
          appendMessage(response, "assistant");
        } catch (err) {
          removeTypingIndicator();
          appendMessage(`<span style="color: var(--color-danger);">Error: ${err.message}</span>`, "assistant");
        }
      }
    });
  }

  function scrollToBottom() {
    messageContainer.scrollTop = messageContainer.scrollHeight;
  }

  function appendMessage(text, sender) {
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble chat-bubble-${sender}`;
    if (sender === "user") {
      bubble.textContent = text;
    } else {
      bubble.innerHTML = text;
    }
    messageContainer.appendChild(bubble);
    scrollToBottom();
  }

  function showTypingIndicator() {
    const indicator = document.createElement("div");
    indicator.id = "chatbot-typing-indicator";
    indicator.className = "chat-bubble chat-bubble-assistant typing-indicator";
    indicator.innerHTML = `
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
    `;
    messageContainer.appendChild(indicator);
    scrollToBottom();
  }

  function removeTypingIndicator() {
    const indicator = document.getElementById("chatbot-typing-indicator");
    if (indicator) indicator.remove();
  }

  // --- LOCAL INTELLIGENCE ENGINE (WHEN NO API KEY IS PROVIDED) ---
  function processLocalQuery(query) {
    const q = query.toLowerCase();
    const state = serializeDashboardState();

    if (q.includes("net worth") || q.includes("wealth") || q.includes("how much do i have") || q.includes("total money")) {
      return `### 💰 Total Net Worth
- **USD Total:** **$${state.netWorth.totalUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} USD**
- **EGP Total:** **${state.netWorth.totalEgp.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} EGP**

| Asset Category | Holdings / Valuation |
| :--- | :--- |
| **Cash Savings** | $${state.cashSavings.reduce((s, a) => s + a.holdings, 0).toLocaleString(undefined, {minimumFractionDigits: 2})} USD |
| **Gold (21k + 24k)** | ${state.gold.grams21k.toFixed(1)}g (21k) + ${state.gold.grams24k.toFixed(1)}g (24k) ≈ ${state.gold.egpValue.toLocaleString(undefined, {minimumFractionDigits: 0})} EGP |
| **Stocks & ETFs** | ${state.stocks.map(s => `${s.name}: ${s.shares} sh ($${s.usdValue.toFixed(2)})`).join(", ") || "None"} |
| **Upcoming Income** | $${state.upcomingIncomeUsd.toLocaleString(undefined, {minimumFractionDigits: 2})} USD |`;
    }

    if (q.includes("incoming") || q.includes("next month") || q.includes("upcoming") || q.includes("salary")) {
      const egpVal = state.upcomingIncomeUsd * (State.cachedUsdEgp || 49.93);
      return `### 📅 Upcoming Income
- **USD Amount:** **$${state.upcomingIncomeUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} USD**
- **EGP Equivalent:** **${egpVal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} EGP** (at ${State.cachedUsdEgp.toFixed(2)} EGP/USD)

> *Upcoming income automatically resets on the 24th of every month.*`;
    }

    if (q.includes("gold") || q.includes("gram") || q.includes("karat") || q.includes("21k") || q.includes("24k")) {
      return `### 🥇 Gold Holdings & Valuation
- **21k Gold:** ${state.gold.grams21k.toFixed(2)} grams
- **24k Gold Ingots:** ${state.gold.grams24k.toFixed(2)} grams
- **Total Gold Valuation:** **${state.gold.egpValue.toLocaleString(undefined, {minimumFractionDigits: 2})} EGP** ($${state.gold.usdValue.toLocaleString(undefined, {minimumFractionDigits: 2})} USD)
- **Current 24k Spot Rate:** $${(State.cachedGold24kUsd || 0).toFixed(2)} USD/g (+${State.goldPremium}% markup)`;
    }

    if (q.includes("rate") || q.includes("exchange") || q.includes("dollar") || q.includes("egp") || q.includes("currency") || q.includes("spus") || q.includes("stock price")) {
      const spus = State.stockPrices?.["SPUS"] || 59.09;
      return `### 📈 Live Market Rates
| Instrument | Current Market Rate |
| :--- | :--- |
| **USD / EGP** | ${State.cachedUsdEgp.toFixed(2)} EGP |
| **SPUS ETF** | $${spus.toFixed(2)} USD |
| **24k Gold / Gram** | ${(State.cachedGold24kUsd * State.cachedUsdEgp * (1 + State.goldPremium / 100)).toFixed(2)} EGP |
| **21k Gold / Gram** | ${(State.cachedGold24kUsd * State.cachedUsdEgp * (1 + State.goldPremium / 100) * 0.875).toFixed(2)} EGP |`;
    }

    if (q.includes("stock") || q.includes("etf") || q.includes("shares") || q.includes("spus") || q.includes("holding")) {
      const stockList = state.stocks;
      if (stockList.length === 0) {
        return "You currently don't hold any stock shares in your Wealth Distribution table. You can add shares anytime by clicking **➕ Add Asset** in the table!";
      }
      return `### 📊 Stock & ETF Portfolio
| Ticker / ETF | Shares | Price | Total Value (USD) |
| :--- | :--- | :--- | :--- |
${stockList.map(s => `| **${s.ticker}** | ${s.shares} | $${s.price.toFixed(2)} | $${s.usdValue.toLocaleString(undefined, {minimumFractionDigits: 2})} |`).join("\n")}`;
    }

    // Default friendly response inviting the user to provide an API key for general chat
    return `I'm currently running in **Local Financial Mode**! I can instantly answer questions about your:

- **Net Worth & Wealth Breakdown**
- **Upcoming Income & Savings**
- **Gold Holdings & Market Prices**
- **Stocks, ETFs & SPUS Shares**
- **Live FX & Exchange Rates**

*Tip: Connect your free Gemini or Groq API key in ⚙️ settings for full conversational AI and financial command actions!*`;
  }

  // --- QUERY PROCESSOR (ONLINE LLM + AGENTIC ACTIONS) ---
  async function processQuery(rawQuery) {
    if (!aiApiKey && !getSupabaseClient) {
      return parseMarkdown(processLocalQuery(rawQuery));
    }

    const dashboardJson = serializeDashboardState();
    const systemPrompt = `You are Aura, the intelligent personal financial assistant for the AuraFinance dashboard.
Answer the user's inquiry accurately, clearly, and helpfully based on their live financial database state provided below.

=== LIVE DASHBOARD STATE (JSON) ===
${JSON.stringify(dashboardJson, null, 2)}
===================================

User Question: "${rawQuery}"

Rules:
1. Base facts strictly on the live dashboard values provided in the JSON state.
2. Clearly mention currencies (USD, EGP) and format figures with commas (e.g. $1,250.00).
3. Format your answers with rich Markdown: use bolding for emphasis, headings (###), clean bulleted lists, and tables (| Col | Col |) when comparing multiple assets or values.
4. If the user commands an action (e.g. logging income, transferring money, setting baselines), perform it by appending a single action tag at the VERY END of your reply:
   [ACTION: {"type": "ACTION_NAME", "payload": { ... }}]

Supported Actions:
• "LOG_INCOME" -> payload: { "amount": number, "description": string }
• "TRANSFER_FUNDS" -> payload: { "amount": number, "from": "upcoming"|"paypal"|"nsave"|"qnb_bebasata", "to": "upcoming"|"paypal"|"nsave"|"qnb_bebasata" }
• "SET_BASELINE" -> payload: { "assetId": "gold"|"savings", "amount": number }
• "UPDATE_GOLD_PREMIUM" -> payload: { "rate": number }`;

    let replyText = "";

    try {
      // 1. Try secure Supabase Edge Function 'aura-ai' (Keeps Gemini API key 100% private)
      if (getSupabaseClient) {
        try {
          const sb = getSupabaseClient();
          if (sb && sb.functions) {
            const { data, error } = await sb.functions.invoke("aura-ai", {
              body: { prompt: rawQuery, context: systemPrompt }
            });
            if (!error && data && data.replyText) {
              replyText = data.replyText;
            }
          }
        } catch (edgeErr) {
          console.warn("[Chatbot] Supabase Edge Function invoke attempt:", edgeErr);
        }
      }

      // 2. Fall back to client-side API key if Supabase function not yet deployed or returned empty
      if (!replyText) {
        if (!aiApiKey) {
          return processLocalQuery(rawQuery);
        }

        if (aiApiKey.startsWith("gsk_")) {
          // Groq Cloud API
          const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${aiApiKey}`
            },
            body: JSON.stringify({
              model: "llama-3.1-8b-instant",
              messages: [{ role: "user", content: systemPrompt }],
              temperature: 0.3,
              max_tokens: 800
            })
          });

          if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData?.error?.message || `Groq HTTP ${res.status}`);
          }

          const data = await res.json();
          replyText = data.choices?.[0]?.message?.content || "";
        } else {
          // Google Gemini API with resilient multi-model iteration
          const models = ["gemini-3.6-flash", "gemini-flash-latest", "gemini-2.5-flash", "gemini-1.5-flash"];
          let lastErr = null;
          let success = false;

          for (const m of models) {
            try {
              const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${aiApiKey}`;
              const res = await fetch(geminiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [{
                    role: "user",
                    parts: [{ text: systemPrompt }]
                  }],
                  generationConfig: {
                    temperature: 0.3,
                    maxOutputTokens: 2048
                  }
                })
              });

              if (res.ok) {
                const data = await res.json();
                replyText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
                success = true;
                break;
              }

              const errData = await res.json().catch(() => ({}));
              lastErr = new Error(errData?.error?.message || `Gemini ${m} HTTP ${res.status}`);

              // If error is invalid API key, stop trying
              if (res.status === 400 && lastErr.message.includes("API key not valid")) {
                throw lastErr;
              }
            } catch (err) {
              lastErr = err;
              if (err.message && err.message.includes("API key not valid")) {
                throw err;
              }
            }
          }

          if (!success && lastErr) {
            throw lastErr;
          }
        }
      }
    } catch (apiErr) {
      console.warn("[Chatbot] Online LLM API failed. Falling back to local intelligence:", apiErr);
      return `
        <div style="padding: 0.5rem 0.75rem; background: rgba(239, 68, 68, 0.1); border-left: 3px solid var(--color-danger); border-radius: 4px; margin-bottom: 0.75rem; font-size: 0.78rem;">
          <strong style="color: var(--color-danger);">AI Notice:</strong> ${apiErr.message}
          <div style="margin-top: 0.35rem;">
            <button onclick="document.getElementById('chatbot-settings-toggle')?.click()" style="background: none; border: 1px solid rgba(239, 68, 68, 0.3); color: var(--text-primary); border-radius: 4px; padding: 2px 6px; font-size: 0.7rem; cursor: pointer;">⚙️ Open AI Key Settings</button>
          </div>
        </div>
        ${parseMarkdown(processLocalQuery(rawQuery))}
      `;
    }

    if (!replyText) {
      return parseMarkdown(processLocalQuery(rawQuery));
    }

    // Intercept agentic action tag if present
    const actionRegex = /\[ACTION:\s*(\{.*?\})\s*\]/s;
    const match = replyText.match(actionRegex);
    let finalMessage = replyText;
    let actionExecutedText = "";

    if (match) {
      finalMessage = replyText.replace(actionRegex, "").trim();
      try {
        const actionObj = JSON.parse(match[1]);
        const execResult = executeAction(actionObj);
        if (execResult.success) {
          actionExecutedText = `<div class="chatbot-action-badge">⚡ ${execResult.message}</div>`;
        } else {
          actionExecutedText = `<div class="chatbot-action-badge error">❌ ${execResult.message}</div>`;
        }
      } catch (parseErr) {
        console.error("Action parse error:", parseErr);
      }
    }

    return parseMarkdown(finalMessage) + actionExecutedText;
  }

  // Execute database mutations triggered by AI actions
  function executeAction(actionObj) {
    const { type, payload } = actionObj;
    const usdEgpRate = State.cachedUsdEgp || 49.93;
    const beforeIncome = State.upcomingIncome || 0;

    switch (type) {
      case "LOG_INCOME": {
        const amountUsd = parseFloat(payload.amount);
        if (isNaN(amountUsd) || amountUsd <= 0) {
          return { success: false, message: "Invalid income amount." };
        }
        const afterIncome = beforeIncome + amountUsd;
        const newTx = {
          id: "tx_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
          amountUsd: amountUsd,
          amountEgp: amountUsd * usdEgpRate,
          rateUsdEgp: usdEgpRate,
          timestamp: Date.now(),
          beforeIncome: beforeIncome,
          afterIncome: afterIncome,
          description: payload.description || "Logged via Aura Assistant"
        };
        State.transactions.push(newTx);
        State.upcomingIncome = afterIncome;
        State.save();
        if (typeof updateDashboardUI === "function") updateDashboardUI();
        return { success: true, message: `Logged +$${amountUsd.toFixed(2)} USD upcoming income.` };
      }

      case "TRANSFER_FUNDS": {
        const amountUsd = parseFloat(payload.amount);
        if (isNaN(amountUsd) || amountUsd <= 0) {
          return { success: false, message: "Invalid transfer amount." };
        }

        const fromVal = (payload.from || "").toLowerCase();
        const toVal = (payload.to || "").toLowerCase();

        let fromAsset = null;
        if (fromVal === "upcoming") {
          if (amountUsd > State.upcomingIncome) {
            return { success: false, message: `Insufficient upcoming income (available: $${State.upcomingIncome.toFixed(2)}).` };
          }
        } else {
          fromAsset = State.assets.find(a => a.id === fromVal || a.name.toLowerCase().includes(fromVal));
          if (!fromAsset) {
            return { success: false, message: `Source asset "${fromVal}" not found.` };
          }
          if (fromAsset.holdings < amountUsd) {
            return { success: false, message: `Insufficient balance in ${fromAsset.name} (available: $${fromAsset.holdings.toFixed(2)}).` };
          }
        }

        let toAsset = null;
        if (toVal !== "upcoming") {
          toAsset = State.assets.find(a => a.id === toVal || a.name.toLowerCase().includes(toVal));
          if (!toAsset) {
            return { success: false, message: `Destination asset "${toVal}" not found.` };
          }
        }

        // Apply mutation only after both source and destination are fully validated
        if (fromVal === "upcoming") {
          State.upcomingIncome -= amountUsd;
        } else {
          fromAsset.holdings -= amountUsd;
        }

        if (toVal === "upcoming") {
          State.upcomingIncome += amountUsd;
        } else {
          toAsset.holdings += amountUsd;
        }

        State.save();
        if (typeof updateDashboardUI === "function") updateDashboardUI();
        return { success: true, message: `Transferred $${amountUsd.toFixed(2)} USD from ${fromVal} to ${toVal}.` };
      }

      case "SET_BASELINE": {
        const amount = parseFloat(payload.amount);
        if (isNaN(amount) || amount < 0) {
          return { success: false, message: "Invalid baseline amount." };
        }
        if (payload.assetId === "gold") {
          State.goldGrams = amount;
        } else {
          State.usdSavings = amount;
        }
        State.save();
        if (typeof updateDashboardUI === "function") updateDashboardUI();
        return { success: true, message: `Updated baseline to ${amount}.` };
      }

      case "UPDATE_GOLD_PREMIUM": {
        const rate = parseFloat(payload.rate);
        if (isNaN(rate) || rate < 0) {
          return { success: false, message: "Invalid gold premium rate." };
        }
        State.goldPremium = rate;
        State.save();
        if (typeof updateDashboardUI === "function") updateDashboardUI();
        return { success: true, message: `Set gold premium markup to ${rate}%.` };
      }

      default:
        return { success: false, message: `Unsupported action "${type}".` };
    }
  }

  // Serializes live dashboard state for prompts
  function serializeDashboardState() {
    let usdTotal = 0;
    let egpTotal = 0;

    const assetsData = State.assets.map(asset => {
      const valuations = getAssetValuations(asset.holdings, asset.currency, asset);
      usdTotal += valuations.usd;
      egpTotal += valuations.egp;
      return {
        name: asset.name,
        category: asset.category,
        holdings: asset.holdings,
        currency: asset.currency,
        ticker: asset.ticker || null,
        usdValue: valuations.usd,
        egpValue: valuations.egp
      };
    });

    const upValuations = getAssetValuations(State.upcomingIncome, "USD");
    usdTotal += upValuations.usd;
    egpTotal += upValuations.egp;

    const stockAssets = State.assets
      .filter(a => a.currency === "Stock")
      .map(a => {
        const ticker = (a.ticker || "SPUS").toUpperCase();
        const price = State.stockPrices?.[ticker] || a.stockPrice || 59.09;
        return {
          name: a.name,
          ticker: ticker,
          shares: a.holdings,
          price: price,
          usdValue: a.holdings * price,
          egpValue: a.holdings * price * (State.cachedUsdEgp || 49.93)
        };
      });

    return {
      netWorth: {
        totalUsd: usdTotal,
        totalEgp: egpTotal
      },
      cashSavings: State.assets
        .filter(a => a.category === "Cash Savings" || a.id === "qnb_bebasata" || a.id === "nsave")
        .map(a => ({ name: a.name, holdings: a.holdings, currency: a.currency })),
      gold: {
        grams21k: State.assets.filter(a => a.currency === "Gold (Grams)").reduce((sum, a) => sum + a.holdings, 0),
        grams24k: State.assets.filter(a => a.currency === "Gold 24k (Grams)").reduce((sum, a) => sum + a.holdings, 0),
        premiumPercent: State.goldPremium,
        usdValue: State.assets.filter(a => a.currency.includes("Gold")).reduce((sum, a) => sum + getAssetValuations(a.holdings, a.currency).usd, 0),
        egpValue: State.assets.filter(a => a.currency.includes("Gold")).reduce((sum, a) => sum + getAssetValuations(a.holdings, a.currency).egp, 0)
      },
      stocks: stockAssets,
      upcomingIncomeUsd: State.upcomingIncome,
      liveExchangeRates: {
        usdToEgp: State.cachedUsdEgp,
        spusPriceUsd: State.stockPrices?.["SPUS"] || 59.09,
        gold24kSpotUsdPerGram: State.cachedGold24kUsd
      },
      recentTransactions: State.transactions.slice(-5).map(t => ({
        date: t.date || new Date(t.timestamp).toLocaleDateString(),
        description: t.description,
        amountUsd: t.amountUsd
      }))
    };
  }

  // Safe & Comprehensive Markdown to HTML parser
  function parseMarkdown(text) {
    if (!text) return "";

    // 1. If marked.js is available in window, use it for complete CommonMark & GFM support
    if (typeof window !== "undefined" && window.marked && typeof window.marked.parse === "function") {
      try {
        window.marked.setOptions({
          gfm: true,
          breaks: true
        });
        const rawHtml = window.marked.parse(text);
        // Wrap tables in responsive container for smooth horizontal scrolling
        const wrappedHtml = rawHtml.replace(/<table>([\s\S]*?)<\/table>/gi, '<div class="markdown-table-wrapper"><table>$1</table></div>');
        
        if (window.DOMPurify && typeof window.DOMPurify.sanitize === "function") {
          return window.DOMPurify.sanitize(wrappedHtml, {
            ADD_ATTR: ["target", "class", "style"]
          });
        }
        return wrappedHtml;
      } catch (e) {
        console.warn("[Chatbot] Marked parser error:", e);
      }
    }

    // 2. High-quality Standalone Fallback Markdown Parser
    let html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Fenced code blocks ```lang ... ```
    html = html.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (m, lang, code) => {
      return `<pre><code class="language-${lang}">${code.trim()}</code></pre>`;
    });

    // Headers
    html = html.replace(/^#### (.*$)/gim, "<h4>$1</h4>");
    html = html.replace(/^### (.*$)/gim, "<h3>$1</h3>");
    html = html.replace(/^## (.*$)/gim, "<h2>$1</h2>");
    html = html.replace(/^# (.*$)/gim, "<h1>$1</h1>");

    // Blockquotes
    html = html.replace(/^> (.*$)/gim, "<blockquote><p>$1</p></blockquote>");

    // Tables: | h1 | h2 | \n | --- | --- | \n | d1 | d2 |
    html = html.replace(/((?:\|[^\n]+\|\n?)+)/g, (match) => {
      const rows = match.trim().split("\n").map(r => r.trim()).filter(Boolean);
      if (rows.length < 2) return match;
      const isDelimiter = (r) => /^\|(\s*:?-+:?\s*\|)+$/.test(r);
      if (!isDelimiter(rows[1])) return match;

      const headerCols = rows[0].split("|").slice(1, -1).map(c => c.trim());
      const ths = headerCols.map(c => `<th>${c}</th>`).join("");
      let tbody = "";

      for (let i = 2; i < rows.length; i++) {
        const cols = rows[i].split("|").slice(1, -1).map(c => c.trim());
        const tds = cols.map(c => `<td>${c}</td>`).join("");
        tbody += `<tr>${tds}</tr>`;
      }

      return `<div class="markdown-table-wrapper"><table><thead><tr>${ths}</tr></thead><tbody>${tbody}</tbody></table></div>`;
    });

    // Bold, italic, strikethrough
    html = html.replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>");
    html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/__(.*?)__/g, "<strong>$1</strong>");
    html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");
    html = html.replace(/_(.*?)_/g, "<em>$1</em>");
    html = html.replace(/~~(.*?)~~/g, "<del>$1</del>");

    // Inline code
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    // Links [text](url)
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // Horizontal rules
    html = html.replace(/^---$/gim, "<hr>");

    // Lists (unordered & ordered)
    const lines = html.split("\n");
    let inUl = false;
    let inOl = false;
    let out = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      const ulMatch = trimmed.match(/^[•\-\*]\s+(.*)/);
      const olMatch = trimmed.match(/^(\d+)\.\s+(.*)/);

      if (ulMatch) {
        if (inOl) { out.push("</ol>"); inOl = false; }
        if (!inUl) { out.push("<ul>"); inUl = true; }
        out.push(`<li>${ulMatch[1]}</li>`);
      } else if (olMatch) {
        if (inUl) { out.push("</ul>"); inUl = false; }
        if (!inOl) { out.push("<ol>"); inOl = true; }
        out.push(`<li>${olMatch[2]}</li>`);
      } else {
        if (inUl) { out.push("</ul>"); inUl = false; }
        if (inOl) { out.push("</ol>"); inOl = false; }
        out.push(line);
      }
    }
    if (inUl) out.push("</ul>");
    if (inOl) out.push("</ol>");

    html = out.join("\n");
    // Preserve paragraphs
    html = html.replace(/\n\n+/g, "</p><p>");
    html = html.replace(/\n/g, "<br>");

    return `<p>${html}</p>`
      .replace(/<p><\/p>/g, "")
      .replace(/<p>\s*<(div|table|thead|tbody|tr|th|td|ul|ol|li|pre|h1|h2|h3|h4|blockquote|hr)/gi, "<$1")
      .replace(/<\/(div|table|thead|tbody|tr|th|td|ul|ol|li|pre|h1|h2|h3|h4|blockquote|hr)>\s*<\/p>/gi, "</$1>");
  }
}
