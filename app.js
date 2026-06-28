import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// --- SUPABASE CLOUD SYNC STATE & CREDENTIALS ---
const SUPABASE_URL = "https://lrjbqxyanqpakxuuvrfp.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxyamJxeHlhbnFwYWt4dXV2cmZwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE5MzU5NTcsImV4cCI6MjA5NzUxMTk1N30.uaphqeSkf6uJDdJDH28Zfw0k4J-GVM3nkKknzV_GnG0";

let supabase = null;
let supabaseChannel = null;
let isCloudSyncActive = false;
let isPreventingSyncLoop = false;
let isInitialLoadComplete = false;

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
  // Financial dynamic assets list
  assets: [],
  
  // Legacy getters/setters for backwards compatibility and easy API support
  get usdSavings() {
    const usdAssets = this.assets.filter(a => a.currency === "USD");
    return usdAssets.reduce((sum, a) => sum + a.holdings, 0);
  },
  
  set usdSavings(value) {
    let savingsAsset = this.assets.find(a => a.id === "savings");
    if (!savingsAsset) {
      savingsAsset = this.assets.find(a => a.currency === "USD");
    }
    if (savingsAsset) {
      savingsAsset.holdings = value;
    } else {
      this.assets.push({
        id: "savings",
        name: "Cash Savings",
        category: "Cash Savings",
        holdings: value,
        currency: "USD",
        color: "#22c55e"
      });
    }
  },

  get goldGrams() {
    const goldAssets = this.assets.filter(a => a.currency === "Gold (Grams)");
    return goldAssets.reduce((sum, a) => sum + a.holdings, 0);
  },

  set goldGrams(value) {
    let goldAsset = this.assets.find(a => a.id === "gold");
    if (!goldAsset) {
      goldAsset = this.assets.find(a => a.currency === "Gold (Grams)");
    }
    if (goldAsset) {
      goldAsset.holdings = value;
    } else {
      this.assets.push({
        id: "gold",
        name: "Gold Savings (21k)",
        category: "Gold Savings",
        holdings: value,
        currency: "Gold (Grams)",
        color: "#eab308"
      });
    }
  },

  goldPremium: 2.5, // Default 2.5% local Egypt gold premium
  upcomingIncome: 0,
  
  // Lists
  transactions: [],
  goals: [], // Dynamic goals
  
  // Rate caching
  cachedUsdEgp: 49.93, // Default fallback
  cachedUsdAud: 1.50, // Default fallback for AUD
  cachedGold24kUsd: 135.88, // Default fallback (~$4226/oz)
  lastFetchedTime: null,
  usdEgpTrend: "neutral",
  usdAudTrend: "neutral", // Trend for AUD
  gold24kTrend: "neutral",
  gold21kTrend: "neutral",
  
  // Reset engine states
  lastResetMonth: "", // Format: YYYY-MM
  resetPending: false,
  resetRolledIncome: 0,
  lastNsaveTransferMonth: "", // Format: YYYY-MM
  
  // Zakat streak states
  zakatConsecutiveDays: 0,
  lastZakatCheckDate: "",
  zakatSavedDueUsd: 0,
  zakatSavedDueEgp: 0,
  zakatSavedDueAud: 0,

  // Save state directly to Supabase
  getPayload() {
    return {
      assets: this.assets,
      usdSavings: this.usdSavings,
      goldGrams: this.goldGrams,
      goldPremium: this.goldPremium,
      upcomingIncome: this.upcomingIncome,
      transactions: this.transactions,
      goals: this.goals,
      cachedUsdAud: this.cachedUsdAud,
      usdAudTrend: this.usdAudTrend,
      cachedUsdEgp: this.cachedUsdEgp,
      cachedGold24kUsd: this.cachedGold24kUsd,
      lastFetchedTime: this.lastFetchedTime,
      usdEgpTrend: this.usdEgpTrend,
      gold24kTrend: this.gold24kTrend,
      gold21kTrend: this.gold21kTrend,
      lastResetMonth: this.lastResetMonth,
      resetPending: this.resetPending,
      resetRolledIncome: this.resetRolledIncome,
      lastNsaveTransferMonth: this.lastNsaveTransferMonth,
      zakatConsecutiveDays: this.zakatConsecutiveDays,
      lastZakatCheckDate: this.lastZakatCheckDate,
      zakatSavedDueUsd: this.zakatSavedDueUsd,
      zakatSavedDueEgp: this.zakatSavedDueEgp,
      zakatSavedDueAud: this.zakatSavedDueAud
    };
  },

  save() {
    ensureZakatGoal();
    
    // Save backup to Local Storage
    const payload = this.getPayload();
    payload.updated_at = new Date().toISOString();
    localStorage.setItem("aurafinance_local_state", JSON.stringify(payload));

    if (isCloudSyncActive && isInitialLoadComplete && !isPreventingSyncLoop) {
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
        // If the parsed gold price is > 10,000 EGP, it represents a troy ounce price.
        // We divide by 31.1034768 to get the EGP price per gram of 24k gold.
        if (scrapedGold24kEgp > 10000) {
          scrapedGold24kEgp = scrapedGold24kEgp / TROY_OUNCE_TO_GRAM;
        }
        // Back-calculate 24k USD price from the raw EGP price and EGP exchange rate (premium added dynamically on UI update)
        gold24kUsd = scrapedGold24kEgp / usdEgpRate;
        scrapeSuccess = true;
        console.log(`Successfully scraped live rates: 24k EGP (raw gram) = ${scrapedGold24kEgp}, USD/EGP = ${usdEgpRate}, derived 24k USD/g = ${gold24kUsd}`);
      } else {
        throw new Error(`Incomplete scraped data. 24k EGP: ${scrapedGold24kEgp}, USD: ${scrapedUsdRate}`);
      }
    }
  } catch (error) {
    console.warn("Failed to scrape gold-price-live.com, falling back to global APIs:", error);
  }

  let usdAudRate = State.cachedUsdAud;

  // Fetch exchange rates (USD to AUD always, and USD to EGP if scraping failed)
  try {
    const fxResponse = await fetch("https://open.er-api.com/v6/latest/USD");
    if (!fxResponse.ok) throw new Error("Exchange rate API failed");
    const fxData = await fxResponse.json();
    if (fxData && fxData.rates) {
      if (fxData.rates.AUD) {
        usdAudRate = parseFloat(fxData.rates.AUD);
      }
      if (!scrapeSuccess && fxData.rates.EGP) {
        usdEgpRate = parseFloat(fxData.rates.EGP);
      }
    } else {
      throw new Error("Invalid exchange rate payload");
    }
  } catch (error) {
    console.warn("Exchange Rate API failure, utilizing cached rates:", error);
    if (!scrapeSuccess) {
      fetchError = true;
    }
  }

  // 3. Fallback Gold API (runs if scraping failed)
  if (!scrapeSuccess) {
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

  // Determine USD/AUD trend
  if (usdAudRate > State.cachedUsdAud) {
    State.usdAudTrend = "up";
  } else if (usdAudRate < State.cachedUsdAud) {
    State.usdAudTrend = "down";
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
  State.cachedUsdAud = usdAudRate;
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
  if (!isInitialLoadComplete) return;
  const now = new Date();
  const currentDay = now.getDate();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // 1. PayPal to nsave monthly auto-transfer check
  if (currentDay >= 1 && State.lastNsaveTransferMonth !== currentMonthKey) {
    State.lastNsaveTransferMonth = currentMonthKey;
    
    const paypalAsset = State.assets.find(a => a.id === "paypal" || a.name.toLowerCase() === "paypal");
    if (paypalAsset && paypalAsset.holdings > 0) {
      let nsaveAsset = State.assets.find(a => a.id === "nsave" || a.name.toLowerCase() === "nsave");
      const transferAmount = paypalAsset.holdings;
      
      if (!nsaveAsset) {
        nsaveAsset = {
          id: "nsave",
          name: "nsave",
          category: "nsave Savings",
          holdings: 0,
          currency: "USD",
          color: "#ef4444" // RED ACCENT COLOR
        };
        State.assets.push(nsaveAsset);
      } else {
        nsaveAsset.color = "#ef4444"; // Ensure it is red
      }
      
      nsaveAsset.holdings += transferAmount;
      paypalAsset.holdings = 0;
      
      // Remove PayPal from assets completely to hide it
      State.assets = State.assets.filter(a => a.id !== paypalAsset.id);
      
      // Log transaction
      const usdEgpRate = State.cachedUsdEgp;
      const autoTx = {
        id: "tx_auto_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
        amountUsd: transferAmount,
        amountEgp: transferAmount * usdEgpRate,
        rateUsdEgp: usdEgpRate,
        timestamp: Date.now(),
        beforeIncome: State.upcomingIncome,
        afterIncome: State.upcomingIncome,
        description: "Auto-Consolidation: PayPal to nsave"
      };
      State.transactions.push(autoTx);
      console.log(`Auto-transferred $${transferAmount} from PayPal to nsave.`);
    }
    State.save();
  }

  // 2. Reset workflow triggers if day is >= 24 AND the reset hasn't run for this month key yet
  if (currentDay >= 24 && State.lastResetMonth !== currentMonthKey) {
    // 1. Lock reset parameters & log old values
    State.lastResetMonth = currentMonthKey;
    State.resetPending = false; // Do not prompt the user
    State.resetRolledIncome = State.upcomingIncome;
    
    // Transfer incoming money to PayPal
    const transferAmount = State.upcomingIncome;
    if (transferAmount > 0) {
      let paypalAsset = State.assets.find(a => a.id === "paypal" || a.name.toLowerCase() === "paypal");
      if (!paypalAsset) {
        paypalAsset = {
          id: "paypal",
          name: "PayPal",
          category: "Digital Wallet",
          holdings: 0,
          currency: "USD",
          color: "#3b82f6"
        };
        State.assets.push(paypalAsset);
      }
      paypalAsset.holdings += transferAmount;
      
      // Log transaction
      const usdEgpRate = State.cachedUsdEgp;
      const autoTx = {
        id: "tx_auto_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
        amountUsd: transferAmount,
        amountEgp: transferAmount * usdEgpRate,
        rateUsdEgp: usdEgpRate,
        timestamp: Date.now(),
        beforeIncome: transferAmount,
        afterIncome: 0,
        description: "Auto-Transfer: Upcoming Income to PayPal"
      };
      State.transactions.push(autoTx);
      console.log(`Auto-transferred $${transferAmount} of upcoming income to PayPal.`);
    }
    
    // 2. Perform the rollover reset (start calculating from zero for the next log of upcoming money)
    State.upcomingIncome = 0;
    
    // Save state
    State.save();
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

/**
 * Calculates dynamic valuations for a given holding and currency in USD, AUD, and EGP.
 */
function getAssetValuations(holdings, currency) {
  const usdEgpRate = State.cachedUsdEgp;
  const usdAudRate = State.cachedUsdAud;
  const gold24kUsdPerGram = State.cachedGold24kUsd;
  
  const gold24kEgpPerGram = gold24kUsdPerGram * usdEgpRate * (1 + State.goldPremium / 100);
  const gold21kEgpPerGram = gold24kEgpPerGram * GOLD_21K_RATIO;
  
  let usd = 0;
  let aud = 0;
  let egp = 0;
  
  if (currency === "USD") {
    usd = holdings;
    aud = usd * usdAudRate;
    egp = usd * usdEgpRate;
  } else if (currency === "AUD") {
    aud = holdings;
    usd = usdAudRate > 0 ? (aud / usdAudRate) : 0;
    egp = usd * usdEgpRate;
  } else if (currency === "EGP") {
    egp = holdings;
    usd = usdEgpRate > 0 ? (egp / usdEgpRate) : 0;
    aud = usd * usdAudRate;
  } else if (currency === "Gold (Grams)") {
    // Egypt 21k Gold formula: valued at 30 EGP less than market value per gram
    egp = holdings * Math.max(0, gold21kEgpPerGram - 30);
    usd = usdEgpRate > 0 ? (egp / usdEgpRate) : 0;
    aud = usd * usdAudRate;
  }
  
  return { usd, aud, egp };
}

// --- UI UPDATE & CALCULATION ENGINE ---
/**
 * Calculates current asset valuations and updates all table rows, goals, history log,
 * and text fields on the primary dashboard.
 */
function updateDashboardUI(force = false) {
  if (!isInitialLoadComplete && !force) return;
  const usdEgpRate = State.cachedUsdEgp;
  const usdAudRate = State.cachedUsdAud;
  const gold24kUsdPerGram = State.cachedGold24kUsd;
  
  // Calculate local Egyptian Gold Price (spot converted to EGP + local premium markup)
  const gold24kEgpPerGram = gold24kUsdPerGram * usdEgpRate * (1 + State.goldPremium / 100);
  const gold21kEgpPerGram = gold24kEgpPerGram * GOLD_21K_RATIO;
  
  // 1. Calculate dynamic valuations and Net Worth totals
  let totalNetWorthUsd = 0;
  let totalNetWorthAud = 0;
  let totalNetWorthEgp = 0;

  // Render all dynamic assets and build the tbody content
  const tbody = document.getElementById("wealth-distribution-tbody");
  let tbodyHtml = "";

  if (tbody) {
    State.assets.forEach(asset => {
      if ((asset.id === "paypal" || asset.name.toLowerCase() === "paypal") && asset.holdings === 0) {
        return;
      }
      const { usd, aud, egp } = getAssetValuations(asset.holdings, asset.currency);
      
      totalNetWorthUsd += usd;
      totalNetWorthAud += aud;
      totalNetWorthEgp += egp;
      
      let holdingsText = "";
      if (asset.currency === "USD") {
        holdingsText = `$${asset.holdings.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
      } else if (asset.currency === "AUD") {
        holdingsText = `${asset.holdings.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} AUD`;
      } else if (asset.currency === "EGP") {
        holdingsText = `${asset.holdings.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} EGP`;
      } else if (asset.currency === "Gold (Grams)") {
        holdingsText = `${asset.holdings.toLocaleString(undefined, {maximumFractionDigits: 3})} g (Market 21k - 30 EGP/g)`;
      }

      tbodyHtml += `
        <tr>
          <td class="asset-name">
            <div class="asset-marker" style="background-color: ${asset.color || '#22c55e'};"></div>
            <div>
              <div style="font-weight: 700; color: var(--text-primary);">${asset.name}</div>
              <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-top: 0.1rem; line-height: 1.1;">${asset.category}</div>
            </div>
          </td>
          <td class="asset-holdings">${holdingsText}</td>
          <td class="text-right font-medium text-primary">$${usd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
          <td class="text-right font-medium text-secondary">$${aud.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} AUD</td>
          <td class="text-right font-medium text-secondary">${egp.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} EGP</td>
          <td class="text-center">
            <button class="btn-icon edit-asset-item-btn" data-asset-id="${asset.id}" title="Edit Asset">✏️</button>
          </td>
        </tr>
      `;
    });

    // Add Upcoming Income (system managed)
    const { usd: upUsd, aud: upAud, egp: upEgp } = getAssetValuations(State.upcomingIncome, "USD");
    totalNetWorthUsd += upUsd;
    totalNetWorthAud += upAud;
    totalNetWorthEgp += upEgp;

    tbodyHtml += `
      <tr>
        <td class="asset-name">
          <div class="asset-marker upcoming" style="background-color: #a1a1aa;"></div>
          <div>
            <div style="font-weight: 700; color: var(--text-primary);">Upcoming Income</div>
            <div style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase; margin-top: 0.1rem; line-height: 1.1;">System Managed</div>
          </div>
        </td>
        <td class="asset-holdings">$${State.upcomingIncome.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
        <td class="text-right font-medium text-primary">$${upUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
        <td class="text-right font-medium text-secondary">$${upAud.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} AUD</td>
        <td class="text-right font-medium text-secondary">${upEgp.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} EGP</td>
        <td class="text-center">-</td>
      </tr>
    `;

    // Add Net Worth Summary Row
    tbodyHtml += `
      <tr class="net-worth-row">
        <td class="asset-name font-bold">Total Net Worth</td>
        <td class="asset-holdings">-</td>
        <td class="text-right font-extrabold value-highlight-usd">$${totalNetWorthUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
        <td class="text-right font-extrabold value-highlight-aud">$${totalNetWorthAud.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} AUD</td>
        <td class="text-right font-extrabold value-highlight-egp">${totalNetWorthEgp.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} EGP</td>
        <td class="text-center">-</td>
      </tr>
    `;

    tbody.innerHTML = tbodyHtml;

    // Attach click listeners to edit buttons
    tbody.querySelectorAll(".edit-asset-item-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-asset-id");
        const asset = State.assets.find(a => a.id === id);
        if (asset) {
          openAssetModal(asset);
        }
      });
    });
  }

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
  const usdAudArrow = getTrendArrowHTML(State.usdAudTrend);
  const gold24kArrow = getTrendArrowHTML(State.gold24kTrend);
  const gold21kArrow = getTrendArrowHTML(State.gold21kTrend);

  // --- 1. Update Rates Bar & Sync Timestamps ---
  document.getElementById("rate-usd-egp").innerHTML = `${usdEgpRate.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 4})} EGP${usdEgpArrow}`;
  
  const rateUsdAudEl = document.getElementById("rate-usd-aud");
  if (rateUsdAudEl) {
    rateUsdAudEl.innerHTML = `${usdAudRate.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 4})} AUD${usdAudArrow}`;
  }

  // Display Egyptian gold rates in EGP in the header
  document.getElementById("rate-gold-24k").innerHTML = `${gold24kEgpPerGram.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} EGP${gold24kArrow}`;
  document.getElementById("rate-gold-21k").innerHTML = `${gold21kEgpPerGram.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} EGP${gold21kArrow}`;
  document.getElementById("last-updated-time").textContent = State.lastFetchedTime || "Never";

  // --- 3. Update Financial Goals Tracking Panel ---
  const goalsContainer = document.getElementById("goals-list-container");
  if (goalsContainer) {
    ensureZakatGoal();
    goalsContainer.innerHTML = "";
    
    if (!State.goals || State.goals.length === 0) {
      goalsContainer.innerHTML = `<div class="empty-state">No financial goals set. Click ➕ to add one.</div>`;
    } else {
      State.goals.forEach(goal => {
        let currentVal = 0;
        let targetVal = goal.target;
        let remainingVal = 0;
        let percent = 0;
        let currentText = "";
        let targetText = "";
        let remainingText = "";
        let gradientClass = "usd-gradient";
        let borderClass = "goal-border-usd";
        
        if (goal.currency === "Gold") {
          currentVal = gold24kEgpPerGram > 0 ? (totalNetWorthEgp / gold24kEgpPerGram) : 0;
          remainingVal = targetVal - currentVal;
          percent = targetVal > 0 ? (currentVal / targetVal) * 100 : 0;
          
          gradientClass = "gold-gradient";
          borderClass = "goal-border-gold";
          
          targetText = `Target: ${targetVal.toLocaleString(undefined, {maximumFractionDigits: 2})} g (24k Gold)`;
          currentText = `Net Worth: ${currentVal.toLocaleString(undefined, {maximumFractionDigits: 2})} g`;
          
          if (currentVal >= targetVal) {
            remainingText = "Threshold Met (Zakat Due) ✓";
          } else {
            remainingText = `Remaining: ${remainingVal.toLocaleString(undefined, {maximumFractionDigits: 2})} g`;
          }
        } else if (goal.currency === "USD") {
          currentVal = totalNetWorthUsd;
          remainingVal = targetVal - currentVal;
          percent = targetVal > 0 ? (currentVal / targetVal) * 100 : 0;
          
          gradientClass = "usd-gradient";
          borderClass = "goal-border-usd";
          
          targetText = `Target: $${targetVal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} USD`;
          currentText = `Net Worth: $${currentVal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} USD`;
          
          if (currentVal >= targetVal) {
            remainingText = "Goal Reached ✓";
          } else {
            remainingText = `Remaining: $${remainingVal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} USD`;
          }
        } else if (goal.currency === "AUD") {
          currentVal = totalNetWorthUsd * usdAudRate;
          remainingVal = targetVal - currentVal;
          percent = targetVal > 0 ? (currentVal / targetVal) * 100 : 0;
          
          gradientClass = "aud-gradient";
          borderClass = "goal-border-aud";
          
          targetText = `Target: $${targetVal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} AUD`;
          currentText = `Net Worth: $${currentVal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} AUD`;
          
          if (currentVal >= targetVal) {
            remainingText = "Goal Reached ✓";
          } else {
            remainingText = `Remaining: $${remainingVal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} AUD`;
          }
        } else if (goal.currency === "EGP") {
          currentVal = totalNetWorthEgp;
          remainingVal = targetVal - currentVal;
          percent = targetVal > 0 ? (currentVal / targetVal) * 100 : 0;
          
          gradientClass = "egp-gradient";
          borderClass = "goal-border-egp";
          
          targetText = `Target: ${targetVal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} EGP`;
          currentText = `Net Worth: ${currentVal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} EGP`;
          
          if (currentVal >= targetVal) {
            remainingText = "Goal Reached ✓";
          } else {
            remainingText = `Remaining: ${remainingVal.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} EGP`;
          }
        }
        
        const goalItem = document.createElement("div");
        goalItem.className = `goal-item ${borderClass}`;
        goalItem.style.position = "relative";
        goalItem.style.transition = "transform var(--transition-fast), border-color var(--transition-fast)";
        
        // Add hover micro-interaction
        goalItem.addEventListener("mouseenter", () => {
          goalItem.style.transform = "translateY(-2px)";
        });
        goalItem.addEventListener("mouseleave", () => {
          goalItem.style.transform = "none";
        });
 
        const isMet = currentVal >= targetVal;
        
        goalItem.innerHTML = `
          <div class="goal-header" style="margin-bottom: 0.75rem;">
            <div class="goal-info">
              <h3 style="display: flex; align-items: center; gap: 0.4rem; font-size: 0.9rem;">
                <span style="font-size: 1.2rem; line-height: 1;">${goal.emoji || '🎯'}</span>
                ${goal.name}
              </h3>
              <span class="goal-target-desc" style="font-size: 0.72rem; color: var(--text-muted); font-weight: 500;">${targetText}</span>
            </div>
            <div style="display: flex; gap: 0.5rem; align-items: center;">
              <span class="goal-percent" style="font-size: 1.1rem; font-weight: 800;">${percent.toFixed(1)}%</span>
              ${goal.id !== "goal_zakat" ? `<button class="btn-icon edit-goal-item-btn" data-goal-id="${goal.id}" title="Edit Goal" style="width: 24px; height: 24px; padding: 0; display: inline-flex; align-items: center; justify-content: center; font-size: 0.7rem;">✏️</button>` : ''}
            </div>
          </div>
          
          <div class="progress-bar-track" style="height: 8px; background: var(--track-bg); border-radius: 9999px; overflow: hidden; margin-bottom: 0.75rem;">
            <div class="progress-bar-fill ${gradientClass}" style="width: ${Math.min(100, percent)}%; height: 100%; border-radius: 9999px;"></div>
          </div>
          
          <div class="goal-footer" style="display: flex; justify-content: space-between; align-items: center; font-size: 0.72rem; font-weight: 500;">
             <span class="goal-current-val" style="color: var(--text-secondary);">${currentText}</span>
             <span class="goal-remaining ${isMet ? 'met' : ''}" style="${isMet ? 'color: var(--color-savings); font-weight: 700;' : 'color: var(--text-muted);'}">${remainingText}</span>
          </div>
        `;
        
        // Attach click handler for edit button
        const editBtn = goalItem.querySelector(".edit-goal-item-btn");
        if (editBtn) {
          editBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            openGoalModal(goal);
          });
        }
        
        goalsContainer.appendChild(goalItem);
      });
    }
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
        
        const isNeg = tx.amountUsd < 0;
        const sign = isNeg ? "-" : "+";
        const absUsd = Math.abs(tx.amountUsd).toLocaleString(undefined, {minimumFractionDigits: 2});
        const absEgp = Math.abs(tx.amountEgp).toLocaleString(undefined, {minimumFractionDigits: 2});
        const descHtml = tx.description ? `<span class="history-desc" style="display: block; font-size: 0.72rem; color: var(--text-muted); margin-top: 0.1rem; font-weight: 500;">${tx.description}</span>` : '';
        
        historyItem.innerHTML = `
          <div class="history-details">
            <span class="history-amount-title">${sign}$${absUsd} USD / ${sign}${absEgp} EGP</span>
            ${descHtml}
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
  renderWealthChart();
 
  // Calculate and monitor Zakat streak based on current net worth
  checkZakatStreak(totalNetWorthEgp, gold24kEgpPerGram, totalNetWorthUsd, totalNetWorthAud);

  // Reset the inputs preview fields to clean defaults
  updateTransactionPreview();
}

/**
 * Initializes or dynamically updates the Chart.js donut chart segmenting
 * Cash Savings, Gold Savings (21k), and Upcoming Income.
 */
function renderWealthChart() {
  const ctx = document.getElementById('wealth-donut-chart');
  if (!ctx) return;

  const slices = [];
  
  // 1. Slices from dynamic assets
  State.assets.forEach(asset => {
    if ((asset.id === "paypal" || asset.name.toLowerCase() === "paypal") && asset.holdings === 0) {
      return;
    }
    const { usd } = getAssetValuations(asset.holdings, asset.currency);
    slices.push({
      name: asset.name,
      value: usd,
      color: asset.color || "#22c55e"
    });
  });
  
  // 2. Slice from upcoming income
  const { usd: upUsd } = getAssetValuations(State.upcomingIncome, "USD");
  slices.push({
    name: "Upcoming Income",
    value: upUsd,
    color: "#a1a1aa"
  });

  // Calculate total and prepare data lists
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const dataValues = total > 0 ? slices.map(s => s.value) : [0];
  const labels = total > 0 ? slices.map(s => s.name) : ["No holdings"];
  const bgColors = total > 0 ? slices.map(s => s.color) : ["#27272a"];

  const isLight = document.documentElement.classList.contains('light-theme');
  const textColor = isLight ? '#09090b' : '#ffffff';
  
  // Custom font styling matching Outfit
  const fontConfig = {
    family: "'Outfit', sans-serif",
    size: 11,
    weight: '500'
  };

  const data = {
    labels: labels,
    datasets: [{
      data: dataValues,
      backgroundColor: bgColors,
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
      maintainAspectRatio: true,
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
    wealthChart.data.labels = labels;
    wealthChart.data.datasets[0].data = dataValues;
    wealthChart.data.datasets[0].backgroundColor = bgColors;
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
  } else if (activeInputMethod === "hourly") {
    const hours = parseFloat(document.getElementById("hourly-hours").value) || 0;
    const minutes = parseFloat(document.getElementById("hourly-minutes").value) || 0;
    const rate = parseFloat(document.getElementById("hourly-rate").value) || 0;
    const roundedRate = Math.round(rate * 100) / 100;
    amountUsd = (hours + minutes / 60) * roundedRate;
    amountUsd = Math.round(amountUsd * 100) / 100;
  } else if (activeInputMethod === "paypal") {
    amountUsd = parseFloat(document.getElementById("paypal-transfer-amount").value) || 0;
  }
  const currentUsdEgp = State.cachedUsdEgp;

  // Real-time EGP conversion output
  const equivalentEgp = amountUsd * currentUsdEgp;
  previewEgp.textContent = `${equivalentEgp.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} EGP`;

  // Before / After upcoming income simulation
  const beforeIncome = State.upcomingIncome;
  const afterIncome = activeInputMethod === "paypal" ? beforeIncome - amountUsd : beforeIncome + amountUsd;

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

// --- DYNAMIC ASSETS MODAL HELPERS ---
function openAssetModal(asset = null) {
  const modal = document.getElementById("asset-modal");
  const title = document.getElementById("asset-modal-title");
  const idInput = document.getElementById("asset-id-input");
  const nameInput = document.getElementById("asset-name-input");
  const categoryInput = document.getElementById("asset-category-input");
  const currencySelect = document.getElementById("asset-currency-select");
  const holdingsInput = document.getElementById("asset-holdings-input");
  const deleteBtn = document.getElementById("delete-asset-btn");
  const colorPicker = document.getElementById("asset-color-picker");

  if (!modal) return;

  // Reset active color dots class
  document.querySelectorAll(".color-dot-option").forEach(dot => {
    dot.classList.remove("active");
  });

  if (asset) {
    // Edit Mode
    title.textContent = "Edit Financial Asset";
    idInput.value = asset.id;
    nameInput.value = asset.name;
    categoryInput.value = asset.category;
    currencySelect.value = asset.currency;
    holdingsInput.value = asset.holdings;
    colorPicker.value = asset.color || "#22c55e";
    
    // Highlight matching dot option if active
    const matchingDot = document.querySelector(`.color-dot-option[data-color="${asset.color}"]`);
    if (matchingDot) {
      matchingDot.classList.add("active");
    }

    if (deleteBtn) deleteBtn.style.display = "block";
  } else {
    // Add Mode
    title.textContent = "Add Financial Asset";
    idInput.value = "";
    nameInput.value = "";
    categoryInput.value = "";
    currencySelect.value = "USD";
    holdingsInput.value = "";
    colorPicker.value = "#22c55e";

    // Highlight green by default
    const greenDot = document.querySelector(`.color-dot-option[data-color="#22c55e"]`);
    if (greenDot) {
      greenDot.classList.add("active");
    }

    if (deleteBtn) deleteBtn.style.display = "none";
  }

  modal.style.display = "flex";
  setTimeout(() => modal.classList.add("active"), 10);
}

function hideAssetModal() {
  const modal = document.getElementById("asset-modal");
  if (modal) {
    modal.classList.remove("active");
    setTimeout(() => modal.style.display = "none", 300);
  }
}

// --- DYNAMIC GOALS MODAL HELPERS ---
function openGoalModal(goal = null) {
  const modal = document.getElementById("goal-modal");
  const title = document.getElementById("goal-modal-title");
  const idInput = document.getElementById("goal-id-input");
  const nameInput = document.getElementById("goal-name-input");
  const emojiInput = document.getElementById("goal-emoji-input");
  const currencySelect = document.getElementById("goal-currency-select");
  const targetInput = document.getElementById("goal-target-input");
  const deleteBtn = document.getElementById("delete-goal-btn");

  if (!modal) return;

  if (goal) {
    // Edit Mode
    title.textContent = "Edit Financial Goal";
    idInput.value = goal.id;
    nameInput.value = goal.name;
    emojiInput.value = goal.emoji || "🎯";
    currencySelect.value = goal.currency;
    targetInput.value = goal.target;
    if (deleteBtn) deleteBtn.style.display = "block";
  } else {
    // Add Mode
    title.textContent = "Add Financial Goal";
    idInput.value = "";
    nameInput.value = "";
    emojiInput.value = "🎯";
    currencySelect.value = "USD";
    targetInput.value = "";
    if (deleteBtn) deleteBtn.style.display = "none";
  }

  modal.style.display = "flex";
  setTimeout(() => modal.classList.add("active"), 10);
}

function hideGoalModal() {
  const modal = document.getElementById("goal-modal");
  if (modal) {
    modal.classList.remove("active");
    setTimeout(() => modal.style.display = "none", 300);
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
        State.assets = [
          { id: 'savings', name: 'Cash Savings', category: 'Cash Savings', holdings: cash, currency: 'USD', color: '#22c55e' },
          { id: 'gold', name: 'Gold Savings (21k)', category: 'Gold Savings', holdings: gold, currency: 'Gold (Grams)', color: '#eab308' }
        ];
        State.goldPremium = isNaN(premium) ? 2.5 : premium;
        State.upcomingIncome = 0;
        State.transactions = [];
        State.goals = getDefaultGoals();
        State.cachedUsdAud = 1.50;
        State.usdAudTrend = "neutral";
        State.usdEgpTrend = "neutral";
        State.gold24kTrend = "neutral";
        State.gold21kTrend = "neutral";
        State.lastResetMonth = "";
        State.resetPending = false;
        State.resetRolledIncome = 0;
        State.zakatConsecutiveDays = 0;
        State.lastZakatCheckDate = "";
        State.zakatSavedDueUsd = 0;
        State.zakatSavedDueEgp = 0;
        State.zakatSavedDueAud = 0;
        
        // Save syncCode to localStorage and establish connection
        localStorage.setItem("supabase_sync_code", syncCode);
        supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
        isCloudSyncActive = true;
        isInitialLoadComplete = true;
        
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

  // --- Dynamic Assets Modal Actions ---
  const addAssetBtn = document.getElementById("add-asset-btn");
  const cancelAssetBtn = document.getElementById("cancel-asset-btn");
  const closeAssetModalBtn = document.getElementById("close-asset-modal");
  const deleteAssetBtn = document.getElementById("delete-asset-btn");
  const assetForm = document.getElementById("asset-form");
  const categorySuggestionsContainer = document.getElementById("category-suggestions-container");
  const colorPalette = document.getElementById("color-palette");
  const colorPicker = document.getElementById("asset-color-picker");

  if (addAssetBtn) {
    addAssetBtn.addEventListener("click", () => {
      openAssetModal();
    });
  }

  if (cancelAssetBtn) cancelAssetBtn.addEventListener("click", hideAssetModal);
  if (closeAssetModalBtn) closeAssetModalBtn.addEventListener("click", hideAssetModal);

  if (categorySuggestionsContainer) {
    categorySuggestionsContainer.addEventListener("click", (e) => {
      if (e.target.classList.contains("category-suggestion")) {
        const categoryInput = document.getElementById("asset-category-input");
        if (categoryInput) {
          categoryInput.value = e.target.textContent.trim();
        }
      }
    });
  }

  if (colorPalette) {
    colorPalette.addEventListener("click", (e) => {
      if (e.target.classList.contains("color-dot-option")) {
        // Remove active class from other dots
        colorPalette.querySelectorAll(".color-dot-option").forEach(dot => dot.classList.remove("active"));
        // Add active class to clicked dot
        e.target.classList.add("active");
        // Update color picker
        const selectedColor = e.target.getAttribute("data-color");
        if (colorPicker) {
          colorPicker.value = selectedColor;
        }
      }
    });
  }

  if (colorPicker) {
    colorPicker.addEventListener("input", (e) => {
      // Find matching color dot if any
      const hex = e.target.value.toLowerCase();
      if (colorPalette) {
        colorPalette.querySelectorAll(".color-dot-option").forEach(dot => {
          const dotColor = dot.getAttribute("data-color").toLowerCase();
          if (dotColor === hex) {
            dot.classList.add("active");
          } else {
            dot.classList.remove("active");
          }
        });
      }
    });
  }

  if (deleteAssetBtn) {
    deleteAssetBtn.addEventListener("click", () => {
      const id = document.getElementById("asset-id-input").value;
      if (id) {
        const asset = State.assets.find(a => a.id === id);
        const assetName = asset ? asset.name : "this asset";
        if (confirm(`Are you sure you want to delete "${assetName}"?`)) {
          State.assets = State.assets.filter(a => a.id !== id);
          State.save();
          hideAssetModal();
          updateDashboardUI();
        }
      }
    });
  }

  if (assetForm) {
    assetForm.addEventListener("submit", (e) => {
      e.preventDefault();
      
      const id = document.getElementById("asset-id-input").value;
      const name = document.getElementById("asset-name-input").value.trim();
      const category = document.getElementById("asset-category-input").value.trim();
      const currency = document.getElementById("asset-currency-select").value;
      const holdings = parseFloat(document.getElementById("asset-holdings-input").value);
      const color = colorPicker ? colorPicker.value : "#22c55e";

      if (name && category && currency && !isNaN(holdings) && holdings >= 0) {
        if (id) {
          // Edit mode
          const idx = State.assets.findIndex(a => a.id === id);
          if (idx !== -1) {
            State.assets[idx] = { id, name, category, currency, holdings, color };
          }
        } else {
          // Add mode
          const newAsset = {
            id: "asset_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
            name,
            category,
            currency,
            holdings,
            color
          };
          State.assets.push(newAsset);
        }
        
        State.save();
        hideAssetModal();
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
  const tabPaypal = document.getElementById("tab-paypal");
  const blockFlat = document.getElementById("input-block-flat");
  const blockHourly = document.getElementById("input-block-hourly");
  const blockPaypal = document.getElementById("input-block-paypal");
  const inputHours = document.getElementById("hourly-hours");
  const inputMinutes = document.getElementById("hourly-minutes");
  const inputRate = document.getElementById("hourly-rate");
  const inputPaypalAmount = document.getElementById("paypal-transfer-amount");
  const addTxBtn = document.getElementById("add-transaction-btn");

  if (tabFlat && tabHourly && tabPaypal && blockFlat && blockHourly && blockPaypal) {
    tabFlat.addEventListener("click", () => {
      activeInputMethod = "flat";
      tabFlat.classList.add("active");
      tabHourly.classList.remove("active");
      tabPaypal.classList.remove("active");
      blockFlat.style.display = "block";
      blockHourly.style.display = "none";
      blockPaypal.style.display = "none";

      txAmountInput.setAttribute("required", "");
      if (inputHours) inputHours.removeAttribute("required");
      if (inputRate) inputRate.removeAttribute("required");
      if (inputPaypalAmount) inputPaypalAmount.removeAttribute("required");

      if (addTxBtn) {
        addTxBtn.textContent = "Add Transaction";
        addTxBtn.className = "btn btn-success";
      }

      updateTransactionPreview();
    });

    tabHourly.addEventListener("click", () => {
      activeInputMethod = "hourly";
      tabHourly.classList.add("active");
      tabFlat.classList.remove("active");
      tabPaypal.classList.remove("active");
      blockHourly.style.display = "block";
      blockFlat.style.display = "none";
      blockPaypal.style.display = "none";

      txAmountInput.removeAttribute("required");
      if (inputHours) inputHours.removeAttribute("required");
      if (inputRate) inputRate.removeAttribute("required");
      if (inputPaypalAmount) inputPaypalAmount.removeAttribute("required");

      if (addTxBtn) {
        addTxBtn.textContent = "Add Transaction";
        addTxBtn.className = "btn btn-success";
      }

      updateTransactionPreview();
    });

    tabPaypal.addEventListener("click", () => {
      activeInputMethod = "paypal";
      tabPaypal.classList.add("active");
      tabFlat.classList.remove("active");
      tabHourly.classList.remove("active");
      blockPaypal.style.display = "block";
      blockFlat.style.display = "none";
      blockHourly.style.display = "none";

      txAmountInput.removeAttribute("required");
      if (inputHours) inputHours.removeAttribute("required");
      if (inputRate) inputRate.removeAttribute("required");
      if (inputPaypalAmount) inputPaypalAmount.setAttribute("required", "");

      if (addTxBtn) {
        addTxBtn.textContent = "Transfer to PayPal";
        addTxBtn.className = "btn btn-primary";
      }

      updateTransactionPreview();
    });
  }

  if (txForm) {
    txForm.addEventListener("submit", (e) => {
      e.preventDefault();
      
      let amountUsd = 0;
      if (activeInputMethod === "flat") {
        amountUsd = parseFloat(txAmountInput.value);
      } else if (activeInputMethod === "hourly") {
        const hours = parseFloat(inputHours.value) || 0;
        const minutes = parseFloat(inputMinutes.value) || 0;
        const rate = parseFloat(inputRate.value) || 0;
        const roundedRate = Math.round(rate * 100) / 100;
        amountUsd = (hours + minutes / 60) * roundedRate;
        amountUsd = Math.round(amountUsd * 100) / 100;
      } else if (activeInputMethod === "paypal") {
        amountUsd = parseFloat(inputPaypalAmount.value);
      }

      if (!isNaN(amountUsd) && amountUsd > 0) {
        const usdEgpRate = State.cachedUsdEgp;
        const amountEgp = amountUsd * usdEgpRate;
        const beforeIncome = State.upcomingIncome;
        
        if (activeInputMethod === "paypal") {
          // Check if we have enough upcoming income
          if (State.upcomingIncome < amountUsd) {
            alert("Insufficient funds in Upcoming Income to perform this transfer.");
            return;
          }
          
          // Deduct from upcoming income
          State.upcomingIncome -= amountUsd;
          
          // Add to PayPal
          let paypalAsset = State.assets.find(a => a.id === "paypal");
          if (!paypalAsset) {
            paypalAsset = {
              id: "paypal",
              name: "PayPal",
              category: "Digital Wallet",
              holdings: 0,
              currency: "USD",
              color: "#3b82f6"
            };
            State.assets.push(paypalAsset);
          }
          paypalAsset.holdings += amountUsd;
          
          // Log transaction as negative (representing a transfer/payment)
          const newTx = {
            id: "tx_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
            amountUsd: -amountUsd,
            amountEgp: -amountEgp,
            rateUsdEgp: usdEgpRate,
            timestamp: Date.now(),
            beforeIncome: beforeIncome,
            afterIncome: beforeIncome - amountUsd,
            description: "Transfer to PayPal"
          };
          State.transactions.push(newTx);
          State.save();
          
          if (inputPaypalAmount) inputPaypalAmount.value = "";
          updateDashboardUI();
        } else {
          // flat or hourly
          const afterIncome = beforeIncome + amountUsd;
          const newTx = {
            id: "tx_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
            amountUsd: amountUsd,
            amountEgp: amountEgp,
            rateUsdEgp: usdEgpRate,
            timestamp: Date.now(),
            beforeIncome: beforeIncome,
            afterIncome: afterIncome
          };
          State.transactions.push(newTx);
          State.upcomingIncome = afterIncome;
          State.save();
          
          txAmountInput.value = "";
          if (inputHours) inputHours.value = "";
          if (inputMinutes) inputMinutes.value = "";
          if (inputRate) inputRate.value = "";
          updateDashboardUI();
        }
      }
    });

    if (txAmountInput) {
      txAmountInput.addEventListener("input", updateTransactionPreview);
    }
    if (inputHours) inputHours.addEventListener("input", updateTransactionPreview);
    if (inputMinutes) inputMinutes.addEventListener("input", updateTransactionPreview);
    if (inputPaypalAmount) inputPaypalAmount.addEventListener("input", updateTransactionPreview);
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
        localStorage.removeItem("aurafinance_local_state");
        disconnectSupabase();
        hideSyncModal();
        
        // Reset local state to blank
        State.assets = [];
        State.goldPremium = 2.5;
        State.upcomingIncome = 0;
        State.transactions = [];
        State.usdEgpTrend = "neutral";
        State.gold24kTrend = "neutral";
        State.gold21kTrend = "neutral";
        State.lastResetMonth = "";
        State.resetPending = false;
        State.resetRolledIncome = 0;
        
        updateDashboardUI(true);
        
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

  // --- Dynamic Goals Modal Event Listeners ---
  const addGoalBtn = document.getElementById("add-goal-btn");
  const cancelGoalBtn = document.getElementById("cancel-goal-btn");
  const closeGoalModalBtn = document.getElementById("close-goal-modal");
  const deleteGoalBtn = document.getElementById("delete-goal-btn");
  const goalForm = document.getElementById("goal-form");
  const emojiSuggestionsContainer = document.getElementById("emoji-suggestions-container");

  if (addGoalBtn) {
    addGoalBtn.addEventListener("click", () => {
      openGoalModal();
    });
  }

  if (cancelGoalBtn) cancelGoalBtn.addEventListener("click", hideGoalModal);
  if (closeGoalModalBtn) closeGoalModalBtn.addEventListener("click", hideGoalModal);

  if (emojiSuggestionsContainer) {
    emojiSuggestionsContainer.addEventListener("click", (e) => {
      if (e.target.classList.contains("emoji-suggestion")) {
        const emojiInput = document.getElementById("goal-emoji-input");
        if (emojiInput) {
          emojiInput.value = e.target.textContent.trim();
        }
      }
    });
  }

  if (deleteGoalBtn) {
    deleteGoalBtn.addEventListener("click", () => {
      const id = document.getElementById("goal-id-input").value;
      if (id === "goal_zakat") {
        alert("The Zakat Threshold goal is fixed and cannot be deleted.");
        return;
      }
      if (id && confirm("Are you sure you want to delete this goal?")) {
        State.goals = State.goals.filter(g => g.id !== id);
        State.save();
        hideGoalModal();
        updateDashboardUI();
      }
    });
  }

  if (goalForm) {
    goalForm.addEventListener("submit", (e) => {
      e.preventDefault();
      
      const id = document.getElementById("goal-id-input").value;
      const name = document.getElementById("goal-name-input").value.trim();
      const emoji = document.getElementById("goal-emoji-input").value.trim();
      const currency = document.getElementById("goal-currency-select").value;
      const target = parseFloat(document.getElementById("goal-target-input").value);

      if (name && emoji && currency && !isNaN(target) && target > 0) {
        if (id) {
          if (id === "goal_zakat") {
            hideGoalModal();
            return;
          }
          // Edit goal
          const goalIndex = State.goals.findIndex(g => g.id === id);
          if (goalIndex !== -1) {
            State.goals[goalIndex] = { id, name, emoji, currency, target };
          }
        } else {
          // Add new goal
          const newGoal = {
            id: "goal_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
            name,
            emoji,
            currency,
            target
          };
          State.goals.push(newGoal);
        }
        
        State.save();
        hideGoalModal();
        updateDashboardUI();
      }
    });
  }
}

// --- APP LOADER SCREEN CONTROLS ---
function showLoader(message = "Connecting to secure vault...") {
  const loaderOverlay = document.getElementById("app-loader-overlay");
  const statusText = document.getElementById("loader-status-text");
  if (loaderOverlay) {
    if (statusText) statusText.textContent = message;
    loaderOverlay.style.display = "flex";
    setTimeout(() => loaderOverlay.classList.add("active"), 10);
  }
}

function hideLoader() {
  const loaderOverlay = document.getElementById("app-loader-overlay");
  if (loaderOverlay) {
    loaderOverlay.classList.remove("active");
    setTimeout(() => loaderOverlay.style.display = "none", 300);
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
  isInitialLoadComplete = false;
  
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
    const payload = State.getPayload();
    payload.updated_at = new Date().toISOString();
    
    // Mirror locally to keep timestamps and data aligned
    localStorage.setItem("aurafinance_local_state", JSON.stringify(payload));
    
    const { error } = await supabase
      .from('dashboards')
      .upsert({ id: syncCode, data: payload, updated_at: payload.updated_at });
      
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
      isCloudSyncActive = true;
      isInitialLoadComplete = true;
      hideLoader();
      if (syncBtn) {
        syncBtn.className = "refresh-btn cloud-sync-btn offline";
        syncBtn.title = `Offline (loaded locally). Supabase Error: ${error.message}`;
      }
    } else if (dbData && dbData.data) {
      console.log("Initial state pulled from Supabase:", dbData.data);
      const cloudData = dbData.data;
      const localStateStr = localStorage.getItem("aurafinance_local_state");
      let useCloud = true;

      if (localStateStr) {
        try {
          const localState = JSON.parse(localStateStr);
          if (localState.updated_at && cloudData.updated_at) {
            const localTime = new Date(localState.updated_at).getTime();
            const cloudTime = new Date(cloudData.updated_at).getTime();
            if (localTime > cloudTime) {
              // Local state is newer, push to cloud
              console.log("Local state is newer than cloud. Syncing local state to cloud...");
              useCloud = false;
              isInitialLoadComplete = true;
              syncStateToSupabase();
            }
          }
        } catch (e) {
          console.warn("Failed to parse local state during comparison:", e);
        }
      }

      if (useCloud) {
        handleIncomingCloudState(cloudData);
        isInitialLoadComplete = true;
        // Cache the cloud data locally
        localStorage.setItem("aurafinance_local_state", JSON.stringify(cloudData));
      }
      
      runClockAndResetCheck(); // Run system clock checks now that state is loaded
      fetchLiveRates(); // Pull fresh rates once connected and loaded
      hideLoader();
    } else {
      console.log("No cloud data found for code. Checking if we have local state to upload...");
      hideLoader();
      const localStateStr = localStorage.getItem("aurafinance_local_state");
      if (localStateStr) {
        console.log("Vault is empty in cloud, but has local state. Syncing local state to cloud...");
        isInitialLoadComplete = true;
        syncStateToSupabase();
        runClockAndResetCheck();
        fetchLiveRates();
      } else {
        showWizardStep2();
      }
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
              const localStateStr = localStorage.getItem("aurafinance_local_state");
              let useCloud = true;
              if (localStateStr && newData.updated_at) {
                try {
                  const localState = JSON.parse(localStateStr);
                  if (localState.updated_at) {
                    const localTime = new Date(localState.updated_at).getTime();
                    const cloudTime = new Date(newData.updated_at).getTime();
                    if (localTime > cloudTime) {
                      useCloud = false; // Keep newer local state
                    }
                  }
                } catch (e) {}
              }
              if (useCloud) {
                handleIncomingCloudState(newData);
                localStorage.setItem("aurafinance_local_state", JSON.stringify(newData));
              }
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
    isCloudSyncActive = true;
    isInitialLoadComplete = true;
    hideLoader();
    if (syncBtn) {
      syncBtn.className = "refresh-btn cloud-sync-btn offline";
      syncBtn.title = `Supabase Connection Error: ${err.message}`;
    }
  }
}

function getDefaultGoals() {
  return [
    {
      id: "goal_zakat",
      name: "Zakat Threshold",
      currency: "Gold",
      target: 85,
      emoji: "🕌"
    },
    {
      id: "goal_migration",
      name: "Migration Goal",
      currency: "AUD",
      target: 20000,
      emoji: "🇦🇺"
    }
  ];
}

function ensureZakatGoal() {
  if (!State.goals) {
    State.goals = [];
  }
  let zakatGoal = State.goals.find(g => g.id === "goal_zakat");
  if (!zakatGoal) {
    zakatGoal = {
      id: "goal_zakat",
      name: "Zakat Threshold",
      currency: "Gold",
      target: 85,
      emoji: "🕌"
    };
  } else {
    zakatGoal.name = "Zakat Threshold";
    zakatGoal.currency = "Gold";
    zakatGoal.target = 85;
    zakatGoal.emoji = "🕌";
  }
  State.goals = [zakatGoal, ...State.goals.filter(g => g.id !== "goal_zakat")];
}

function checkZakatStreak(totalNetWorthEgp, gold24kEgpPerGram, totalNetWorthUsd, totalNetWorthAud) {
  const currentVal = gold24kEgpPerGram > 0 ? (totalNetWorthEgp / gold24kEgpPerGram) : 0;
  
  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  
  if (State.zakatConsecutiveDays === undefined) State.zakatConsecutiveDays = 0;
  if (State.lastZakatCheckDate === undefined) State.lastZakatCheckDate = "";
  if (State.zakatSavedDueUsd === undefined) State.zakatSavedDueUsd = 0;
  if (State.zakatSavedDueEgp === undefined) State.zakatSavedDueEgp = 0;
  if (State.zakatSavedDueAud === undefined) State.zakatSavedDueAud = 0;
  
  if (!State.lastZakatCheckDate) {
    if (currentVal >= 85) {
      State.zakatConsecutiveDays = 1;
      State.zakatSavedDueUsd = totalNetWorthUsd * 0.025;
      State.zakatSavedDueEgp = totalNetWorthEgp * 0.025;
      State.zakatSavedDueAud = totalNetWorthAud * 0.025;
    } else {
      State.zakatConsecutiveDays = 0;
      State.zakatSavedDueUsd = 0;
      State.zakatSavedDueEgp = 0;
      State.zakatSavedDueAud = 0;
    }
    State.lastZakatCheckDate = todayStr;
    State.save();
  } else if (State.lastZakatCheckDate !== todayStr) {
    const [lastYear, lastMonth, lastDay] = State.lastZakatCheckDate.split('-').map(Number);
    const [currYear, currMonth, currDay] = todayStr.split('-').map(Number);
    
    const lastDateObj = new Date(lastYear, lastMonth - 1, lastDay);
    const currDateObj = new Date(currYear, currMonth - 1, currDay);
    
    const diffTime = currDateObj - lastDateObj;
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays > 0) {
      if (currentVal >= 85) {
        if (State.zakatConsecutiveDays > 0) {
          State.zakatConsecutiveDays += diffDays;
        } else {
          State.zakatConsecutiveDays = 1;
          State.zakatSavedDueUsd = totalNetWorthUsd * 0.025;
          State.zakatSavedDueEgp = totalNetWorthEgp * 0.025;
          State.zakatSavedDueAud = totalNetWorthAud * 0.025;
        }
      } else {
        State.zakatConsecutiveDays = 0;
        State.zakatSavedDueUsd = 0;
        State.zakatSavedDueEgp = 0;
        State.zakatSavedDueAud = 0;
      }
      State.lastZakatCheckDate = todayStr;
      State.save();
    }
  } else {
    // If the check date is today, and the user updates their net worth so it drops below the threshold,
    // reset the streak immediately. If it goes above and was 0, start it.
    if (currentVal < 85 && State.zakatConsecutiveDays > 0) {
      State.zakatConsecutiveDays = 0;
      State.zakatSavedDueUsd = 0;
      State.zakatSavedDueEgp = 0;
      State.zakatSavedDueAud = 0;
      State.save();
    } else if (currentVal >= 85 && State.zakatConsecutiveDays === 0) {
      State.zakatConsecutiveDays = 1;
      State.zakatSavedDueUsd = totalNetWorthUsd * 0.025;
      State.zakatSavedDueEgp = totalNetWorthEgp * 0.025;
      State.zakatSavedDueAud = totalNetWorthAud * 0.025;
      State.save();
    }
  }

  // Fallback: If streak is active but saved due values aren't initialized yet (version upgrade path)
  if (State.zakatConsecutiveDays > 0 && (!State.zakatSavedDueUsd || State.zakatSavedDueUsd <= 0)) {
    State.zakatSavedDueUsd = totalNetWorthUsd * 0.025;
    State.zakatSavedDueEgp = totalNetWorthEgp * 0.025;
    State.zakatSavedDueAud = totalNetWorthAud * 0.025;
    State.save();
  }

  // Render/toggle Zakat Due announcement
  const zakatBanner = document.getElementById("zakat-due-banner");
  if (zakatBanner) {
    if (State.zakatConsecutiveDays >= 354) {
      zakatBanner.style.display = "flex";
      
      const streakDaysEl = document.getElementById("zakat-streak-days");
      if (streakDaysEl) streakDaysEl.textContent = State.zakatConsecutiveDays;
      
      const dueUsd = State.zakatSavedDueUsd;
      const dueEgp = State.zakatSavedDueEgp;
      const dueAud = State.zakatSavedDueAud;
      
      const dueUsdEl = document.getElementById("zakat-due-amount-usd");
      const dueEgpEl = document.getElementById("zakat-due-amount-egp");
      
      if (dueUsdEl) {
        dueUsdEl.textContent = `$${dueUsd.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} USD`;
      }
      if (dueEgpEl) {
        dueEgpEl.textContent = `${dueEgp.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} EGP | $${dueAud.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} AUD`;
      }
    } else {
      zakatBanner.style.display = "none";
    }
  }
}


function handleIncomingCloudState(data) {
  isPreventingSyncLoop = true;
  
  if (data.assets !== undefined) {
    State.assets = data.assets;
  } else {
    // Migrate legacy data models
    State.assets = [];
    if (data.usdSavings !== undefined) State.usdSavings = Number(data.usdSavings);
    if (data.goldGrams !== undefined) State.goldGrams = Number(data.goldGrams);
  }
  if (data.goldPremium !== undefined) State.goldPremium = Number(data.goldPremium);
  if (data.upcomingIncome !== undefined) State.upcomingIncome = Number(data.upcomingIncome);
  if (data.transactions !== undefined) State.transactions = data.transactions;
  
  if (data.goals !== undefined) {
    State.goals = data.goals;
  } else {
    State.goals = getDefaultGoals();
  }
  
  if (data.cachedUsdAud !== undefined) State.cachedUsdAud = Number(data.cachedUsdAud);
  if (data.usdAudTrend !== undefined) State.usdAudTrend = data.usdAudTrend;
  
  if (data.cachedUsdEgp !== undefined) State.cachedUsdEgp = Number(data.cachedUsdEgp);
  if (data.cachedGold24kUsd !== undefined) State.cachedGold24kUsd = Number(data.cachedGold24kUsd);
  if (data.lastFetchedTime !== undefined) State.lastFetchedTime = data.lastFetchedTime;
  if (data.usdEgpTrend !== undefined) State.usdEgpTrend = data.usdEgpTrend;
  if (data.gold24kTrend !== undefined) State.gold24kTrend = data.gold24kTrend;
  if (data.gold21kTrend !== undefined) State.gold21kTrend = data.gold21kTrend;
  if (data.lastResetMonth !== undefined) State.lastResetMonth = data.lastResetMonth;
  if (data.resetPending !== undefined) State.resetPending = data.resetPending;
  if (data.resetRolledIncome !== undefined) State.resetRolledIncome = Number(data.resetRolledIncome);
  if (data.lastNsaveTransferMonth !== undefined) State.lastNsaveTransferMonth = data.lastNsaveTransferMonth;
  
  if (data.zakatConsecutiveDays !== undefined) {
    State.zakatConsecutiveDays = Number(data.zakatConsecutiveDays);
  } else {
    State.zakatConsecutiveDays = 0;
  }
  if (data.lastZakatCheckDate !== undefined) {
    State.lastZakatCheckDate = data.lastZakatCheckDate;
  } else {
    State.lastZakatCheckDate = "";
  }
  State.zakatSavedDueUsd = data.zakatSavedDueUsd !== undefined ? Number(data.zakatSavedDueUsd) : 0;
  State.zakatSavedDueEgp = data.zakatSavedDueEgp !== undefined ? Number(data.zakatSavedDueEgp) : 0;
  State.zakatSavedDueAud = data.zakatSavedDueAud !== undefined ? Number(data.zakatSavedDueAud) : 0;
  
  isInitialLoadComplete = true;
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

  // 0.15 Load from local storage mirror if available for instant startup UX
  const localStateStr = localStorage.getItem("aurafinance_local_state");
  if (localStateStr) {
    try {
      const localState = JSON.parse(localStateStr);
      handleIncomingCloudState(localState);
      isInitialLoadComplete = true;
    } catch (e) {
      console.warn("Failed to parse local state backup:", e);
    }
  }

  // 0.2 Initialize Supabase Cloud Sync Connection
  const syncCode = localStorage.getItem("supabase_sync_code");
  if (!syncCode) {
    showSyncCodePrompt();
  } else {
    showLoader("Connecting to secure vault...");
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

  // 5. Auto-update and sync cached rates and state to cloud every 2 hours (7200000 ms)
  setInterval(autoUpdateAndSync, 7200000);
});

async function autoUpdateAndSync() {
  console.log("Running periodic 2-hour auto-update and database sync...");
  await fetchLiveRates();
  State.save();
}
