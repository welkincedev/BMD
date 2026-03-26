// =====================
// FIREBASE & STATE
// =====================
let rides = [];
let petrols = [];
let expenses = [];
let settings = {
    savingPercent: 30,
    monthlyGoal: 8000,
    initialKM: 0
};

let db = null;
let isFirebaseReady = false;

async function initFirebase() {
    if (typeof firebase === 'undefined' || !window.firebaseConfig || window.firebaseConfig.apiKey === "YOUR_API_KEY") {
        console.warn("Firebase not configured. Using LocalStorage fallback.");
        loadLocalData();
        return;
    }

    try {
        firebase.initializeApp(window.firebaseConfig);
        db = firebase.firestore();
        isFirebaseReady = true;
        console.log("Firebase Initialized!");
        
        await syncData();
    } catch (err) {
        console.error("Firebase init failed:", err);
        loadLocalData();
    }
}

function loadLocalData() {
    rides = JSON.parse(localStorage.getItem("bmd_rides")) || [];
    petrols = JSON.parse(localStorage.getItem("bmd_petrols")) || [];
    expenses = JSON.parse(localStorage.getItem("bmd_expenses")) || [];
    settings = JSON.parse(localStorage.getItem("bmd_settings")) || settings;
}

async function syncData() {
    // 1. Load from Firestore
    const snapshot = await db.collection('data').doc('v1').get();
    
    if (!snapshot.exists) {
        // 2. First time? Migrate local data to Firebase
        console.log("No remote data. Migrating local data...");
        loadLocalData();
        await saveData();
    } else {
        const data = snapshot.data();
        rides = data.rides || [];
        petrols = data.petrols || [];
        expenses = data.expenses || [];
        settings = data.settings || settings;
        console.log("Data synced from Firebase.");
    }
}

// Global chart instances to avoid duplication
const charts = {
    homeWeekly: null,
    mileage: null,
    expensePie: null,
    comparison: null
};

// =====================
// TAB SWITCHING
// =====================
function switchTab(tabId) {
    // Hide all screens
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    // Show target screen
    const target = document.getElementById(tabId) || document.getElementById('home');
    target.classList.add('active');

    // Update Nav
    document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
    const navItem = document.getElementById(`nav-${tabId}`);
    if (navItem) navItem.classList.add('active');

    // Re-render and re-init icons
    render();
    if (window.lucide) lucide.createIcons();
    
    // Scroll to top
    document.querySelector('.content').scrollTop = 0;
}

// =====================
// DATA SAVING
// =====================
async function saveData() {
    // Always save to LocalStorage for offline/fallback
    localStorage.setItem("bmd_rides", JSON.stringify(rides));
    localStorage.setItem("bmd_petrols", JSON.stringify(petrols));
    localStorage.setItem("bmd_expenses", JSON.stringify(expenses));
    localStorage.setItem("bmd_settings", JSON.stringify(settings));

    if (isFirebaseReady) {
        try {
            await db.collection('data').doc('v1').set({
                rides, petrols, expenses, settings,
                lastUpdated: firebase.firestore.FieldValue.serverTimestamp()
            });
        } catch (err) {
            console.error("Firebase save failed:", err);
        }
    }
}

// =====================
// CALCULATIONS
// =====================

function getTotals() {
    const totalEarnings = rides.reduce((sum, r) => sum + r.earnings, 0);
    const totalDistance = rides.reduce((sum, r) => sum + (r.endKM - r.startKM), 0);
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const savings = totalEarnings * (settings.savingPercent / 100);
    const avgKmCost = totalDistance ? (totalEarnings / totalDistance).toFixed(2) : 0;
    
    const totalPetrolCost = petrols.reduce((sum, p) => sum + p.cost, 0);
    const netProfit = totalEarnings - totalExpenses - totalPetrolCost;

    return { totalEarnings, totalDistance, totalExpenses, savings, avgKmCost, netProfit, totalPetrolCost };
}

function getStreak() {
    if (!rides.length) return 0;
    const sorted = [...new Set(rides.map(r => r.date))].sort().reverse();
    let streak = 0;
    let today = new Date();
    today.setHours(0,0,0,0);

    for (let i = 0; i < sorted.length; i++) {
        let entryDate = new Date(sorted[i]);
        entryDate.setHours(0,0,0,0);
        
        let diff = Math.floor((today - entryDate) / (1000 * 60 * 60 * 24));
        
        if (diff === streak) {
            streak++;
        } else if (diff > streak) {
            break;
        }
    }
    return streak;
}

