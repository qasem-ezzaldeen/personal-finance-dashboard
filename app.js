import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// --- SUPABASE CLOUD SYNC STATE & CREDENTIALS ---
const SUPABASE_URL = "https://lrjbqxyanqpakxuuvrfp.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyamJxeHlhbnFwYWt4dXV2cmZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5MzU5NTcsImV4cCI6MjA5NzUxMTk1N30.uaphqeSkf6uJDdJDH28Zfw0k4J-GVM3nkKknzV_GnG0";

let supabase = null;
let supabaseChannel = null;
let isCloudSyncActive = false;
let isPreventingSyncLoop = false;

/**
 * AuraFinance // Personal Financial Analytics Controller
 * 
 * Core Functionality:
 * 1. State Management: Direct Supabase database sync for baseline values and transaction logs.
 * 2. Asynchronous API Integrations:
 *    - USD to EGP Exchange Rate: ExchangeRate-API (https://open.er-api.com/v6/latest/USD)
 *    - Live Gold Price (XAU/USD): Gold API (https://api.gold-api.com/price/XAU)
 * 3. Programmatic Valuations:
 *    - Converts Gold Troy Ounce (XAU) spot price to 24k Gram price (1 oz = 31.1034768 grams).
 *    - Calculates 21k Gold Gram value as exactly 87.5% of the live 24k spot price.
 * 4. Transaction Logging: Logs new upcoming USD income, displaying conversions and before/after comparisons in real-time.
 * 5. Goals Tracker: Dynamic progress tracking for Zakat (85g 24k Gold value in EGP) and Migration ($20,000 USD).
 * 6. Clock Monitor & Automated Reset Engine: Detects the 24th of the month, resets upcoming income, flags the UI,
 *    and prompts users to update primary savings baselines.
 */

// Global target for rollback workflow
let revertTargetTx = null;
// Active transaction input method: "flat" or "hourly"
let activeInputMethod = "flat";
// Global Chart.js instance for the wealth donut chart
let wealthChart = null;



// --- STATE DEFINITION ---
const State = {
  // Financial baselines
  usdSavings: 0,
  goldGrams: 0,
  goldPremium: 2.5, // Default 2.5% local Egypt gold premium
  upcomingIncome: 0,
  
  // Lists
  transactions: [],
  
  // Rate caching
  cachedUsdEgp: 49.93, // Default fallback
  cachedGold24kUsd: 135.88, // Default fallback (~$4226/oz)
  lastFetchedTime: null,
  usdEgpTrend: "neutral",
  gold24kTrend: "neutral",
  gold21kTrend: "neutral",
  
  // Reset engine states
  lastResetMonth: "", // Format: YYYY-MM
  resetPending: false,
  resetRolledIncome: 0,

  // Save state directly to Supabase
  save() {
    if (isCloudSyncActive && !isPreventingSyncLoop) {
      syncStateToSupabase();
    }
  }
};

// --- API FETCHING ENGINE ---
// Constants for Gold metrics
const TROY_OUNCE_TO_GRAM = 31.1034768;
const GOLD_21K_RATIO = 0.875; // 21k gold is 21/24 = 87.5% purity

/**
 * Fetches live financial rates: USD to EGP exchange rate and XAU (Gold Troy Ounce) price in USD.
 * Handles rate limits, network issues, updates local storage cache, and refreshes the UI dashboard.
 */
