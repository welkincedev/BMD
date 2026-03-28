import { 
    db, auth, provider,
    collection, doc, addDoc, getDoc, getDocs, setDoc, deleteDoc, 
    onSnapshot, query, where, orderBy, serverTimestamp, writeBatch,
    signInWithPopup, onAuthStateChanged, signOut
} from "./firebase.js";

// =====================
// USER IDENTITY & AUTH
// =====================
let userId = null;

window.login = async () => {
    try {
        await signInWithPopup(auth, provider);
    } catch (err) {
        console.error("Login failed:", err);
        alert("Login failed. Check console.");
    }
};

window.logout = async () => {
    try {
        await signOut(auth);
        location.reload(); 
    } catch (err) {
        console.error("Logout failed:", err);
    }
};

// =====================
// STATE
// =====================
let rides = [];
let petrols = [];
let expenses = [];
let settings = {
    savingPercent: 30,
    monthlyGoal: 8000,
    initialKM: 0
};

let isFirebaseReady = false;
let isSavingSettings = false;

const charts = {
    homeWeekly: null,
    mileage: null,
    expensePie: null,
    comparison: null
};

// 🗺 Page Detection
const getCurrentPage = () => {
    const path = window.location.pathname;
    if (path.endsWith('mileage.html')) return 'mileage';
    if (path.endsWith('expense.html')) return 'expense';
    if (path.endsWith('insights.html')) return 'insights';
    if (path.endsWith('settings.html')) return 'settings';
    return 'home'; // Default to index.html
};

// 🛠 Helpers
window.setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.innerText = val;
};
window.setHtml = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = val;
};

// UX Helpers
window.openRideModal = () => {
    const modal = document.getElementById('rideModal');
    if (!modal) return;
    
    // Auto-prefill Start KM with latest known odometer
    const startKMInput = document.getElementById('startKM');
    if (startKMInput) {
        startKMInput.value = getPreviousOdometer();
    }
    
    // Reset date to today
    const dateInput = document.getElementById('rideDate');
    if (dateInput) {
        dateInput.value = new Date().toLocaleDateString('sv');
    }

    modal.classList.add('active');
};

// Decimal Helpers
window.formatCurrency = (val) => "₹" + (parseFloat(val) || 0).toFixed(2);
window.formatNumber = (val, dec = 2) => (parseFloat(val) || 0).toFixed(dec);

window.getPreviousOdometer = () => {
    if (petrols.length === 0) {
        return parseFloat(settings.initialKM) || 0;
    }
    const sorted = [...petrols].sort((a,b) => parseFloat(a.km) - parseFloat(b.km));
    return parseFloat(sorted[sorted.length - 1].km) || 0;
};

// Safe Icon Creation
const safeCreateIcons = () => {
    try {
        if (window.lucide) {
            console.log("Lucide: Scanning icons...");
            window.lucide.createIcons();
        } else {
            console.warn("Lucide: Library not found in window.");
        }
    } catch (err) {
        console.warn("Lucide: Scan failed:", err);
    }
};

// =====================
// FIREBASE REAL-TIME SYNC
// =====================

async function initFirebase() {
    document.body.classList.add("loading");
    
    // Fail-safe: Remove loading screen after 3 seconds if it hangs
    setTimeout(() => {
        if (document.body.classList.contains("loading")) {
            console.warn("Initial sync timed out. Proceeding with available data.");
            document.body.classList.remove("loading");
            render();
        }
    }, 3000);

    if (!db) {
        console.warn("Firebase not initialized. Using LocalStorage fallback.");
        loadLocalData();
        document.body.classList.remove("loading");
        render();
        return;
    }

    try {
        isFirebaseReady = true;
        setupRealtimeListeners();
    } catch (err) {
        console.error("Firebase sync failed:", err);
        loadLocalData();
        document.body.classList.remove("loading");
        render();
    }
}