function getMileage() {
    if (petrols.length === 0) return 0;
    const sorted = [...petrols].sort((a, b) => a.km - b.km);
    
    if (petrols.length === 1) {
        if (settings.initialKM > 0 && sorted[0].km > settings.initialKM) {
            return ((sorted[0].km - settings.initialKM) / sorted[0].litres).toFixed(1);
        }
        return 0;
    }
    
    const last = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2];
    return ((last.km - prev.km) / last.litres).toFixed(1);
}

function getGoalStats(currentSavings) {
    const today = new Date();
    const lastDayOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const remainingDays = lastDayOfMonth - today.getDate() + 1;
    
    const remainingGoal = Math.max(0, settings.monthlyGoal - currentSavings);
    const dailyNeeded = remainingDays > 0 ? (remainingGoal / remainingDays).toFixed(0) : 0;
    
    const avgPerDay = currentSavings / today.getDate();
    const projectedDays = avgPerDay > 0 ? Math.ceil(settings.monthlyGoal / avgPerDay) : "~";
    
    return { dailyNeeded, projectedDays, remainingGoal };
}

// =====================
// RENDER UI
// =====================

function render() {
    const totals = getTotals();
    const streak = getStreak();
    const mileage = getMileage();
    
    // Home Stats
    setText('earn', `₹${totals.totalEarnings.toLocaleString()}`);
    setText('distance', `${totals.totalDistance} km`);
    setText('mileage', `${mileage} km/l`);
    setText('avgKm', `₹${totals.avgKmCost}/km`);
    setText('streak', `🔥 ${streak} Day Streak`);

    // Mileage Context
    setText('lastKMDisplay', `Previous Odometer: ${settings.initialKM} km`);

    // Goal
    const goal = getGoalStats(totals.savings);
    setText('savingsText', `₹${Math.floor(totals.savings)} / ₹${settings.monthlyGoal}`);
    setText('dailyNeed', `₹${goal.dailyNeeded}`);
    setText('projection', goal.projectedDays);
    const bar = document.getElementById('bar');
    if (bar) bar.style.width = `${Math.min(100, (totals.savings / settings.monthlyGoal * 100))}%`;

    // Trend
    const trendEl = document.getElementById('trend');
    if (trendEl && rides.length > 1) {
        const last = rides[rides.length - 1].earnings;
        const prev = rides[rides.length - 2].earnings;
        if (last > prev) trendEl.innerHTML = '<span class="up">↑ Rising</span>';
        else if (last < prev) trendEl.innerHTML = '<span class="down">↓ Falling</span>';
        else trendEl.innerHTML = '<span>→ Stable</span>';
    }

    // Tables
    renderPetrolTable();
    renderExpenseTable();
    
    // Insights
    renderInsights();

    // Charts
    setTimeout(renderCharts, 100);

    // Form Defaults
    const dateInput = document.getElementById('rideDate');
    if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().split('T')[0];
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.innerText = text;
}

