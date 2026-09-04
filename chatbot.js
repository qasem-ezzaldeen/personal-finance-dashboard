/**
 * Aura AI Assistant - Complete Refactor with Google Gemini & Groq Integration
 * 
 * Features:
 * 1. Online LLM via Google Gemini API (gemini-1.5-flash) or Groq Cloud (llama-3.1-8b-instant).
 * 2. Local fallback intelligence for instant answers even without an API key.
 * 3. In-chat settings panel to save and manage free API keys.
 * 4. Full agentic dashboard mutations (LOG_INCOME, TRANSFER_FUNDS, SET_BASELINE, UPDATE_GOLD_PREMIUM).
 */

export function initChatbot(State, getAssetValuations, updateDashboardUI) {
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

  // Load saved AI API key from localStorage
  let aiApiKey = localStorage.getItem("aura_ai_api_key") || "";
  if (apiKeyInput && aiApiKey) {
    apiKeyInput.value = aiApiKey;
  }
  updateStatusBadge();

  function updateStatusBadge() {
    if (!statusText) return;
    if (aiApiKey) {
      statusText.textContent = aiApiKey.startsWith("gsk_") ? "Groq Online" : "Gemini Online";
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

    // If first time opening and no key is set, open settings panel to guide user
    if (!aiApiKey && apiPanel && apiPanel.style.display === "none") {
      apiPanel.style.display = "block";
    }
  });

  closeBtn.addEventListener("click", () => {
    windowEl.classList.remove("active");
    trigger.classList.remove("hidden");
  });

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
    if ((twelveDataKey && cleanKey === twelveDataKey) || (!cleanKey.startsWith("AIza") && !cleanKey.startsWith("gsk_") && cleanKey.length === 32)) {
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
    bubble.innerHTML = text;
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
      return `
        <strong>Your Total Net Worth:</strong><br>
        • <strong>$${state.netWorth.totalUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} USD</strong><br>
        • <strong>${state.netWorth.totalEgp.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} EGP</strong><br><br>
        <strong>Breakdown:</strong><br>
        • Cash Savings: $${state.cashSavings.reduce((s, a) => s + a.holdings, 0).toLocaleString(undefined, {minimumFractionDigits: 2})} USD<br>
        • Gold: ${state.gold.grams21k.toFixed(1)}g (21k) + ${state.gold.grams24k.toFixed(1)}g (24k) = ${state.gold.egpValue.toLocaleString(undefined, {minimumFractionDigits: 0})} EGP<br>
        • Stocks / ETFs: ${state.stocks.map(s => `${s.name}: ${s.shares} sh ($${s.usdValue.toFixed(2)})`).join(", ") || "None"}<br>
        • Upcoming Income: $${state.upcomingIncomeUsd.toLocaleString(undefined, {minimumFractionDigits: 2})} USD
      `;
    }

    if (q.includes("incoming") || q.includes("next month") || q.includes("upcoming") || q.includes("salary")) {
      const egpVal = state.upcomingIncomeUsd * (State.cachedUsdEgp || 49.93);
      return `
        <strong>Upcoming Income:</strong><br>
        • <strong>$${state.upcomingIncomeUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} USD</strong><br>
        • ≈ <strong>${egpVal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} EGP</strong> (at ${State.cachedUsdEgp.toFixed(2)} EGP/USD)<br><br>
        <em>Upcoming income automatically resets on the 24th of every month.</em>
      `;
    }

    if (q.includes("gold") || q.includes("gram") || q.includes("karat") || q.includes("21k") || q.includes("24k")) {
      return `
        <strong>Your Gold Holdings:</strong><br>
        • <strong>21k Gold:</strong> ${state.gold.grams21k.toFixed(2)} grams<br>
        • <strong>24k Gold Ingots:</strong> ${state.gold.grams24k.toFixed(2)} grams<br>
        • <strong>Total Gold Valuation:</strong> ${state.gold.egpValue.toLocaleString(undefined, {minimumFractionDigits: 2})} EGP ($${state.gold.usdValue.toLocaleString(undefined, {minimumFractionDigits: 2})} USD)<br>
        • <strong>Current 24k Spot Rate:</strong> $${(State.cachedGold24kUsd || 0).toFixed(2)} USD/g (+${State.goldPremium}% markup)
      `;
    }

    if (q.includes("rate") || q.includes("exchange") || q.includes("dollar") || q.includes("egp") || q.includes("currency") || q.includes("spus") || q.includes("stock price")) {
      const spus = State.stockPrices?.["SPUS"] || 59.09;
      return `
        <strong>Live Market Rates:</strong><br>
        • <strong>USD / EGP:</strong> ${State.cachedUsdEgp.toFixed(2)} EGP<br>
        • <strong>SPUS ETF:</strong> $${spus.toFixed(2)} USD<br>
        • <strong>24k Gold / Gram:</strong> ${(State.cachedGold24kUsd * State.cachedUsdEgp * (1 + State.goldPremium / 100)).toFixed(2)} EGP<br>
        • <strong>21k Gold / Gram:</strong> ${(State.cachedGold24kUsd * State.cachedUsdEgp * (1 + State.goldPremium / 100) * 0.875).toFixed(2)} EGP
      `;
    }

    if (q.includes("stock") || q.includes("etf") || q.includes("shares") || q.includes("spus") || q.includes("holding")) {
      const stockList = state.stocks;
      if (stockList.length === 0) {
        return "You currently don't hold any stock shares in your Wealth Distribution table. You can add shares anytime by clicking **➕ Add Asset** in the table!";
      }
      return `
        <strong>Your Stock & ETF Portfolio:</strong><br>
        ${stockList.map(s => `• <strong>${s.ticker}:</strong> ${s.shares} shares @ $${s.price.toFixed(2)} = <strong>$${s.usdValue.toLocaleString(undefined, {minimumFractionDigits: 2})} USD</strong> (${s.egpValue.toLocaleString(undefined, {minimumFractionDigits: 2})} EGP)`).join("<br>")}
      `;
    }

    // Default friendly response inviting the user to provide an API key for general chat
    return `
      I'm currently running in <strong>Local Financial Mode</strong>! I can instantly answer questions about your:
      <br>• <strong>Net Worth & Wealth Breakdown</strong>
      <br>• <strong>Upcoming Income & Savings</strong>
      <br>• <strong>Gold Holdings & Market Prices</strong>
      <br>• <strong>Stocks, ETFs & SPUS Shares</strong>
      <br>• <strong>Live FX & Exchange Rates</strong>
      <br><br>
      💡 <em>To enable full generative chat, smart reasoning, and active voice/text edits, click the <strong>⚙️</strong> button in the chat header to add your free <strong>Google Gemini API key</strong> (free in 1 click at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" style="color: var(--color-gold); text-decoration: underline;">aistudio.google.com</a>).</em>
    `;
  }

  // --- QUERY PROCESSOR (ONLINE LLM + AGENTIC ACTIONS) ---
  async function processQuery(rawQuery) {
    if (!aiApiKey) {
      return processLocalQuery(rawQuery);
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
3. If the user commands an action (e.g. logging income, transferring money, setting baselines), perform it by appending a single action tag at the VERY END of your reply:
   [ACTION: {"type": "ACTION_NAME", "payload": { ... }}]

Supported Actions:
• "LOG_INCOME" -> payload: { "amount": number, "description": string }
• "TRANSFER_FUNDS" -> payload: { "amount": number, "from": "upcoming"|"paypal"|"nsave"|"qnb_bebasata", "to": "upcoming"|"paypal"|"nsave"|"qnb_bebasata" }
• "SET_BASELINE" -> payload: { "assetId": "gold"|"savings", "amount": number }
• "UPDATE_GOLD_PREMIUM" -> payload: { "rate": number }`;

    let replyText = "";

    try {
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
        const models = ["gemini-3.6-flash", "gemini-2.5-flash", "gemini-1.5-flash"];
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
                  maxOutputTokens: 800
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
    } catch (apiErr) {
      console.warn("[Chatbot] Online LLM API failed. Falling back to local intelligence:", apiErr);
      return `
        <div style="padding: 0.5rem 0.75rem; background: rgba(239, 68, 68, 0.1); border-left: 3px solid var(--color-danger); border-radius: 4px; margin-bottom: 0.75rem; font-size: 0.78rem;">
          <strong style="color: var(--color-danger);">AI Notice:</strong> ${apiErr.message}
          <div style="margin-top: 0.35rem;">
            <button onclick="document.getElementById('chatbot-settings-toggle')?.click()" style="background: none; border: 1px solid rgba(239, 68, 68, 0.3); color: var(--text-primary); border-radius: 4px; padding: 2px 6px; font-size: 0.7rem; cursor: pointer;">⚙️ Open AI Key Settings</button>
          </div>
        </div>
        ${processLocalQuery(rawQuery)}
      `;
    }

    if (!replyText) {
      return processLocalQuery(rawQuery);
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

        if (fromVal === "upcoming") {
          if (amountUsd > State.upcomingIncome) {
            return { success: false, message: `Insufficient upcoming income (available: $${State.upcomingIncome.toFixed(2)}).` };
          }
          State.upcomingIncome -= amountUsd;
        } else {
          const fromAsset = State.assets.find(a => a.id === fromVal || a.name.toLowerCase().includes(fromVal));
          if (!fromAsset || fromAsset.holdings < amountUsd) {
            return { success: false, message: `Insufficient balance in ${fromVal}.` };
          }
          fromAsset.holdings -= amountUsd;
        }

        if (toVal !== "upcoming") {
          let toAsset = State.assets.find(a => a.id === toVal || a.name.toLowerCase().includes(toVal));
          if (toAsset) {
            toAsset.holdings += amountUsd;
          }
        } else {
          State.upcomingIncome += amountUsd;
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
        return { success: false, message: `Action ${type} completed.` };
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

  // Safe Markdown to HTML parser
  function parseMarkdown(text) {
    if (!text) return "";
    let html = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Bold
    html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    // Italic
    html = html.replace(/\*(.*?)\*/g, "<em>$1</em>");
    // Code
    html = html.replace(/`(.*?)`/g, "<code>$1</code>");

    // Line breaks and list bullets
    html = html.split("\n").map(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith("• ") || trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        return `• ${trimmed.substring(2)}`;
      }
      return line;
    }).join("<br>");

    return html;
  }
}