function setupRealtimeListeners() {
    let loadedCount = 0;
    const checkLoaded = () => {
        loadedCount++;
        if (loadedCount >= 4) {
            document.body.classList.remove("loading");
            render();
        }
    };

    const handleError = (type, err) => {
        console.error(`Sync error (${type}):`, err);
        checkLoaded(); 
    };

    // 1. Rides
    onSnapshot(query(collection(db, "users", userId, "rides"), orderBy("date", "desc")), (snap) => {
        rides = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (loadedCount < 4) checkLoaded(); else render();
    }, (err) => handleError("rides", err));

    // 2. Petrols
    onSnapshot(query(collection(db, "users", userId, "petrols"), orderBy("km", "asc")), (snap) => {
        petrols = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (loadedCount < 4) checkLoaded(); else render();
    }, (err) => handleError("petrols", err));

    // 3. Expenses
    onSnapshot(query(collection(db, "users", userId, "expenses"), orderBy("date", "desc")), (snap) => {
        expenses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (loadedCount < 4) checkLoaded(); else render();
    }, (err) => handleError("expenses", err));

    // 4. Settings
    onSnapshot(doc(db, "users", userId, "config", "settings"), (snap) => {
        if (isSavingSettings) {
            console.log("onSnapshot: Save in progress, skipping update.");
            return;
        }
        if (snap.exists()) {
            settings = snap.data();
        } else {
            console.log("No remote settings. Uploading defaults...");
            loadLocalData();
            uploadAllData(); 
        }
        if (loadedCount < 4) checkLoaded(); else render();
    }, (err) => handleError("settings", err));
}

function loadLocalData() {
    rides = JSON.parse(localStorage.getItem("bmd_rides")) || [];
    petrols = JSON.parse(localStorage.getItem("bmd_petrols")) || [];
    expenses = JSON.parse(localStorage.getItem("bmd_expenses")) || [];
    const localSet = JSON.parse(localStorage.getItem("bmd_settings"));
    if (localSet) settings = localSet;
}

async function uploadAllData() {
    if (!isFirebaseReady) return;
    const batch = writeBatch(db);
    
    // Upload settings
    const setRef = doc(db, "users", userId, "config", "settings");
    batch.set(setRef, settings);
    
    // Upload collection items
    rides.forEach(r => {
        const ref = doc(collection(db, "users", userId, "rides"));
        batch.set(ref, r);
    });
    
    petrols.forEach(p => {
        const ref = doc(collection(db, "users", userId, "petrols"));
        batch.set(ref, p);
    });

    expenses.forEach(e => {
        const ref = doc(collection(db, "users", userId, "expenses"));
        batch.set(ref, e);
    });

    try {
        await batch.commit();
        console.log("Initial data upload complete.");
    } catch (err) {
        console.error("Initial upload failed:", err);
    }
}

// =====================
// UI LOGIC
// =====================

window.switchTab = (tabId) => {
    // Legacy switchTab now redirects for multi-page
    const pageMap = {
        'home': 'index.html',
        'mileage-tab': 'mileage.html',
        'expenses-tab': 'expense.html',
        'insights-tab': 'insights.html',
        'settings': 'settings.html'
    };
    if (pageMap[tabId]) {
        window.location.href = pageMap[tabId];
    }
};

let renderTimeout = null;
function render() {
    if (renderTimeout) clearTimeout(renderTimeout);
    renderTimeout = setTimeout(() => {
        performRender();
        renderTimeout = null;
    }, 50);
}

function performRender() {
    console.log("--- Starting Render Cycle [Page: " + getCurrentPage() + "] ---");
    const safeRun = (name, fn) => {
        try {
            fn();
        } catch (err) {
            // Silently fail if elements are missing (expected in multi-page)
            console.debug(`Render Skip [${name}]: Element not on this page.`);
        }
    };

    const page = getCurrentPage();
    
    if (page === 'home') safeRun("Dashboard", updateDashboard);
    if (page === 'mileage') safeRun("PetrolUI", updatePetrolUI);
    if (page === 'expense') safeRun("ExpenseUI", updateExpenseUI);
    if (page === 'insights') safeRun("InsightsUI", updateInsightsUI);
    if (page === 'settings') safeRun("SettingsUI", updateSettingsUI);
    
    // Global components
    safeRun("Charts", initCharts);
    safeRun("Icons", safeCreateIcons);
    
    // Sync navbar active state
    document.querySelectorAll('.nav-item').forEach(nav => {
        nav.classList.remove('active');
        const href = nav.getAttribute('href');
        if (href && (window.location.pathname.endsWith(href) || (href === 'index.html' && page === 'home'))) {
            nav.classList.add('active');
        }
    });

    setTimeout(safeCreateIcons, 500);
}