function renderPetrolTable() {
    const tbody = document.getElementById('petrolTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const sorted = [...petrols].sort((a,b) => new Date(b.date) - new Date(a.date));
    
    sorted.forEach((p) => {
        const kmSorted = [...petrols].sort((a,b) => a.km - b.km);
        const idxInKm = kmSorted.findIndex(item => item.id === p.id);
        let m = "-";
        if (idxInKm > 0) {
            m = ((kmSorted[idxInKm].km - kmSorted[idxInKm-1].km) / kmSorted[idxInKm].litres).toFixed(1);
        } else if (settings.initialKM > 0 && kmSorted[0].km > settings.initialKM) {
            m = ((kmSorted[0].km - settings.initialKM) / kmSorted[0].litres).toFixed(1);
        }

        tbody.innerHTML += `
            <tr>
                <td>${formatDate(p.date)}</td>
                <td>${p.km}</td>
                <td>${p.litres}L</td>
                <td><span style="color:var(--primary)">${m}</span></td>
                <td style="text-align:right">
                    <button class="action-btn delete" onclick="deleteEntry('petrol', ${p.id})"><i data-lucide="trash-2"></i></button>
                </td>
            </tr>
        `;
    });
}

function renderExpenseTable() {
    const tbody = document.getElementById('expenseTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const sorted = [...expenses].sort((a,b) => new Date(b.date) - new Date(a.date));
    
    sorted.slice(0, 10).forEach(e => {
        tbody.innerHTML += `
            <tr>
                <td>${formatDate(e.date)}</td>
                <td>${e.category}</td>
                <td>₹${e.amount}</td>
                <td style="text-align:right">
                    <button class="action-btn delete" onclick="deleteEntry('expense', ${e.id})"><i data-lucide="trash-2"></i></button>
                </td>
            </tr>
        `;
    });
}

function renderInsights() {
    const insightList = document.getElementById('insightList');
    if (!insightList) return;
    insightList.innerHTML = '';

    // Financial Metrics Cards
    const totalsLocal = getTotals();
    const financialMetrics = document.getElementById('financial-metrics');
    if (financialMetrics) {
        const todayStr = new Date().toISOString().split('T')[0];
        const todayEarnings = rides.filter(r => r.date === todayStr).reduce((sum, r) => sum + r.earnings, 0);
        
        const currentMonth = new Date().getMonth();
        const currentYear = new Date().getFullYear();
        const monthlyEarnings = rides.filter(r => {
            const d = new Date(r.date);
            return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
        }).reduce((sum, r) => sum + r.earnings, 0);
        const monthlySavings = (monthlyEarnings * (settings.savingPercent / 100)).toFixed(0);

        const totalSavings = totalsLocal.totalEarnings * (settings.savingPercent / 100);
        const spendable = (totalsLocal.totalEarnings - totalSavings).toFixed(0);

        financialMetrics.innerHTML = `
            <div class="card insight-card card-green">
                <p>Today's Earnings</p>
                <h3>₹${todayEarnings.toLocaleString()}</h3>
            </div>
            <div class="card insight-card card-blue">
                <p>Monthly Savings</p>
                <h3>₹${Number(monthlySavings).toLocaleString()}</h3>
            </div>
            <div class="card insight-card card-purple">
                <p>Spendable Income</p>
                <h3>₹${Number(spendable).toLocaleString()}</h3>
            </div>
        `;
    }

    const messages = [];
    const mileage = getMileage();
    const goal = getGoalStats(totalsLocal.savings);

    if (mileage > 45) messages.push({ text: "Excellent efficiency! Keep it up.", icon: "star", type: "primary" });
    if (mileage > 0 && mileage < 30) messages.push({ text: "Low mileage detected. Check tire pressure.", icon: "alert-triangle", type: "warning" });
    
    if (goal.remainingGoal > 0) {
        messages.push({ text: `You need ₹${goal.dailyNeeded} daily to reach your savings goal.`, icon: "target", type: "secondary" });
    } else if (settings.monthlyGoal > 0) {
        messages.push({ text: "Monthly goal reached! High five!", icon: "award", type: "primary" });
    }

    if (rides.length > 5) {
        const avgEarnings = totalsLocal.totalEarnings / new Set(rides.map(r => r.date)).size;
        messages.push({ text: `Your average daily earnings is ₹${avgEarnings.toFixed(0)}.`, icon: "trending-up", type: "secondary" });
    }

    messages.forEach(m => {
        insightList.innerHTML += `
            <div class="insight-msg">
                <div class="insight-icon" style="color: var(--${m.type})"><i data-lucide="${m.icon}"></i></div>
                <p style="font-size:0.9rem">${m.text}</p>
            </div>
        `;
    });
    if (window.lucide) lucide.createIcons();
}

function formatDate(d) {
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

// =====================
// CHARTS
// =====================

function renderCharts() {
    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
            y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
            x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
        }
    };

    // 1. Home Weekly Earnings
    const homeCtx = document.getElementById('homeWeeklyChart');
    if (homeCtx) {
        if (charts.homeWeekly) charts.homeWeekly.destroy();
        const last7 = rides.slice(-7);
        charts.homeWeekly = new Chart(homeCtx, {
            type: 'line',
            data: {
                labels: last7.map(r => formatDate(r.date)),
                datasets: [{
                    data: last7.map(r => r.earnings),
                    borderColor: '#22c55e',
                    backgroundColor: 'rgba(34, 197, 94, 0.2)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 4
                }]
            },
            options: commonOptions
        });
    }

    // 2. Mileage Trend
    const mileageCtx = document.getElementById('mileageChart');
    if (mileageCtx && petrols.length > 1) {
        if (charts.mileage) charts.mileage.destroy();
        const kmSorted = [...petrols].sort((a,b) => a.km - b.km);
        const data = [];
        const labels = [];
        for(let i=1; i<kmSorted.length; i++) {
            data.push(((kmSorted[i].km - kmSorted[i-1].km) / kmSorted[i].litres).toFixed(1));
            labels.push(formatDate(kmSorted[i].date));
        }
        charts.mileage = new Chart(mileageCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    borderColor: '#3b82f6',
                    tension: 0.4,
                    pointRadius: 4
                }]
            },
            options: commonOptions
        });
    }

    // 3. Expense Pie
    const pieCtx = document.getElementById('expensePieChart');
    if (pieCtx) {
        if (charts.expensePie) charts.expensePie.destroy();
        const catMap = {};
        expenses.forEach(e => catMap[e.category] = (catMap[e.category] || 0) + e.amount);
        
        charts.expensePie = new Chart(pieCtx, {
            type: 'doughnut',
            data: {
                labels: Object.keys(catMap),
                datasets: [{
                    data: Object.values(catMap),
                    backgroundColor: ['#3b82f6', '#8b5cf6', '#f59e0b', '#ef4444', '#22c55e'],
                    borderWidth: 0
                }]
            },
            options: { 
                maintainAspectRatio: false,
                cutout: '65%', 
                plugins: { 
                    legend: { 
                        display: true, 
                        position: 'bottom', 
                        labels: { 
                            color: '#e2e8f0',
                            padding: 20,
                            font: { size: 11 }
                        } 
                    } 
                } 
            }
        });
    }

    // 4. Comparison Chart (Insights)
    const comparisonCtx = document.getElementById('insightComparisonChart');
    if (comparisonCtx) {
        if (charts.comparison) charts.comparison.destroy();
        const totals = getTotals();
        charts.comparison = new Chart(comparisonCtx, {
            type: 'bar',
            data: {
                labels: ['Earnings', 'Expenses', 'Fuel'],
                datasets: [{
                    data: [totals.totalEarnings, totals.totalExpenses, totals.totalPetrolCost],
                    backgroundColor: ['#22c55e', '#ef4444', '#f59e0b']
                }]
            },
            options: commonOptions
        });
    }

    if (window.lucide) lucide.createIcons();
}

