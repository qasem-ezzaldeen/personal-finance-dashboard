/**
 * Aura AI Assistant - Client-Side Chatbot with Keyless Online LLM Integration & Agentic Edits
 * 
 * Provides interactive querying and active modifications of live financial data via Pollinations AI.
 */

export function initChatbot(State, getAssetValuations, updateDashboardUI) {
  // Select chatbot DOM elements
  const trigger = document.getElementById("chatbot-trigger");
  const windowEl = document.getElementById("chatbot-window");
  const closeBtn = document.getElementById("chatbot-close");
  const messageContainer = document.getElementById("chatbot-messages");
  const form = document.getElementById("chatbot-form");
  const input = document.getElementById("chatbot-input");
  const suggestionsContainer = document.getElementById("chatbot-suggestions");

  if (!trigger || !windowEl || !closeBtn || !messageContainer || !form || !input) {
    console.error("Chatbot DOM elements missing. Make sure index.html is loaded properly.");
    return;
  }

  // 1. Setup Chat window toggle interactions
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

  // Handle message submission
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const query = input.value.trim();
    if (!query) return;

    // Append User Message
    appendMessage(query, "user");
    input.value = "";

    // Show typing micro-animation
    showTypingIndicator();
    
    try {
      const response = await processQuery(query);
      removeTypingIndicator();
      appendMessage(response, "assistant");
    } catch (err) {
      removeTypingIndicator();
      appendMessage(`<span style="color: var(--color-danger);">An error occurred: ${err.message}</span>`, "assistant");
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
          appendMessage(`<span style="color: var(--color-danger);">An error occurred: ${err.message}</span>`, "assistant");
        }
      }
    });
  }

  // Scroll to bottom of message view
  function scrollToBottom() {
    messageContainer.scrollTop = messageContainer.scrollHeight;
  }

  // Append a message bubble to the list
  function appendMessage(text, sender) {
    const bubble = document.createElement("div");
    bubble.className = `chat-bubble chat-bubble-${sender}`;
    bubble.innerHTML = text;
    messageContainer.appendChild(bubble);
    scrollToBottom();
  }

  // Show dynamic typing indicator bubble
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

  // Remove typing indicator bubble
  function removeTypingIndicator() {
    const indicator = document.getElementById("chatbot-typing-indicator");
    if (indicator) {
      indicator.remove();
    }
  }

  // Execute database mutations triggered by AI actions
  function executeAction(actionObj) {
    const { type, payload } = actionObj;
    const usdEgpRate = State.cachedUsdEgp;
    const beforeIncome = State.upcomingIncome;

    switch (type) {
      case "LOG_INCOME": {
        const amountUsd = parseFloat(payload.amount);
        if (isNaN(amountUsd) || amountUsd <= 0) {
          return { success: false, message: "Invalid amount specified." };
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
        return { success: true, message: `Logged $${amountUsd.toFixed(2)} USD upcoming income.` };
      }

      case "TRANSFER_FUNDS": {
        const amountUsd = parseFloat(payload.amount);
        if (isNaN(amountUsd) || amountUsd <= 0) {
          return { success: false, message: "Invalid transfer amount." };
        }

        const fromVal = payload.from;
        const toVal = payload.to;

        // Verify source has enough funds
        let sourceHoldings = 0;
        if (fromVal === "upcoming") {
          sourceHoldings = State.upcomingIncome;
        } else if (fromVal === "paypal") {
          const asset = State.assets.find(a => a.id === "paypal" || a.name.toLowerCase() === "paypal");
          sourceHoldings = asset ? asset.holdings : 0;
        } else if (fromVal === "nsave") {
          const asset = State.assets.find(a => a.id === "nsave" || a.name.toLowerCase() === "nsave");
          sourceHoldings = asset ? asset.holdings : 0;
        } else if (fromVal === "qnb_bebasata") {
          const asset = State.assets.find(a => a.id === "qnb_bebasata" || a.id === "savings");
          sourceHoldings = asset ? asset.holdings : 0;
        } else {
          return { success: false, message: `Unsupported source: ${fromVal}` };
        }

        if (sourceHoldings < amountUsd) {
          return { success: false, message: `Insufficient funds in ${fromVal}. Available: $${sourceHoldings.toFixed(2)}.` };
        }

        // Deduct from source
        if (fromVal === "upcoming") {
          State.upcomingIncome -= amountUsd;
        } else {
          const asset = State.assets.find(a => a.id === fromVal || (fromVal === "qnb_bebasata" && (a.id === "qnb_bebasata" || a.id === "savings")));
          if (asset) {
            asset.holdings -= amountUsd;
            if (asset.holdings <= 0 && (asset.id === "paypal" || asset.id === "nsave")) {
              State.assets = State.assets.filter(a => a.id !== asset.id);
            }
          }
        }

        // Add to destination
        if (toVal === "upcoming") {
          State.upcomingIncome += amountUsd;
        } else {
          let asset = State.assets.find(a => a.id === toVal || (toVal === "qnb_bebasata" && (a.id === "qnb_bebasata" || a.id === "savings")));
          if (!asset) {
            let name = "Asset";
            let category = "Cash Savings";
            let color = "#10b981";
            if (toVal === "paypal") { name = "PayPal"; category = "Digital Wallet"; color = "#3b82f6"; }
            else if (toVal === "nsave") { name = "nsave"; category = "nsave Savings"; color = "#ef4444"; }
            else if (toVal === "qnb_bebasata") { name = "QNB Bebasata"; category = "Cash Savings"; color = "#0ea5e9"; }

            asset = {
              id: toVal,
              name: name,
              category: category,
              holdings: 0,
              currency: "USD",
              color: color
            };
            State.assets.push(asset);
          }
          asset.holdings += amountUsd;
        }

        // Log transaction
        const newTx = {
          id: "tx_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
          amountUsd: -amountUsd,
          amountEgp: -amountUsd * usdEgpRate,
          rateUsdEgp: usdEgpRate,
          timestamp: Date.now(),
          beforeIncome: beforeIncome,
          afterIncome: State.upcomingIncome,
          description: `Transfer: $${amountUsd.toFixed(2)} from ${fromVal} to ${toVal}`
        };
        State.transactions.push(newTx);
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
          State.save();
          if (typeof updateDashboardUI === "function") updateDashboardUI();
          return { success: true, message: `Set gold baseline savings to ${amount} grams.` };
        } else if (payload.assetId === "savings") {
          State.usdSavings = amount;
          State.save();
          if (typeof updateDashboardUI === "function") updateDashboardUI();
          return { success: true, message: `Set cash savings baseline to $${amount.toFixed(2)} USD.` };
        }
        return { success: false, message: `Unknown baseline asset ID: ${payload.assetId}` };
      }

      case "UPDATE_GOLD_PREMIUM": {
        const rate = parseFloat(payload.rate);
        if (isNaN(rate) || rate < 0 || rate > 100) {
          return { success: false, message: "Invalid gold premium percentage rate." };
        }
        State.goldPremium = rate;
        State.save();
        if (typeof updateDashboardUI === "function") updateDashboardUI();
        return { success: true, message: `Updated local gold premium markup to ${rate}%.` };
      }

      default:
        return { success: false, message: `Unsupported action type: ${type}` };
    }
  }

  // Collect dashboard state for prompt injections
  function serializeDashboardState() {
    let usdTotal = 0;
    let egpTotal = 0;
    let audTotal = 0;
    
    const assetsData = State.assets.map(asset => {
      const valuations = getAssetValuations(asset.holdings, asset.currency);
      usdTotal += valuations.usd;
      egpTotal += valuations.egp;
      audTotal += valuations.aud;
      return {
        name: asset.name,
        category: asset.category,
        holdings: asset.holdings,
        currency: asset.currency,
        usdValue: valuations.usd,
        egpValue: valuations.egp,
        audValue: valuations.aud
      };
    });

    const upcomingValuations = getAssetValuations(State.upcomingIncome, "USD");
    usdTotal += upcomingValuations.usd;
    egpTotal += upcomingValuations.egp;
    audTotal += upcomingValuations.aud;

    const paypalAsset = State.assets.find(a => a.id === "paypal" || a.name.toLowerCase() === "paypal");
    const paypalHoldings = paypalAsset ? paypalAsset.holdings : 0;

    return {
      netWorth: {
        totalUsd: usdTotal,
        totalEgp: egpTotal,
        totalAud: audTotal
      },
      cashSavings: State.assets
        .filter(a => a.category === "Cash Savings" || a.id === "qnb_bebasata" || a.id === "nsave")
        .map(a => ({ name: a.name, holdings: a.holdings, currency: a.currency })),
      gold: {
        grams: State.goldGrams,
        premiumPercent: State.goldPremium,
        usdValue: getAssetValuations(State.goldGrams, "Gold (Grams)").usd,
        egpValue: getAssetValuations(State.goldGrams, "Gold (Grams)").egp
      },
      paypalHoldingsUsd: paypalHoldings,
      upcomingIncomeUsd: State.upcomingIncome,
      zakat: {
        consecutiveDaysAboveThreshold: State.zakatConsecutiveDays,
        amountDueUsd: State.zakatSavedDueUsd,
        amountDueEgp: State.zakatSavedDueEgp
      },
      liveExchangeRates: {
        usdToEgp: State.cachedUsdEgp,
        usdToAud: State.cachedUsdAud,
        gold24kSpotUsdPerGram: State.cachedGold24kUsd
      },
      recentTransactions: State.transactions.slice(-5).map(t => ({
        date: t.date,
        description: t.description,
        amountUsd: t.amountUsd
      }))
    };
  }

  // Simple Markdown to HTML parser for AI responses
  function parseMarkdown(text) {
    let html = text;
    
    // Simple HTML escaping to avoid layout breaking, but allow clean formatting
    html = html
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Restore safe elements for layout formatting
    // Bold: **text**
    html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    
    // Inline code: `code`
    html = html.replace(/`(.*?)`/g, "<code>$1</code>");

    // Parse unordered lists
    const lines = html.split("\n");
    let inList = false;
    const processedLines = lines.map(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith("* ") || trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
        const content = trimmed.replace(/^[\*\-•]\s+/, "");
        let prefix = "";
        if (!inList) {
          prefix = '<ul style="margin-left: 1.2rem; margin-top: 0.3rem; list-style-type: disc; margin-bottom: 0.5rem;">';
          inList = true;
        }
        return `${prefix}<li>${content}</li>`;
      } else {
        let suffix = "";
        if (inList) {
          suffix = "</ul>";
          inList = false;
        }
        return `${suffix}${line}`;
      }
    });
    if (inList) {
      processedLines.push("</ul>");
    }
    
    html = processedLines.join("\n");
    html = html.replace(/\n/g, "<br>");
    return html;
  }

  // Free Keyless Online LLM fetcher via Pollinations AI
  async function processQuery(rawQuery) {
    const dashboardJson = serializeDashboardState();

    // Construct the context-enriched prompt with agentic instruction-based tools
    const contextPrompt = `You are Aura, an intelligent and polite personal financial assistant for the AuraFinance dashboard.
Answer the user's question accurately, clearly, and concisely using the live dashboard database state provided below.

=== LIVE DASHBOARD STATE (JSON) ===
${JSON.stringify(dashboardJson, null, 2)}
===================================

User Question: "${rawQuery}"

Instructions:
1. Base your answer directly on the live dashboard values.
2. For financial values, specify the currency and format them clearly (e.g. $1,234.56).
3. Keep the response friendly, helpful, and concise.

=== ACTIVE ACTION MUTATION CAPABILITY ===
If the user explicitly asks to edit, update, transfer, log, or set any values on their dashboard, you can perform it by adding a special action block at the VERY END of your message response in this EXACT format:
[ACTION: {"type": "ACTION_TYPE", "payload": { ... }}]

Only output ONE action block per response, and it MUST be at the end of the text.

Supported Action Types and Payload schemas:
1. "LOG_INCOME"
   - Use when the user asks to log a new upcoming income (flat amount).
   - Payload: { "amount": number, "description": string }
   - Example: [ACTION: {"type": "LOG_INCOME", "payload": {"amount": 350, "description": "Consultation client"}}]

2. "TRANSFER_FUNDS"
   - Use when the user asks to transfer funds between cash/digital sources.
   - Supported sources: "upcoming", "paypal", "nsave", "qnb_bebasata"
   - Payload: { "amount": number, "from": "upcoming"|"paypal"|"nsave"|"qnb_bebasata", "to": "upcoming"|"paypal"|"nsave"|"qnb_bebasata" }
   - Example: [ACTION: {"type": "TRANSFER_FUNDS", "payload": {"amount": 100, "from": "upcoming", "to": "paypal"}}]

3. "SET_BASELINE"
   - Use when setting the baseline cash savings or gold grams.
   - Payload: { "assetId": "gold"|"savings", "amount": number }
   - Example: [ACTION: {"type": "SET_BASELINE", "payload": {"assetId": "gold", "amount": 65}}]

4. "UPDATE_GOLD_PREMIUM"
   - Use when updating the local Egyptian gold premium percentage.
   - Payload: { "rate": number }
   - Example: [ACTION: {"type": "UPDATE_GOLD_PREMIUM", "payload": {"rate": 3.2}}]`;

    const encodedPrompt = encodeURIComponent(contextPrompt);
    const endpoint = `https://text.pollinations.ai/${encodedPrompt}`;

    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          "Accept": "text/plain"
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const replyText = await response.text();
      if (replyText) {
        // Intercept action block
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
            actionExecutedText = `<div class="chatbot-action-badge error">❌ Failed to parse dashboard mutation action.</div>`;
          }
        }

        return parseMarkdown(finalMessage) + actionExecutedText;
      } else {
        throw new Error("Received empty response from the AI server.");
      }
    } catch (err) {
      console.error("AI connection error:", err);
      return `
        <span style="color: var(--color-danger); font-weight: bold;">Connection to AI server failed.</span>
        <br>
        <span style="font-size: 0.76rem; color: var(--text-secondary);">Could not fetch from <code>${endpoint}</code>. Please check your internet connection and try again.</span>
      `;
    }
  }
}