function updateDashboard() {
    const totalEarn = rides.reduce((sum, r) => sum + (parseFloat(r.earnings) || 0), 0);
    const totalDist = rides.reduce((sum, r) => sum + ((parseFloat(r.endKM) || 0) - (parseFloat(r.startKM) || 0)), 0);
    const totalFuel = petrols.reduce((sum, p) => sum + (parseFloat(p.cost) || 0), 0);
    const totalExp = expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
    
    const netWorth = totalEarn - totalFuel - totalExp;
    setText('netWorth', formatCurrency(netWorth));

    setText('earn', formatCurrency(totalEarn));
    setText('distance', `${formatNumber(totalDist, 1)} km`);
    
    const avgKm = totalDist > 0 ? (totalEarn / totalDist) : 0;
    setText('avgKm', formatCurrency(avgKm));
    
    const latestMileage = petrols.length > 0 ? calculateMileage(petrols.length - 1) : 0;
    setText('mileage', `${formatNumber(latestMileage, 2)} km/l`);

    // Goal Progress (based on Net Worth)
    const currentProgress = (netWorth / (parseFloat(settings.monthlyGoal) || 8000)) * 100;
    const bar = document.getElementById('bar');
    if (bar) bar.style.width = Math.max(0, Math.min(currentProgress, 100)) + '%';
    setText('savingsText', `${formatCurrency(netWorth)} / ${formatCurrency(settings.monthlyGoal)}`);
    
    // Projections
    const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
    const daysLeft = Math.max(1, daysInMonth - new Date().getDate());
    const needed = Math.max(0, (parseFloat(settings.monthlyGoal) || 8000) - netWorth);
    const dailyNeed = needed / daysLeft;
    setText('dailyNeed', formatCurrency(dailyNeed));
    setText('projection', daysLeft);

    // Streak
    const streak = calculateStreak(rides);
    setText('streak', `🔥 ${streak} Day Streak`);
}

function updatePetrolUI() {
    const tbody = document.getElementById('petrolTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    petrols.forEach((p, i) => {
        const mil = calculateMileage(i);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${new Date(p.date || Date.now()).toLocaleDateString()}</td>
            <td>${formatNumber(p.km, 1)}</td>
            <td>${formatNumber(p.litres, 2)}L</td>
            <td>${formatNumber(mil, 2)}</td>
            <td><button class="action-btn" onclick="deleteEntry('petrol', '${p.id}')">×</button></td>
        `;
        tbody.appendChild(tr);
    });

    const lastKM = getPreviousOdometer();
    setText('lastKMDisplay', `Previous: ${formatNumber(lastKM, 1)} km`);

    // Hero Metrics
    const latestMileage = petrols.length > 0 ? calculateMileage(petrols.length - 1) : 0;
    setText('mileageHero', formatNumber(latestMileage, 2));
    
    const totalDist = rides.reduce((sum, r) => sum + ((parseFloat(r.endKM) || 0) - (parseFloat(r.startKM) || 0)), 0);
    const totalFuelCost = petrols.reduce((sum, p) => sum + (parseFloat(p.cost) || 0), 0);
    const avgExpPerKM = totalDist > 0 ? (totalFuelCost / totalDist) : 0;
    setText('expenseHero', formatCurrency(avgExpPerKM) + " / km");
}

function updateRideUI() {
    const tbody = document.getElementById('rideTable');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (rides.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--text-muted); padding: 20px;">No rides yet</td></tr>';
    } else {
        // Show last 10 rides
        const recentRides = [...rides].sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 10);
        recentRides.forEach(r => {
            const dist = (parseFloat(r.endKM) || 0) - (parseFloat(r.startKM) || 0);
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${new Date(r.date || Date.now()).toLocaleDateString()}</td>
                <td>${formatNumber(r.startKM, 1)}</td>
                <td>${formatNumber(r.endKM, 1)}</td>
                <td>${formatCurrency(r.earnings)}</td>
                <td>${formatNumber(dist, 1)} km</td>
                <td><button class="action-btn" onclick="deleteEntry('ride', '${r.id}')">×</button></td>
            `;
            tbody.appendChild(tr);
        });
    }

    const lastKM = getPreviousOdometer();
    setText('lastRideKMDisplay', `Previous Odometer: ${formatNumber(lastKM, 1)} km`);
}