// =====================
// FORMS & EVENTS
// =====================

document.getElementById('rideForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const newRide = {
        id: Date.now(),
        date: document.getElementById('rideDate').value,
        startKM: Number(document.getElementById('startKM').value),
        endKM: Number(document.getElementById('endKM').value),
        earnings: Number(document.getElementById('earnings').value)
    };
    rides.push(newRide);
    await saveData();
    document.getElementById('rideModal').classList.remove('active');
    e.target.reset();
    render();
});

document.getElementById('petrolForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const km = Number(document.getElementById('petrolKM').value);
    const newPetrol = {
        id: Date.now(),
        date: new Date().toISOString().split('T')[0],
        km: km,
        litres: Number(document.getElementById('litres').value),
        cost: Number(document.getElementById('cost').value)
    };
    petrols.push(newPetrol);
    
    // Auto-sync initial odometer setting
    settings.initialKM = km;
    
    await saveData();
    e.target.reset();
    render();
});

document.getElementById('expenseForm')?.addEventListener('submit', async e => {
    e.preventDefault();
    const newExpense = {
        id: Date.now(),
        date: new Date().toISOString().split('T')[0],
        category: document.getElementById('expenseCategory').value,
        amount: Number(document.getElementById('expenseAmount').value)
    };
    expenses.push(newExpense);
    await saveData();
    e.target.reset();
    render();
});

async function saveSettings() {
    const goal = document.getElementById('monthlyGoalInput').value;
    const sav = document.getElementById('savingsPercentInput').value;
    const initKM = document.getElementById('initialKMInput').value;
    
    if (goal) settings.monthlyGoal = Number(goal);
    if (sav) settings.savingPercent = Number(sav);
    if (initKM !== "") settings.initialKM = Number(initKM);
    
    await saveData();
    alert("Configurations saved!");
    switchTab('home');
}

async function deleteEntry(type, id) {
    if (!confirm("Delete this entry?")) return;
    if (type === 'ride') rides = rides.filter(r => r.id !== id);
    if (type === 'petrol') petrols = petrols.filter(p => p.id !== id);
    if (type === 'expense') expenses = expenses.filter(e => e.id !== id);
    await saveData();
    render();
}

function resetData() {
    if (!confirm("Are you SURE? This will wipe ALL your data.")) return;
    localStorage.clear();
    location.reload();
}

// =====================
// INIT
// =====================
document.addEventListener('DOMContentLoaded', async () => {
    await initFirebase();
    
    if (document.getElementById('monthlyGoalInput')) document.getElementById('monthlyGoalInput').value = settings.monthlyGoal;
    if (document.getElementById('savingsPercentInput')) document.getElementById('savingsPercentInput').value = settings.savingPercent;
    if (document.getElementById('initialKMInput')) document.getElementById('initialKMInput').value = settings.initialKM;
    render();
});