async function fetchLiveRates() {
  const refreshBtn = document.getElementById("manual-refresh-btn");
  const refreshIcon = refreshBtn ? refreshBtn.querySelector(".refresh-icon") : null;
  const statusDot = document.getElementById("api-status-dot");
  const statusBadge = document.getElementById("api-status-indicator");
  
  // Trigger spinner animation
  if (refreshIcon) refreshIcon.classList.add("spinning");
  
  let fetchError = false;
  let usdEgpRate = State.cachedUsdEgp;
  let gold24kUsd = State.cachedGold24kUsd;
  let scrapeSuccess = false;

  try {
    let htmlText = "";
    
    // 1. First, attempt to fetch directly from https://gold-price-live.com/
    // (This will succeed if a CORS bypass extension is active or if hosted with disabled security)
    try {
      const response = await fetch("https://gold-price-live.com/");
      if (response.ok) {
        htmlText = await response.text();
        console.log("Successfully fetched rates directly from gold-price-live.com (CORS extension or bypass active)");
      } else {
        throw new Error("Direct fetch returned non-ok status");
      }
    } catch (directError) {
      // 2. Direct fetch failed (CORS block or network). Fall back to the public CORS proxy.
      console.log("Direct fetch to gold-price-live.com failed or was blocked by CORS. Attempting CORS proxy...");
      const targetUrl = "https://gold-price-live.com/";
      const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(targetUrl)}`;
      const response = await fetch(proxyUrl);
      if (!response.ok) throw new Error("CORS proxy request failed");
      const data = await response.json();
      if (!data || !data.contents) throw new Error("Invalid payload from CORS proxy");
      htmlText = data.contents;
    }

    if (htmlText) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlText, "text/html");
      
      let scrapedGold24kEgp = null;
      let scrapedUsdRate = null;

      // Check table rows first
      const rows = doc.querySelectorAll("tr");
      for (const row of rows) {
        const cells = row.querySelectorAll("td");
        if (cells.length >= 2) {
          const firstCellText = cells[0].textContent.trim();
          if (firstCellText.includes("عيار 24") || firstCellText.includes("24 قيراط")) {
            const valText = cells[1].textContent.replace(/,/g, '');
            const match = valText.match(/(\d+(?:\.\d+)?)/);
            if (match) scrapedGold24kEgp = parseFloat(match[1]);
          }
        }
      }

      // Fallback: Check anchor elements for gold price if table rows missed
      if (!scrapedGold24kEgp) {
        const anchor24 = doc.querySelector('a[href*="kerat-24"]');
        if (anchor24) {
          const valText = anchor24.textContent.replace(/,/g, '');
          const match = valText.match(/(\d+(?:\.\d+)?)/);
          if (match) scrapedGold24kEgp = parseFloat(match[1]);
        }
      }

      // Extract USD rate
      const bankUsdAnchor = doc.querySelector('a[href*="bank-usd"]');
      if (bankUsdAnchor) {
        const valText = bankUsdAnchor.textContent.replace(/,/g, '');
        const match = valText.match(/(\d+(?:\.\d+)?)/);
        if (match) scrapedUsdRate = parseFloat(match[1]);
      }
      if (!scrapedUsdRate) {
        const saghaUsdAnchor = doc.querySelector('a[href*="sagha-usd"]');
        if (saghaUsdAnchor) {
          const valText = saghaUsdAnchor.textContent.replace(/,/g, '');
          const match = valText.match(/(\d+(?:\.\d+)?)/);
          if (match) scrapedUsdRate = parseFloat(match[1]);
        }
      }

      if (scrapedGold24kEgp && scrapedUsdRate) {
        usdEgpRate = scrapedUsdRate;
        // Back-calculate 24k USD price from the raw EGP price and EGP exchange rate (premium added dynamically on UI update)
        gold24kUsd = scrapedGold24kEgp / usdEgpRate;
        scrapeSuccess = true;
        console.log(`Successfully scraped live rates: 24k EGP (raw) = ${scrapedGold24kEgp}, USD/EGP = ${usdEgpRate}, derived 24k USD/g = ${gold24kUsd}`);
      } else {
        throw new Error(`Incomplete scraped data. 24k EGP: ${scrapedGold24kEgp}, USD: ${scrapedUsdRate}`);
      }
    }
  } catch (error) {
    console.warn("Failed to scrape gold-price-live.com, falling back to global APIs:", error);
  }

  // 3. Fallback APIs (runs if scraping failed)
  if (!scrapeSuccess) {
    try {
      const fxResponse = await fetch("https://open.er-api.com/v6/latest/USD");
      if (!fxResponse.ok) throw new Error("Exchange rate API failed");
      const fxData = await fxResponse.json();
      if (fxData && fxData.rates && fxData.rates.EGP) {
        usdEgpRate = parseFloat(fxData.rates.EGP);
      } else {
        throw new Error("Invalid exchange rate payload");
      }
    } catch (error) {
      console.warn("Exchange Rate API failure, utilizing cached rate:", error);
      fetchError = true;
    }

    try {
      const goldResponse = await fetch("https://api.gold-api.com/price/XAU");
      if (!goldResponse.ok) throw new Error("Gold API failed");
      const goldData = await goldResponse.json();
      if (goldData && goldData.price) {
        const pricePerOunceUsd = parseFloat(goldData.price);
        gold24kUsd = pricePerOunceUsd / TROY_OUNCE_TO_GRAM;
        console.log(`Successfully fetched live spot gold rate from gold-api.com: XAU/USD = ${pricePerOunceUsd}, 24k USD/g = ${gold24kUsd}`);
      } else {
        throw new Error("Invalid gold price payload");
      }
    } catch (error) {
      console.warn("Gold Price API failure, utilizing cached rate:", error);
      fetchError = true;
    }
  }

  // Calculate trends before updating cached values
  const prevGold24kEgp = State.cachedGold24kUsd * State.cachedUsdEgp * (1 + State.goldPremium / 100);
  const prevGold21kEgp = prevGold24kEgp * GOLD_21K_RATIO;

  // Determine USD/EGP trend
  if (usdEgpRate > State.cachedUsdEgp) {
    State.usdEgpTrend = "up";
  } else if (usdEgpRate < State.cachedUsdEgp) {
    State.usdEgpTrend = "down";
  }

  // Determine Gold 24k trend
  const currentGold24kEgp = gold24kUsd * usdEgpRate * (1 + State.goldPremium / 100);
  if (currentGold24kEgp > prevGold24kEgp) {
    State.gold24kTrend = "up";
  } else if (currentGold24kEgp < prevGold24kEgp) {
    State.gold24kTrend = "down";
  }

  // Determine Gold 21k trend
  const currentGold21kEgp = currentGold24kEgp * GOLD_21K_RATIO;
  if (currentGold21kEgp > prevGold21kEgp) {
    State.gold21kTrend = "up";
  } else if (currentGold21kEgp < prevGold21kEgp) {
    State.gold21kTrend = "down";
  }

  // Update cached state and timestamp
  State.cachedUsdEgp = usdEgpRate;
  State.cachedGold24kUsd = gold24kUsd;
  State.lastFetchedTime = new Date().toLocaleString();

  // Update visual indicators of API status
  if (statusDot && statusBadge) {
    if (fetchError) {
      statusDot.className = "rate-dot error";
      statusBadge.textContent = "Rates Cached (Offline)";
      statusBadge.className = "api-status-badge negative";
    } else {
      statusDot.className = "rate-dot live";
      statusBadge.textContent = "Live API Active";
      statusBadge.className = "api-status-badge positive";
    }
  }
  
  // Stop spinner animation
  if (refreshIcon) {
    setTimeout(() => refreshIcon.classList.remove("spinning"), 500);
  }

  // Update dashboard values
  updateDashboardUI();
}

// --- AUTOMATED RESET ENGINE (SYSTEM CLOCK MONITOR) ---
/**
 * Monitors the system clock. On or after the 24th of the calendar month, if a reset
 * has not yet been logged for this month, upcoming income resets to 0.
 * The UI is flagged, and the user is modal-prompted to update baseline cash savings.
 */
function runClockAndResetCheck() {
  const now = new Date();
  const currentDay = now.getDate();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // Reset workflow triggers if day is >= 24 AND the reset hasn't run for this month key yet
  if (currentDay >= 24 && State.lastResetMonth !== currentMonthKey) {
    // 1. Lock reset parameters & log old values
    State.lastResetMonth = currentMonthKey;
    State.resetPending = true;
    State.resetRolledIncome = State.upcomingIncome;
    
    // 2. Perform the rollover reset
    State.upcomingIncome = 0;
    
    // Save state
    State.save();
    
    // 3. Render reset overlays
    showResetBannerAndModal();
  }

  // Update reset UI states continuously based on pending flag
  toggleResetBannerAndModalDisplay();
}

/**
 * Toggles visibility of the reset banner and modal depending on State.resetPending.
 */
function toggleResetBannerAndModalDisplay() {
  const banner = document.getElementById("monthly-reset-banner");
  const modal = document.getElementById("monthly-reset-modal");

  if (State.resetPending) {
    if (banner) banner.style.display = "flex";
    
    // Update labels in reset modal
    const rolledIncomeLabel = document.getElementById("reset-rolled-income");
    const currentSavingsLabel = document.getElementById("reset-current-savings");
    const newSavingsInput = document.getElementById("reset-new-savings-input");
    
    if (rolledIncomeLabel) rolledIncomeLabel.textContent = `$${State.resetRolledIncome.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} USD`;
    if (currentSavingsLabel) currentSavingsLabel.textContent = `$${State.usdSavings.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} USD`;
    
    // Autofill suggested new baseline savings = current USD savings + rolled upcoming income
    if (newSavingsInput && !newSavingsInput.value) {
      newSavingsInput.value = (State.usdSavings + State.resetRolledIncome).toFixed(2);
    }
  } else {
    if (banner) banner.style.display = "none";
    if (modal) modal.classList.remove("active");
  }
}

function showResetBannerAndModal() {
  toggleResetBannerAndModalDisplay();
  const modal = document.getElementById("monthly-reset-modal");
  if (modal) modal.classList.add("active");
}

// --- UI UPDATE & CALCULATION ENGINE ---
/**
 * Calculates current asset valuations and updates all table rows, goals, history log,
 * and text fields on the primary dashboard.
 */
function updateDashboardUI() {
  const usdEgpRate = State.cachedUsdEgp;
  const gold24kUsdPerGram = State.cachedGold24kUsd;
  
  // Calculate local Egyptian Gold Price (spot converted to EGP + local premium markup)
  const gold24kEgpPerGram = gold24kUsdPerGram * usdEgpRate * (1 + State.goldPremium / 100);
  const gold21kEgpPerGram = gold24kEgpPerGram * GOLD_21K_RATIO;
  
  // Local EGP Valuations (Valued at 30 EGP less than market value per gram)
  const goldSavingsEgp = State.goldGrams * Math.max(0, gold21kEgpPerGram - 30);
  
  // Gold USD Valuations (converted back for consistent side-by-side display)
  const goldSavingsUsd = goldSavingsEgp / usdEgpRate;
  
  // Cash Savings valuations
  const savingsUsd = State.usdSavings;
  const savingsEgp = savingsUsd * usdEgpRate;
  
  // Upcoming income valuations
  const upcomingIncomeUsd = State.upcomingIncome;
  const upcomingIncomeEgp = upcomingIncomeUsd * usdEgpRate;
  
  // Net Worth totals
  const totalNetWorthUsd = savingsUsd + goldSavingsUsd + upcomingIncomeUsd;
  const totalNetWorthEgp = savingsEgp + goldSavingsEgp + upcomingIncomeEgp;

  // Helper to build trend arrow HTML element
  const getTrendArrowHTML = (trend) => {
    if (trend === "up") {
      return `<span class="rate-trend-arrow up">▲</span>`;
    } else if (trend === "down") {
      return `<span class="rate-trend-arrow down">▼</span>`;
    }
    return "";
  };

  const usdEgpArrow = getTrendArrowHTML(State.usdEgpTrend);
  const gold24kArrow = getTrendArrowHTML(State.gold24kTrend);
  const gold21kArrow = getTrendArrowHTML(State.gold21kTrend);

  // --- 1. Update Rates Bar & Sync Timestamps ---
  document.getElementById("rate-usd-egp").innerHTML = `${usdEgpRate.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 4})} EGP${usdEgpArrow}`;
  // Display Egyptian gold rates in EGP in the header
  document.getElementById("rate-gold-24k").innerHTML = `${gold24kEgpPerGram.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} EGP${gold24kArrow}`;
  document.getElementById("rate-gold-21k").innerHTML = `${gold21kEgpPerGram.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} EGP${gold21kArrow}`;
  document.getElementById("last-updated-time").textContent = State.lastFetchedTime || "Never";

  // --- 2. Update Total Wealth Distribution Table ---
  // Cash row
  document.getElementById("table-savings-holdings").textContent = `$${savingsUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  document.getElementById("table-savings-usd").textContent = `$${savingsUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  document.getElementById("table-savings-egp").textContent = `${savingsEgp.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} EGP`;
  
  // Gold row (displays holdings with annotation of Market 21k - 30 EGP/g)
  document.getElementById("table-gold-holdings").textContent = `${State.goldGrams.toLocaleString(undefined, {maximumFractionDigits: 3})} g (Market 21k - 30 EGP/g)`;
  document.getElementById("table-gold-usd").textContent = `$${goldSavingsUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  document.getElementById("table-gold-egp").textContent = `${goldSavingsEgp.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} EGP`;
  
  // Upcoming Income row
  document.getElementById("table-income-holdings").textContent = `$${upcomingIncomeUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  document.getElementById("table-income-usd").textContent = `$${upcomingIncomeUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  document.getElementById("table-income-egp").textContent = `${upcomingIncomeEgp.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} EGP`;

  // Total Net Worth row
  document.getElementById("table-total-usd").textContent = `$${totalNetWorthUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
  document.getElementById("table-total-egp").textContent = `${totalNetWorthEgp.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} EGP`;

  // --- 3. Update Financial Goals Tracking Panel ---
  // Target 1: Zakat Threshold (85 grams of local 24k Gold valued in EGP)
  const zakatThresholdEgp = gold24kEgpPerGram * 85;
  
  const zakatPercent = zakatThresholdEgp > 0 ? (totalNetWorthEgp / zakatThresholdEgp) * 100 : 0;
  const zakatProgressFill = document.getElementById("zakat-progress-fill");
  if (zakatProgressFill) {
    zakatProgressFill.style.width = `${Math.min(100, zakatPercent)}%`;
  }
  document.getElementById("zakat-percent").textContent = `${zakatPercent.toFixed(1)}%`;
  document.getElementById("zakat-threshold-description").textContent = `Threshold: ${zakatThresholdEgp.toLocaleString(undefined, {maximumFractionDigits: 2})} EGP`;
  document.getElementById("zakat-current-val").textContent = `Net Worth: ${totalNetWorthEgp.toLocaleString(undefined, {maximumFractionDigits: 2})} EGP`;
  
  const zakatRemainingLabel = document.getElementById("zakat-remaining-val");
  if (totalNetWorthEgp >= zakatThresholdEgp) {
    zakatRemainingLabel.textContent = "Threshold Met (Zakat Due) ✓";
    zakatRemainingLabel.className = "goal-remaining met";
  } else {
    const zakatRemaining = zakatThresholdEgp - totalNetWorthEgp;
    zakatRemainingLabel.textContent = `Remaining: ${zakatRemaining.toLocaleString(undefined, {maximumFractionDigits: 2})} EGP`;
    zakatRemainingLabel.className = "goal-remaining";
  }

  // Target 2: Migration Goal ($20,000 USD)
  const migrationTargetUsd = 20000;
  const migrationPercent = (totalNetWorthUsd / migrationTargetUsd) * 100;
  const migrationProgressFill = document.getElementById("migration-progress-fill");
  if (migrationProgressFill) {
    migrationProgressFill.style.width = `${Math.min(100, migrationPercent)}%`;
  }
  document.getElementById("migration-percent").textContent = `${migrationPercent.toFixed(1)}%`;
  document.getElementById("migration-current-val").textContent = `Net Worth: $${totalNetWorthUsd.toLocaleString(undefined, {maximumFractionDigits: 2})} USD`;
  
  const migrationRemainingLabel = document.getElementById("migration-remaining-val");
  if (totalNetWorthUsd >= migrationTargetUsd) {
    migrationRemainingLabel.textContent = "Goal Reached ✓";
    migrationRemainingLabel.className = "goal-remaining met";
  } else {
    const migrationRemaining = migrationTargetUsd - totalNetWorthUsd;
    migrationRemainingLabel.textContent = `Remaining: $${migrationRemaining.toLocaleString(undefined, {maximumFractionDigits: 2})} USD`;
    migrationRemainingLabel.className = "goal-remaining";
  }

  // --- 4. Update Income Logs List ---
  const historyList = document.getElementById("history-list");
  const historyBadge = document.getElementById("history-count-badge");
  
  if (historyList) {
    historyList.innerHTML = "";
    
    // Sort transactions with newest first
    const sortedTransactions = [...State.transactions].sort((a, b) => b.timestamp - a.timestamp);
    
    if (sortedTransactions.length === 0) {
      historyList.innerHTML = `<div class="empty-state">No transaction logs for this month.</div>`;
    } else {
      sortedTransactions.forEach(tx => {
        const dateStr = new Date(tx.timestamp).toLocaleTimeString(undefined, {hour: '2-digit', minute:'2-digit'}) + 
                        " - " + new Date(tx.timestamp).toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
        
        const beforeEgp = tx.beforeIncome * tx.rateUsdEgp;
        const afterEgp = tx.afterIncome * tx.rateUsdEgp;

        const historyItem = document.createElement("div");
        historyItem.className = "history-item";
        historyItem.title = "Click to revert upcoming income history back to this point";
        historyItem.innerHTML = `
          <div class="history-details">
            <span class="history-amount-title">+$${tx.amountUsd.toLocaleString(undefined, {minimumFractionDigits: 2})} USD / +${tx.amountEgp.toLocaleString(undefined, {minimumFractionDigits: 2})} EGP</span>
            <span class="history-date">${dateStr}</span>
          </div>
          <div class="history-conversions text-right" style="text-align: right;">
            <span class="history-delta" style="display: block; font-size: 0.8rem; font-weight: 500; color: var(--text-primary); line-height: 1.3;">
              $${tx.beforeIncome.toLocaleString(undefined, {maximumFractionDigits:0})} ➜ $${tx.afterIncome.toLocaleString(undefined, {maximumFractionDigits:0})} USD
            </span>
            <span class="history-delta" style="display: block; font-size: 0.72rem; color: var(--text-secondary); line-height: 1.3;">
              ${beforeEgp.toLocaleString(undefined, {maximumFractionDigits:0})} ➜ ${afterEgp.toLocaleString(undefined, {maximumFractionDigits:0})} EGP
            </span>
          </div>
        `;
        
        // Attach click listener for history rollback
        historyItem.addEventListener("click", () => {
          triggerRevertWorkflow(tx);
        });

        historyList.appendChild(historyItem);
      });
    }
  }

  if (historyBadge) {
    historyBadge.textContent = `${State.transactions.length} log${State.transactions.length === 1 ? '' : 's'}`;
  }

  // Render/update the interactive Donut Chart
  renderWealthChart(savingsUsd, goldSavingsUsd, upcomingIncomeUsd);

  // Reset the inputs preview fields to clean defaults
  updateTransactionPreview();
}

/**
 * Initializes or dynamically updates the Chart.js donut chart segmenting
 * Cash Savings, Gold Savings (21k), and Upcoming Income.
 */
function renderWealthChart(savingsUsd, goldSavingsUsd, upcomingIncomeUsd) {
  const ctx = document.getElementById('wealth-donut-chart');
  if (!ctx) return;

  const total = savingsUsd + goldSavingsUsd + upcomingIncomeUsd;
  const dataValues = total > 0 ? [savingsUsd, goldSavingsUsd, upcomingIncomeUsd] : [0, 0, 0];

  const isLight = document.documentElement.classList.contains('light-theme');
  const textColor = isLight ? '#09090b' : '#ffffff';
  
  // Custom font styling matching Outfit
  const fontConfig = {
    family: "'Outfit', sans-serif",
    size: 11,
    weight: '500'
  };

  const data = {
    labels: ['Cash Savings', 'Gold Savings (21k)', 'Upcoming Income'],
    datasets: [{
      data: dataValues,
      backgroundColor: [
        '#22c55e', // Cash green
        '#eab308', // Gold yellow
        '#a855f7'  // Upcoming purple
      ],
      borderWidth: 2,
      borderColor: isLight ? '#ffffff' : '#09090b',
      hoverOffset: 6
    }]
  };

  const config = {
    type: 'doughnut',
    data: data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: false // Standard legend is hidden since the table represents it
        },
        tooltip: {
          backgroundColor: isLight ? '#ffffff' : '#09090b',
          titleColor: textColor,
          bodyColor: textColor,
          borderColor: isLight ? '#e4e4e7' : '#27272a',
          borderWidth: 1,
          titleFont: fontConfig,
          bodyFont: fontConfig,
          callbacks: {
            label: function(context) {
              const value = context.raw;
              const percent = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
              return ` $${value.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} (${percent}%)`;
            }
          }
        }
      },
      cutout: '72%'
    }
  };

  if (wealthChart) {
    wealthChart.data.datasets[0].data = dataValues;
    wealthChart.data.datasets[0].borderColor = isLight ? '#ffffff' : '#09090b';
    wealthChart.options.plugins.tooltip.backgroundColor = isLight ? '#ffffff' : '#09090b';
    wealthChart.options.plugins.tooltip.titleColor = textColor;
    wealthChart.options.plugins.tooltip.bodyColor = textColor;
    wealthChart.options.plugins.tooltip.borderColor = isLight ? '#e4e4e7' : '#27272a';
    wealthChart.update();
  } else {
    wealthChart = new Chart(ctx, config);
  }
}

/**
 * Calculates and updates the real-time conversion preview as the user is typing
 * in the Transaction Input panel.
 */
function updateTransactionPreview() {
  const amountInput = document.getElementById("transaction-amount");
  const previewEgp = document.getElementById("preview-egp-amount");
  const previewBefore = document.getElementById("preview-income-before");
  const previewAfter = document.getElementById("preview-income-after");

  let amountUsd = 0;
  if (activeInputMethod === "flat") {
    amountUsd = parseFloat(amountInput.value) || 0;
  } else {
    const hours = parseFloat(document.getElementById("hourly-hours").value) || 0;
    const minutes = parseFloat(document.getElementById("hourly-minutes").value) || 0;
    const rate = parseFloat(document.getElementById("hourly-rate").value) || 0;
    const roundedRate = Math.round(rate * 100) / 100;
    amountUsd = (hours + minutes / 60) * roundedRate;
    amountUsd = Math.round(amountUsd * 100) / 100;
  }
  const currentUsdEgp = State.cachedUsdEgp;

  // Real-time EGP conversion output
  const equivalentEgp = amountUsd * currentUsdEgp;
  previewEgp.textContent = `${equivalentEgp.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} EGP`;

  // Before / After upcoming income simulation
  const beforeIncome = State.upcomingIncome;
  const afterIncome = beforeIncome + amountUsd;

  const beforeIncomeEgp = beforeIncome * currentUsdEgp;
  const afterIncomeEgp = afterIncome * currentUsdEgp;

  previewBefore.innerHTML = `
    $${beforeIncome.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} USD<br>
    <span style="font-size: 0.72rem; color: var(--text-secondary);">${beforeIncomeEgp.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} EGP</span>
  `;
  previewAfter.innerHTML = `
    $${afterIncome.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} USD<br>
    <span style="font-size: 0.72rem; color: var(--text-secondary);">${afterIncomeEgp.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} EGP</span>
  `;
}

/**
 * Triggers the history rollback confirmation dialog modal.
 * Calculates how many subsequent entries will be deleted and displays values.
 */
function triggerRevertWorkflow(tx) {
  revertTargetTx = tx;
  const modal = document.getElementById("revert-modal");
  const targetLabel = document.getElementById("revert-target-income");
  const countLabel = document.getElementById("revert-discard-count");
  
  // Calculate how many transactions will be discarded (newer than target tx timestamp)
  const newerLogsCount = State.transactions.filter(t => t.timestamp > tx.timestamp).length;
  
  if (targetLabel) {
    targetLabel.textContent = `$${tx.afterIncome.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} USD`;
  }
  if (countLabel) {
    countLabel.textContent = `${newerLogsCount} log${newerLogsCount === 1 ? '' : 's'}`;
  }
  
  if (modal) {
    modal.style.display = "flex";
    setTimeout(() => modal.classList.add("active"), 10);
  }
}

// --- MODAL CONTROLLERS & EVENT ATTACHMENTS ---
function setupModalListeners() {
  // --- Setup Wizard Overlay Actions ---
  const setupForm = document.getElementById("setup-form");
  const wizardNextBtn = document.getElementById("wizard-next-btn");
  const wizardBackBtn = document.getElementById("wizard-back-btn");
  const setupSyncCodeInput = document.getElementById("setup-sync-code");
  const setupOverlay = document.getElementById("setup-wizard-overlay");

  if (wizardNextBtn) {
    wizardNextBtn.addEventListener("click", async () => {
      const syncCode = setupSyncCodeInput.value.trim();
      if (!syncCode) {
        setupSyncCodeInput.reportValidity();
        return;
      }
      
      wizardNextBtn.disabled = true;
      wizardNextBtn.textContent = "Checking...";
      
      try {
        // Connect temporary client to check code
        const tempSupabase = createClient(SUPABASE_URL, SUPABASE_KEY);
        const { data, error } = await tempSupabase
          .from('dashboards')
          .select('data')
          .eq('id', syncCode)
          .maybeSingle();
          
        if (error) {
          alert("Database error: " + error.message);
          return;
        }
        
        if (data && data.data) {
          // Sync code exists! Set code and pull data.
          localStorage.setItem("supabase_sync_code", syncCode);
          handleIncomingCloudState(data.data);
          
          // Hide overlay
          setupOverlay.style.display = "none";
          setupOverlay.classList.remove("active");
          
          // Connect active listener
          initSupabaseSync();
          fetchLiveRates();
        } else {
          // Sync code is new! Transition to Step 2 (Baseline configuration)
          document.getElementById("wizard-step-sync-code").style.display = "none";
          document.getElementById("wizard-step-baselines").style.display = "block";
          document.getElementById("setup-wizard-desc").textContent = "No record found for this code. Let's initialize your baselines.";
          // Ensure inputs in step 2 have required attributes
          document.getElementById("setup-cash-savings").setAttribute("required", "");
          document.getElementById("setup-gold-grams").setAttribute("required", "");
          document.getElementById("setup-gold-premium").setAttribute("required", "");
        }
      } catch (err) {
        console.error("Setup wizard error:", err);
        alert("Failed to connect: " + err.message);
      } finally {
        wizardNextBtn.disabled = false;
        wizardNextBtn.textContent = "Continue";
      }
    });
  }

  if (wizardBackBtn) {
    wizardBackBtn.addEventListener("click", () => {
      document.getElementById("wizard-step-sync-code").style.display = "block";
      document.getElementById("wizard-step-baselines").style.display = "none";
      document.getElementById("setup-wizard-desc").textContent = "Connect to your database vault or create a new one.";
      
      // Remove required attributes on step 2 when going back
      document.getElementById("setup-cash-savings").removeAttribute("required");
      document.getElementById("setup-gold-grams").removeAttribute("required");
      document.getElementById("setup-gold-premium").removeAttribute("required");
    });
  }

  if (setupForm) {
    setupForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      
      const syncCode = setupSyncCodeInput.value.trim();
      const cash = parseFloat(document.getElementById("setup-cash-savings").value);
      const gold = parseFloat(document.getElementById("setup-gold-grams").value);
      const premium = parseFloat(document.getElementById("setup-gold-premium").value);
      
      if (!isNaN(cash) && !isNaN(gold) && syncCode) {
        const setupSubmitBtn = document.getElementById("setup-submit-btn");
        if (setupSubmitBtn) {
          setupSubmitBtn.disabled = true;
          setupSubmitBtn.textContent = "Initializing...";
        }

        // Initialize state variables
        State.usdSavings = cash;
        State.goldGrams = gold;
        State.goldPremium = isNaN(premium) ? 2.5 : premium;
        State.upcomingIncome = 0;
        State.transactions = [];
        State.usdEgpTrend = "neutral";
        State.gold24kTrend = "neutral";
        State.gold21kTrend = "neutral";
        State.lastResetMonth = "";
        State.resetPending = false;
        State.resetRolledIncome = 0;
        
        // Save syncCode to localStorage and establish connection
        localStorage.setItem("supabase_sync_code", syncCode);
        supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
        isCloudSyncActive = true;
        
        // Save initial state directly to database
        await syncStateToSupabase();
        
        // Hide Wizard
        setupOverlay.style.display = "none";
        setupOverlay.classList.remove("active");
        
        // Initialize real-time streams
        initSupabaseSync();
        fetchLiveRates();
      }
    });
  }

  // --- Edit Cash Savings Modal ---
  const editSavingsBtn = document.getElementById("edit-savings-btn");
  const savingsModal = document.getElementById("edit-savings-modal");
  const cancelSavingsBtn = document.getElementById("cancel-savings-btn");
  const closeSavingsModal = document.getElementById("close-savings-modal");
  const editSavingsForm = document.getElementById("edit-savings-form");
  const editSavingsInput = document.getElementById("edit-cash-savings-input");

  if (editSavingsBtn && savingsModal) {
    editSavingsBtn.addEventListener("click", () => {
      editSavingsInput.value = State.usdSavings;
      savingsModal.style.display = "flex";
      setTimeout(() => savingsModal.classList.add("active"), 10);
    });
  }

  const hideSavingsModal = () => {
    savingsModal.classList.remove("active");
    setTimeout(() => savingsModal.style.display = "none", 300);
  };

  if (cancelSavingsBtn) cancelSavingsBtn.addEventListener("click", hideSavingsModal);
  if (closeSavingsModal) closeSavingsModal.addEventListener("click", hideSavingsModal);
  
  if (editSavingsForm) {
    editSavingsForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const newCash = parseFloat(editSavingsInput.value);
      if (!isNaN(newCash) && newCash >= 0) {
        State.usdSavings = newCash;
        State.save();
        hideSavingsModal();
        updateDashboardUI();
      }
    });
  }

  // --- Edit Gold Savings Modal ---
  const editGoldBtn = document.getElementById("edit-gold-btn");
  const goldModal = document.getElementById("edit-gold-modal");
  const cancelGoldBtn = document.getElementById("cancel-gold-btn");
  const closeGoldModal = document.getElementById("close-gold-modal");
  const editGoldForm = document.getElementById("edit-gold-form");
  const editGoldInput = document.getElementById("edit-gold-grams-input");
  const editGoldPremiumInput = document.getElementById("edit-gold-premium-input");
 
  if (editGoldBtn && goldModal) {
    editGoldBtn.addEventListener("click", () => {
      editGoldInput.value = State.goldGrams;
      editGoldPremiumInput.value = State.goldPremium;
      goldModal.style.display = "flex";
      setTimeout(() => goldModal.classList.add("active"), 10);
    });
  }

  const hideGoldModal = () => {
    goldModal.classList.remove("active");
    setTimeout(() => goldModal.style.display = "none", 300);
  };

  if (cancelGoldBtn) cancelGoldBtn.addEventListener("click", hideGoldModal);
  if (closeGoldModal) closeGoldModal.addEventListener("click", hideGoldModal);

  if (editGoldForm) {
    editGoldForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const newGold = parseFloat(editGoldInput.value);
      const newPremium = parseFloat(editGoldPremiumInput.value);
      if (!isNaN(newGold) && newGold >= 0 && !isNaN(newPremium)) {
        State.goldGrams = newGold;
        State.goldPremium = newPremium;
        State.save();
        hideGoldModal();
        updateDashboardUI();
      }
    });
  }

  // --- Monthly Reset Modal Actions ---
  const resetBannerActionBtn = document.getElementById("banner-action-btn");
  const resetModal = document.getElementById("monthly-reset-modal");
  const resetForm = document.getElementById("monthly-reset-form");
  const resetNewSavingsInput = document.getElementById("reset-new-savings-input");

  if (resetBannerActionBtn) {
    resetBannerActionBtn.addEventListener("click", () => {
      if (resetModal) {
        resetModal.style.display = "flex";
        setTimeout(() => resetModal.classList.add("active"), 10);
      }
    });
  }

  if (resetForm) {
    resetForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const updatedSavings = parseFloat(resetNewSavingsInput.value);
      if (!isNaN(updatedSavings) && updatedSavings >= 0) {
        // Apply new savings
        State.usdSavings = updatedSavings;
        
        // Finalize rollover state
        State.resetPending = false;
        State.resetRolledIncome = 0;
        
        // Reset the transaction history to start a fresh monthly income log
        State.transactions = [];
        
        // Save state
        State.save();
        
        // Hide banner/modal
        toggleResetBannerAndModalDisplay();
        
        // Update UI
        updateDashboardUI();
      }
    });
  }

  // --- Transaction Logging Form Submission ---
  const txForm = document.getElementById("transaction-form");
  const txAmountInput = document.getElementById("transaction-amount");
  const tabFlat = document.getElementById("tab-flat");
  const tabHourly = document.getElementById("tab-hourly");
  const blockFlat = document.getElementById("input-block-flat");
  const blockHourly = document.getElementById("input-block-hourly");
  const inputHours = document.getElementById("hourly-hours");
  const inputMinutes = document.getElementById("hourly-minutes");
  const inputRate = document.getElementById("hourly-rate");

  if (tabFlat && tabHourly && blockFlat && blockHourly) {
    tabFlat.addEventListener("click", () => {
      activeInputMethod = "flat";
      tabFlat.classList.add("active");
      tabHourly.classList.remove("active");
      blockFlat.style.display = "block";
      blockHourly.style.display = "none";

      txAmountInput.setAttribute("required", "");
      if (inputHours) inputHours.removeAttribute("required");
      if (inputRate) inputRate.removeAttribute("required");

      updateTransactionPreview();
    });

    tabHourly.addEventListener("click", () => {
      activeInputMethod = "hourly";
      tabHourly.classList.add("active");
      tabFlat.classList.remove("active");
      blockHourly.style.display = "block";
      blockFlat.style.display = "none";

      txAmountInput.removeAttribute("required");
      if (inputHours) inputHours.setAttribute("required", "");
      if (inputRate) inputRate.setAttribute("required", "");

      updateTransactionPreview();
    });
  }

  if (txForm) {
    txForm.addEventListener("submit", (e) => {
      e.preventDefault();
      
      let amountUsd = 0;
      if (activeInputMethod === "flat") {
        amountUsd = parseFloat(txAmountInput.value);
      } else {
        const hours = parseFloat(inputHours.value) || 0;
        const minutes = parseFloat(inputMinutes.value) || 0;
        const rate = parseFloat(inputRate.value) || 0;
        const roundedRate = Math.round(rate * 100) / 100;
        amountUsd = (hours + minutes / 60) * roundedRate;
        amountUsd = Math.round(amountUsd * 100) / 100;
      }

      if (!isNaN(amountUsd) && amountUsd > 0) {
        const usdEgpRate = State.cachedUsdEgp;
        const amountEgp = amountUsd * usdEgpRate;
        const beforeIncome = State.upcomingIncome;
        const afterIncome = beforeIncome + amountUsd;

        // Build transaction log object
        const newTx = {
          id: "tx_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
          amountUsd: amountUsd,
          amountEgp: amountEgp,
          rateUsdEgp: usdEgpRate,
          timestamp: Date.now(),
          beforeIncome: beforeIncome,
          afterIncome: afterIncome
        };

        // Append to income lists & totals
        State.transactions.push(newTx);
        State.upcomingIncome = afterIncome;
        State.save();

        // Clear input and update
        txAmountInput.value = "";
        if (inputHours) inputHours.value = "";
        if (inputMinutes) inputMinutes.value = "";
        if (inputRate) inputRate.value = "";
        updateDashboardUI();
      }
    });

    if (txAmountInput) {
      txAmountInput.addEventListener("input", updateTransactionPreview);
    }
    if (inputHours) inputHours.addEventListener("input", updateTransactionPreview);
    if (inputMinutes) inputMinutes.addEventListener("input", updateTransactionPreview);
    if (inputRate) {
      inputRate.addEventListener("input", updateTransactionPreview);
      inputRate.addEventListener("blur", () => {
        const val = parseFloat(inputRate.value);
        if (!isNaN(val)) {
          inputRate.value = val.toFixed(2);
        }
      });
    }
  }

  // --- Revert Transaction Modal Events ---
  const revertModal = document.getElementById("revert-modal");
  const cancelRevertBtn = document.getElementById("cancel-revert-btn");
  const closeRevertModal = document.getElementById("close-revert-modal");
  const confirmRevertBtn = document.getElementById("confirm-revert-btn");

  const hideRevertModal = () => {
    if (revertModal) {
      revertModal.classList.remove("active");
      setTimeout(() => revertModal.style.display = "none", 300);
    }
    revertTargetTx = null;
  };

  if (cancelRevertBtn) cancelRevertBtn.addEventListener("click", hideRevertModal);
  if (closeRevertModal) closeRevertModal.addEventListener("click", hideRevertModal);

  if (confirmRevertBtn) {
    confirmRevertBtn.addEventListener("click", () => {
      if (revertTargetTx) {
        // Roll back running upcoming income to the target's afterIncome
        State.upcomingIncome = revertTargetTx.afterIncome;
        
        // Remove all logs created after the target log
        State.transactions = State.transactions.filter(t => t.timestamp <= revertTargetTx.timestamp);
        
        State.save();
        hideRevertModal();
        updateDashboardUI();
      }
    });
  }

  // --- Manual Refresh Button Event ---
  const refreshBtn = document.getElementById("manual-refresh-btn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", fetchLiveRates);
  }

  // --- Cloud Sync Settings Modal ---
  const cloudSyncBtn = document.getElementById("cloud-sync-btn");
  const syncModal = document.getElementById("sync-settings-modal");
  const closeSyncModal = document.getElementById("close-sync-modal");
  const closeSyncSettingsBtn = document.getElementById("close-sync-settings-btn");
  const syncCodeInput = document.getElementById("sync-code-input");
  const disconnectSyncBtn = document.getElementById("disconnect-sync-btn");

  if (cloudSyncBtn && syncModal) {
    cloudSyncBtn.addEventListener("click", () => {
      syncCodeInput.value = localStorage.getItem("supabase_sync_code") || "";
      syncModal.style.display = "flex";
      setTimeout(() => syncModal.classList.add("active"), 10);
    });
  }

  const hideSyncModal = () => {
    if (syncModal) {
      syncModal.classList.remove("active");
      setTimeout(() => syncModal.style.display = "none", 300);
    }
  };

  if (closeSyncModal) closeSyncModal.addEventListener("click", hideSyncModal);
  if (closeSyncSettingsBtn) closeSyncSettingsBtn.addEventListener("click", hideSyncModal);

  if (disconnectSyncBtn) {
    disconnectSyncBtn.addEventListener("click", () => {
      if (confirm("Are you sure you want to disconnect from this vault? Your local dashboard will reset.")) {
        localStorage.removeItem("supabase_sync_code");
        disconnectSupabase();
        hideSyncModal();
        
        // Reset local state to blank
        State.usdSavings = 0;
        State.goldGrams = 0;
        State.goldPremium = 2.5;
        State.upcomingIncome = 0;
        State.transactions = [];
        State.usdEgpTrend = "neutral";
        State.gold24kTrend = "neutral";
        State.gold21kTrend = "neutral";
        State.lastResetMonth = "";
        State.resetPending = false;
        State.resetRolledIncome = 0;
        
        updateDashboardUI();
        
        // Clear setup inputs
        setupSyncCodeInput.value = "";
        document.getElementById("setup-cash-savings").value = "";
        document.getElementById("setup-gold-grams").value = "";
        document.getElementById("setup-gold-premium").value = "2.5";
        document.getElementById("wizard-step-sync-code").style.display = "block";
        document.getElementById("wizard-step-baselines").style.display = "none";
        document.getElementById("setup-wizard-desc").textContent = "Connect to your database vault or create a new one.";

        // Prompt for new sync code
        showSyncCodePrompt();
      }
    });
  }
}

// --- SUPABASE CLOUD SYNC ENGINE WORKFLOWS ---
function disconnectSupabase() {
  if (supabaseChannel) {
    supabase.removeChannel(supabaseChannel);
    supabaseChannel = null;
  }
  supabase = null;
  isCloudSyncActive = false;
  
  const syncBtn = document.getElementById("cloud-sync-btn");
  if (syncBtn) {
    syncBtn.className = "refresh-btn cloud-sync-btn offline";
    syncBtn.title = "Supabase Cloud Sync Settings (Offline)";
  }
}

async function syncStateToSupabase() {
  const syncCode = localStorage.getItem("supabase_sync_code");
  if (!syncCode) return;
  
  if (!supabase) {
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  }
  
  try {
    const payload = {
      usdSavings: State.usdSavings,
      goldGrams: State.goldGrams,
      goldPremium: State.goldPremium,
      upcomingIncome: State.upcomingIncome,
      transactions: State.transactions,
      lastResetMonth: State.lastResetMonth,
      resetPending: State.resetPending,
      resetRolledIncome: State.resetRolledIncome
    };
    
    const { error } = await supabase
      .from('dashboards')
      .upsert({ id: syncCode, data: payload, updated_at: new Date().toISOString() });
      
    if (error) {
      console.error("Failed to sync state to Supabase:", error);
    } else {
      console.log("State synced to Supabase successfully!");
    }
  } catch (err) {
    console.error("Failed to sync state to Supabase:", err);
  }
}

async function initSupabaseSync() {
  const syncBtn = document.getElementById("cloud-sync-btn");
  
  if (supabaseChannel) {
    supabase.removeChannel(supabaseChannel);
    supabaseChannel = null;
  }
  
  const syncCode = localStorage.getItem("supabase_sync_code");
  
  if (!syncCode) {
    disconnectSupabase();
    showSyncCodePrompt();
    return;
  }
  
  try {
    if (syncBtn) {
      syncBtn.className = "refresh-btn cloud-sync-btn connecting";
      syncBtn.title = "Connecting to Supabase...";
    }
    
    supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    isCloudSyncActive = true;
    
    // 1. Fetch initial state
    const { data: dbData, error } = await supabase
      .from('dashboards')
      .select('data')
      .eq('id', syncCode)
      .maybeSingle();
      
    if (error) {
      console.error("Failed to pull state from Supabase on init:", error);
      disconnectSupabase();
      if (syncBtn) {
        syncBtn.className = "refresh-btn cloud-sync-btn offline";
        syncBtn.title = `Supabase Error: ${error.message}`;
      }
    } else if (dbData && dbData.data) {
      console.log("Initial state pulled from Supabase:", dbData.data);
      handleIncomingCloudState(dbData.data);
      fetchLiveRates(); // Pull fresh rates once connected and loaded
    } else {
      console.log("No cloud data found for code. Opening wizard step 2...");
      showWizardStep2();
    }
    
    // 2. Real-time Subscription Channel
    supabaseChannel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'dashboards',
          filter: `id=eq.${syncCode}`
        },
        (payload) => {
          console.log("Supabase real-time payload:", payload);
          if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
            const newData = payload.new.data;
            if (newData) {
              handleIncomingCloudState(newData);
            }
          }
        }
      )
      .subscribe((status) => {
        console.log("Supabase subscription status:", status);
        if (status === 'SUBSCRIBED') {
          if (syncBtn) {
            syncBtn.className = "refresh-btn cloud-sync-btn connected";
            syncBtn.title = `Cloud Synced to code: ${syncCode}`;
          }
        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
          if (syncBtn) {
            syncBtn.className = "refresh-btn cloud-sync-btn offline";
            syncBtn.title = "Supabase Subscription Disconnected";
          }
        }
      });
      
  } catch (err) {
    console.error("Failed to connect to Supabase:", err);
    disconnectSupabase();
    if (syncBtn) {
      syncBtn.className = "refresh-btn cloud-sync-btn offline";
      syncBtn.title = `Supabase Connection Error: ${err.message}`;
    }
  }
}

function handleIncomingCloudState(data) {
  isPreventingSyncLoop = true;
  
  if (data.usdSavings !== undefined) State.usdSavings = Number(data.usdSavings);
  if (data.goldGrams !== undefined) State.goldGrams = Number(data.goldGrams);
  if (data.goldPremium !== undefined) State.goldPremium = Number(data.goldPremium);
  if (data.upcomingIncome !== undefined) State.upcomingIncome = Number(data.upcomingIncome);
  if (data.transactions !== undefined) State.transactions = data.transactions;
  if (data.cachedUsdEgp !== undefined) State.cachedUsdEgp = Number(data.cachedUsdEgp);
  if (data.cachedGold24kUsd !== undefined) State.cachedGold24kUsd = Number(data.cachedGold24kUsd);
  if (data.lastFetchedTime !== undefined) State.lastFetchedTime = data.lastFetchedTime;
  if (data.usdEgpTrend !== undefined) State.usdEgpTrend = data.usdEgpTrend;
  if (data.gold24kTrend !== undefined) State.gold24kTrend = data.gold24kTrend;
  if (data.gold21kTrend !== undefined) State.gold21kTrend = data.gold21kTrend;
  if (data.lastResetMonth !== undefined) State.lastResetMonth = data.lastResetMonth;
  if (data.resetPending !== undefined) State.resetPending = data.resetPending;
  if (data.resetRolledIncome !== undefined) State.resetRolledIncome = Number(data.resetRolledIncome);
  
  isPreventingSyncLoop = false;
  updateDashboardUI();
}

function showSyncCodePrompt() {
  const setupOverlay = document.getElementById("setup-wizard-overlay");
  const step1 = document.getElementById("wizard-step-sync-code");
  const step2 = document.getElementById("wizard-step-baselines");
  
  if (setupOverlay && step1 && step2) {
    step1.style.display = "block";
    step2.style.display = "none";
    setupOverlay.style.display = "flex";
    setTimeout(() => setupOverlay.classList.add("active"), 10);
  }
}

function showWizardStep2() {
  const setupOverlay = document.getElementById("setup-wizard-overlay");
  const step1 = document.getElementById("wizard-step-sync-code");
  const step2 = document.getElementById("wizard-step-baselines");
  
  if (setupOverlay && step1 && step2) {
    step1.style.display = "none";
    step2.style.display = "block";
    setupOverlay.style.display = "flex";
    setTimeout(() => setupOverlay.classList.add("active"), 10);
  }
}

// --- THEME MANAGEMENT ENGINE ---
function initTheme() {
  const savedTheme = localStorage.getItem("theme") || "dark";
  const themeToggleBtn = document.getElementById("theme-toggle-btn");
  const themeIcon = themeToggleBtn ? themeToggleBtn.querySelector(".theme-icon") : null;
  
  if (savedTheme === "light") {
    document.documentElement.classList.add("light-theme");
    if (themeIcon) themeIcon.textContent = "🌙";
  } else {
    document.documentElement.classList.remove("light-theme");
    if (themeIcon) themeIcon.textContent = "☀️";
  }
  
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
      const isCurrentlyLight = document.documentElement.classList.toggle("light-theme");
      const newTheme = isCurrentlyLight ? "light" : "dark";
      localStorage.setItem("theme", newTheme);
      if (themeIcon) themeIcon.textContent = isCurrentlyLight ? "🌙" : "☀️";
      
      // Force update to refresh chart colors/borders
      updateDashboardUI();
    });
  }
}

// --- APP INITIALIZATION & BOOTSTRAP ---
document.addEventListener("DOMContentLoaded", () => {
  // 0. Initialize light/dark theme preference
  initTheme();

  // 0.1 Clean up legacy Local Storage keys to ensure zero local storage persistence
  const localKeys = [
    "usdSavings", "goldGrams", "goldPremium", "upcomingIncome", "transactions",
    "cachedUsdEgp", "cachedGold24kUsd", "lastFetchedTime", "usdEgpTrend",
    "gold24kTrend", "gold21kTrend", "lastResetMonth", "resetPending",
    "resetRolledIncome", "supabase_url", "supabase_key",
    "firebase_config", "firebase_sync_code"
  ];
  localKeys.forEach(k => localStorage.removeItem(k));

  // 0.2 Initialize Supabase Cloud Sync Connection
  const syncCode = localStorage.getItem("supabase_sync_code");
  if (!syncCode) {
    showSyncCodePrompt();
  } else {
    initSupabaseSync();
  }

  // 2. Setup Event Handlers
  setupModalListeners();

  // 3. Clock & Reset Engine Monitor Loop
  // Perform check instantly on start
  runClockAndResetCheck();
  
  // Actively check clock every 10 seconds for real-time monitoring
  setInterval(runClockAndResetCheck, 10000);

  // 4. Auto-fetch live rates every 5 minutes (300000 ms) for automatic updates
  setInterval(fetchLiveRates, 300000);
});