function updateSettingsUI() {
    if (isSavingSettings) return;

    const goalEl = document.getElementById('monthlyGoalInput');
    const savingsEl = document.getElementById('savingsPercentInput');
    const initialKMEl = document.getElementById('initialKMInput');

    if (goalEl) goalEl.value = parseFloat(settings.monthlyGoal) || 8000;
    if (savingsEl) savingsEl.value = parseFloat(settings.savingPercent) || 30;
    if (initialKMEl) initialKMEl.value = parseFloat(settings.initialKM) || 0;
}

// Initial KM Save Handler
document.getElementById("saveInitialKM")?.addEventListener("click", async () => {
    const input = document.getElementById("initialKMInput");
    const value = parseFloat(input.value);

    if (isNaN(value) || value < 0) {
        alert("Enter valid KM");
        return;
    }

    settings.initialKM = value;

    // Save locally
    localStorage.setItem("bmd_settings", JSON.stringify(settings));

    // Save to Firebase
    try {
        isSavingSettings = true;
        
        // Premium Feedback: Change icon to loading/check
        const btn = document.getElementById("saveInitialKM");
        const originalIcon = btn.innerHTML;
        btn.innerHTML = '<i data-lucide="loader-2" class="spin"></i>';
        if (window.lucide) lucide.createIcons();

        if (isFirebaseReady) {
            await setDoc(doc(db, "users", userId, "config", "settings"), settings);
        }
        
        // Success state
        btn.innerHTML = '<i data-lucide="check" style="color: #10b981"></i>';
        if (window.lucide) lucide.createIcons();
        
        render(); // IMPORTANT
        
        // Revert icon after 2 seconds
        setTimeout(() => {
            btn.innerHTML = originalIcon;
            if (window.lucide) lucide.createIcons();
        }, 2000);

    } catch (err) {
        console.error("Failed to save initial KM:", err);
        alert("Save failed, check connection.");
    } finally {
        isSavingSettings = false;
    }
});

function updateExpenseUI() {
    const tbody = document.getElementById('expenseTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const totalExp = expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
    setText('totalExpenseHero', formatCurrency(totalExp));

    // Budget Usage calculation
    const goal = parseFloat(settings.monthlyGoal) || 8000;
    const usagePercent = Math.min((totalExp / goal) * 100, 100);
    const useBar = document.getElementById('expenseBar');
    if (useBar) useBar.style.width = usagePercent + '%';
    setText('budgetUsageText', formatNumber(usagePercent, 0) + '%');

    expenses.forEach(e => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${new Date(e.date || Date.now()).toLocaleDateString()}</td>
            <td>${e.category}</td>
            <td>${formatCurrency(e.amount)}</td>
            <td><button class="action-btn" onclick="deleteEntry('expense', '${e.id}')">×</button></td>
        `;
        tbody.appendChild(tr);
    });
}

function updateInsightsUI() {
    const container = document.getElementById('financial-metrics');
    if (!container) return;
    
    const totalEarn = rides.reduce((sum, r) => sum + (parseFloat(r.earnings) || 0), 0);
    const totalFuel = petrols.reduce((sum, p) => sum + (parseFloat(p.cost) || 0), 0);
    const totalExp = expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
    const net = totalEarn - totalFuel - totalExp;
    
    const metrics = [
        { label: 'Net Profit', value: formatCurrency(net), color: net >= 0 ? 'green' : 'orange' },
        { label: 'Fuel Cost', value: formatCurrency(totalFuel), color: 'blue' },
        { label: 'Expenses', value: formatCurrency(totalExp), color: 'purple' },
        { label: 'Avg / KM', value: formatCurrency(totalEarn / (rides.reduce((s,r) => s + (parseFloat(r.endKM-r.startKM) || 0), 0) || 1)), color: 'teal' }
    ];
    
    container.innerHTML = metrics.map(m => `
        <div class="card stat-card card-${m.color}">
            <p>${m.label}</p>
            <h3 class="stat-value">${m.value}</h3>
        </div>
    `).join('');
}

// =====================
// CALCULATION LOGIC
// =====================

function calculateMileage(index) {
    if (index === 0) {
        const initKM = parseFloat(settings.initialKM) || 0;
        if (initKM > 0 && parseFloat(petrols[0].km) > initKM) {
            return (parseFloat(petrols[0].km) - initKM) / parseFloat(petrols[0].litres);
        }
        return 0;
    }
    const dist = parseFloat(petrols[index].km) - parseFloat(petrols[index-1].km);
    return dist / parseFloat(petrols[index].litres);
}

function calculateStreak(data) {
    if (data.length === 0) return 0;
    let s = 0;
    const dates = [...new Set(data.map(r => r.date))].sort().reverse();
    
    // Use local ISO date (YYYY-MM-DD)
    let current = new Date();
    const getDS = (d) => d.toLocaleDateString('sv'); 

    for (let d of dates) {
        if (d === getDS(current)) {
            s++;
            current.setDate(current.getDate() - 1);
        } else break;
    }
    return s;
}

// =====================
// DATA EXPORT
// =====================
window.exportData = () => {
    const data = { rides, petrols, expenses, settings, exportDate: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bmd_backup_${new Date().toLocaleDateString('sv')}.json`;
    a.click();
};

// =====================
// CHARTING
// =====================

function initCharts() {
    if (typeof Chart === 'undefined') {
        console.warn("Chart.js not loaded yet. Skipping charts.");
        return;
    }
    
    // Check if app is visible
    if (!document.body.classList.contains('logged-in')) return;

    // 1. Weekly Earning Chart
    const ctxHome = document.getElementById('homeWeeklyChart');
    if (ctxHome) {
        const labels = Array.from({length: 7}, (_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - (6 - i));
            return d.toLocaleDateString('en-US', { weekday: 'short' });
        });
        const data = labels.map((_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - (6 - i));
            const dayStr = d.toISOString().split('T')[0];
            return rides.filter(r => r.date === dayStr).reduce((s, r) => s + (parseFloat(r.earnings) || 0), 0);
        });
        if (charts.homeWeekly) {
            charts.homeWeekly.data.labels = labels;
            charts.homeWeekly.data.datasets[0].data = data;
            charts.homeWeekly.update();
        } else {
            charts.homeWeekly = new Chart(ctxHome, {
                type: 'line',
                data: { labels, datasets: [{ label: 'Earnings', data, borderColor: '#6366f1', backgroundColor: 'rgba(99, 102, 241, 0.1)', fill: true, tension: 0.4 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
            });
        }
    }

    // 2. Mileage Chart (Premium Line)
    const ctxMileage = document.getElementById('mileageChart');
    if (ctxMileage) {
        const milData = petrols.map((_, i) => calculateMileage(i).toFixed(1));
        const milLabels = petrols.map(p => new Date(p.date || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        
        if (charts.mileage) {
            charts.mileage.data.labels = milLabels;
            charts.mileage.data.datasets[0].data = milData;
            charts.mileage.update();
        } else {
            const gradient = ctxMileage.getContext('2d').createLinearGradient(0, 0, 0, 400);
            gradient.addColorStop(0, 'rgba(16, 185, 129, 0.4)');
            gradient.addColorStop(1, 'rgba(16, 185, 129, 0)');

            charts.mileage = new Chart(ctxMileage, {
                type: 'line',
                data: { 
                    labels: milLabels, 
                    datasets: [{ 
                        label: 'KM/L', 
                        data: milData, 
                        borderColor: '#10b981',
                        backgroundColor: gradient,
                        fill: true,
                        tension: 0.4,
                        pointBackgroundColor: '#10b981',
                        pointBorderColor: 'rgba(255,255,255,0.8)',
                        pointHoverRadius: 6
                    }] 
                },
                options: { 
                    responsive: true, 
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        y: { 
                            beginAtZero: false,
                            grid: { color: 'rgba(255,255,255,0.05)' },
                            ticks: { color: 'rgba(255,255,255,0.5)' }
                        },
                        x: { 
                            grid: { display: false },
                            ticks: { color: 'rgba(255,255,255,0.5)' }
                        }
                    }
                }
            });
        }
    }

    // 3. Expense Pie Chart
    const ctxPie = document.getElementById('expensePieChart') || document.getElementById('pieChart');
    if (ctxPie) {
        const categories = [...new Set(expenses.map(e => e.category))];
        const catData = categories.map(cat => expenses.filter(e => e.category === cat).reduce((s, e) => s + Number(e.amount), 0));
        if (charts.expensePie) {
            charts.expensePie.data.labels = categories;
            charts.expensePie.data.datasets[0].data = catData;
            charts.expensePie.update();
        } else {
            charts.expensePie = new Chart(ctxPie, {
                type: 'doughnut',
                data: { labels: categories, datasets: [{ data: catData, backgroundColor: ['#6366f1', '#f59e0b', '#ef4444', '#10b981'] }] },
                options: { responsive: true, maintainAspectRatio: false }
            });
        }
    }

    // 4. Insights Comparison
    const ctxComp = document.getElementById('insightComparisonChart');
    if (ctxComp) {
        const totalEarn = rides.reduce((sum, r) => sum + (parseFloat(r.earnings) || 0), 0);
        const totalFuel = petrols.reduce((sum, p) => sum + (parseFloat(p.cost) || 0), 0);
        const totalExp = expenses.reduce((sum, e) => sum + (parseFloat(e.amount) || 0), 0);
        if (charts.comparison) {
            charts.comparison.data.datasets[0].data = [totalEarn, totalFuel + totalExp];
            charts.comparison.update();
        } else {
            charts.comparison = new Chart(ctxComp, {
                type: 'bar',
                data: { labels: ['Income', 'Expenses'], datasets: [{ data: [totalEarn, totalFuel + totalExp], backgroundColor: ['#10b981', '#ef4444'] }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }
            });
        }
    }
}

// =====================
// EVENT HANDLERS
// =====================

document.getElementById('rideForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const start = parseFloat(document.getElementById('startKM').value);
    const end = parseFloat(document.getElementById('endKM').value);
    const earn = parseFloat(document.getElementById('earnings').value);
    
    if (isNaN(start) || isNaN(end) || isNaN(earn)) {
        alert("Please enter valid numbers.");
        return;
    }
    if (end <= start) {
        alert("End KM must be greater than Start KM.");
        return;
    }

    const data = {
        date: document.getElementById('rideDate').value || new Date().toISOString().split('T')[0],
        startKM: start,
        endKM: end,
        earnings: earn,
        timestamp: serverTimestamp()
    };
    
    if (isFirebaseReady) {
        await addDoc(collection(db, "users", userId, "rides"), data);
    }
    document.getElementById('rideModal').classList.remove('active');
    e.target.reset();
});

document.getElementById('petrolForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const km = parseFloat(document.getElementById('petrolKM').value);
    const litres = parseFloat(document.getElementById('litres').value);
    const cost = parseFloat(document.getElementById('cost').value);

    if (isNaN(km) || isNaN(litres) || isNaN(cost)) {
        alert("Please enter valid numbers.");
        return;
    }
    if (litres <= 0) {
        alert("Litres must be greater than 0.");
        return;
    }

    const data = {
        date: new Date().toISOString().split('T')[0],
        km: km,
        litres: litres,
        cost: cost,
        timestamp: serverTimestamp()
    };

    if (isFirebaseReady) {
        await addDoc(collection(db, "users", userId, "petrols"), data);
    }
    e.target.reset();
});

document.getElementById('expenseForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const amount = parseFloat(document.getElementById('expenseAmount').value);

    if (isNaN(amount)) {
        alert("Please enter a valid amount.");
        return;
    }

    const data = {
        date: new Date().toISOString().split('T')[0],
        category: document.getElementById('expenseCategory').value,
        amount: amount,
        timestamp: serverTimestamp()
    };

    if (isFirebaseReady) {
        await addDoc(collection(db, "users", userId, "expenses"), data);
    }
    e.target.reset();
});

window.saveSettings = async () => {
    const newGoals = parseFloat(document.getElementById('monthlyGoalInput').value) || 8000;
    const newSavings = parseFloat(document.getElementById('savingsPercentInput').value) || 30;

    // Update local state first for immediate UI feel
    settings.monthlyGoal = newGoals;
    settings.savingPercent = newSavings;

    if (isFirebaseReady) {
        try {
            isSavingSettings = true;
            document.body.classList.add("loading");
            
            await setDoc(doc(db, "users", userId, "config", "settings"), settings);
            
            console.log("Settings saved to Firestore successfully.");
            alert("Configurations saved!");
            switchTab('home');
        } catch (err) {
            console.error("Save Settings Failed:", err);
            alert("Failed to save settings. Please try again.");
        } finally {
            isSavingSettings = false;
            document.body.classList.remove("loading");
        }
    } else {
        // Fallback for offline/local
        localStorage.setItem("bmd_settings", JSON.stringify(settings));
        alert("Configurations saved locally!");
        switchTab('home');
    }
};

window.deleteEntry = async function(type, id) {
    if (!confirm("Delete this entry?")) return;
    try {
        if (isFirebaseReady) {
            await deleteDoc(doc(db, "users", userId, type + 's', id));
        }
    } catch (err) {
        console.error("Delete failed:", err);
    }
};

// Data Purge Logic
async function deleteCollection(path) {
    const snap = await getDocs(collection(db, path));
    await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
}

async function deleteAllData() {
    try {
        if (isFirebaseReady) {
            await deleteCollection(`users/${userId}/rides`);
            await deleteCollection(`users/${userId}/petrols`);
            await deleteCollection(`users/${userId}/expenses`);
            await deleteDoc(doc(db, "users", userId, "config", "settings"));
        }

        // Clear local
        rides = [];
        petrols = [];
        expenses = [];
        settings = { savingPercent: 30, monthlyGoal: 8000, initialKM: 0 };

        localStorage.clear();

        render();
        alert("All data deleted");
        window.location.reload();

    } catch (err) {
        console.error(err);
        alert("Delete failed");
    }
}

let confirmDeleteCallback = null;

window.openDeleteModal = () => {
    const modal = document.getElementById("confirmModal");
    if (modal) modal.classList.add("active");
    confirmDeleteCallback = deleteAllData;
};

window.closeModal = () => {
    const modal = document.getElementById("confirmModal");
    if (modal) modal.classList.remove("active");
};

window.confirmDelete = async () => {
    closeModal();
    if (confirmDeleteCallback) {
        await confirmDeleteCallback();
    }
};

window.resetData = function() {
    if (!confirm("Are you SURE? This will wipe LOCAL cache. Database remains safe.")) return;
    localStorage.clear();
    location.reload();
};

// =====================
// DATA MIGRATION
// =====================
async function migrateLocalData(newUid) {
    const ridesBatchData = JSON.parse(localStorage.getItem("bmd_rides"));
    const petrolsBatchData = JSON.parse(localStorage.getItem("bmd_petrols"));
    const expensesBatchData = JSON.parse(localStorage.getItem("bmd_expenses"));

    if (!ridesBatchData && !petrolsBatchData && !expensesBatchData) return;

    console.log("Migrating local data to your new account...");
    const batch = writeBatch(db);

    if (ridesBatchData) {
        ridesBatchData.forEach(r => {
            const ref = doc(collection(db, "users", newUid, "rides"));
            batch.set(ref, r);
        });
    }
    if (petrolsBatchData) {
        petrolsBatchData.forEach(p => {
            const ref = doc(collection(db, "users", newUid, "petrols"));
            batch.set(ref, p);
        });
    }
    if (expensesBatchData) {
        expensesBatchData.forEach(e => {
            const ref = doc(collection(db, "users", newUid, "expenses"));
            batch.set(ref, e);
        });
    }

    try {
        await batch.commit();
        localStorage.removeItem("bmd_rides");
        localStorage.removeItem("bmd_petrols");
        localStorage.removeItem("bmd_expenses");
        console.log("Migration successful!");
    } catch (err) {
        console.error("Migration failed:", err);
    }
}

// =====================
// INIT
// =====================
onAuthStateChanged(auth, async (user) => {
    if (user) {
        console.log("Status: User authenticated", user.uid);
        userId = user.uid;
        document.body.classList.add("logged-in");
        
        // One-time migration of local data to cloud
        await migrateLocalData(user.uid);
        
        // Start Real-time Sync
        await initFirebase();
    } else {
        console.log("Status: No active session.");
        userId = null;
        document.body.classList.remove("logged-in");
        document.body.classList.remove("loading");
    }
});