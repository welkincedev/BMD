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

// Global chart instances
const charts = {
    homeWeekly: null,
    mileage: null,
    expensePie: null,
    comparison: null
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
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    
    const target = document.getElementById(tabId);
    if (target) target.classList.add('active');
    
    const navItem = document.getElementById('nav-' + tabId);
    if (navItem) navItem.classList.add('active');
    
    render();
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
    console.log("--- Starting Render Cycle ---");
    const safeRun = (name, fn) => {
        try {
            fn();
        } catch (err) {
            console.error(`Render Error [${name}]:`, err);
        }
    };

    safeRun("Dashboard", updateDashboard);
    safeRun("PetrolUI", updatePetrolUI);
    safeRun("ExpenseUI", updateExpenseUI);
    safeRun("InsightsUI", updateInsightsUI);
    safeRun("Charts", initCharts);
    safeRun("Icons", safeCreateIcons);
    
    // Final delay-synced icon check
    setTimeout(safeCreateIcons, 500);
}

function updateDashboard() {
    const totalEarn = rides.reduce((sum, r) => sum + Number(r.earnings), 0);
    const totalDist = rides.reduce((sum, r) => sum + (Number(r.endKM) - Number(r.startKM)), 0);
    
    setText('earn', `₹${totalEarn.toLocaleString()}`);
    setText('distance', `${totalDist.toLocaleString()} km`);
    
    const avgKm = totalDist > 0 ? (totalEarn / totalDist).toFixed(2) : 0;
    setText('avgKm', `₹${avgKm}`);
    
    const latestLitres = petrols.length > 0 ? petrols[petrols.length - 1].litres : 0;
    const latestMileage = petrols.length > 0 ? calculateMileage(petrols.length - 1).toFixed(1) : 0;
    setText('mileage', `${latestMileage} km/l`);

    // Goal Progress
    const currentProgress = (totalEarn / settings.monthlyGoal) * 100;
    const bar = document.getElementById('bar');
    if (bar) bar.style.width = Math.min(currentProgress, 100) + '%';
    setText('savingsText', `₹${totalEarn.toLocaleString()} / ₹${settings.monthlyGoal.toLocaleString()}`);
    
    // Projections
    const daysLeft = 30 - new Date().getDate();
    const needed = Math.max(0, settings.monthlyGoal - totalEarn);
    const dailyNeed = daysLeft > 0 ? (needed / daysLeft).toFixed(0) : 0;
    setText('dailyNeed', `₹${dailyNeed}`);
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
        const mil = calculateMileage(i).toFixed(1);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${new Date(p.date || Date.now()).toLocaleDateString()}</td>
            <td>${p.km}</td>
            <td>${p.litres}L</td>
            <td>${mil}</td>
            <td><button class="action-btn" onclick="deleteEntry('petrol', '${p.id}')">×</button></td>
        `;
        tbody.appendChild(tr);
    });

    const lastKM = petrols.length > 0 ? petrols[petrols.length-1].km : 0;
    setText('lastKMDisplay', `Previous Odometer: ${lastKM} km`);
}

function updateExpenseUI() {
    const tbody = document.getElementById('expenseTable');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    expenses.forEach(e => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${new Date(e.date || Date.now()).toLocaleDateString()}</td>
            <td>${e.category}</td>
            <td>₹${e.amount}</td>
            <td><button class="action-btn" onclick="deleteEntry('expense', '${e.id}')">×</button></td>
        `;
        tbody.appendChild(tr);
    });
}

function updateInsightsUI() {
    const container = document.getElementById('financial-metrics');
    if (!container) return;
    
    const totalEarn = rides.reduce((sum, r) => sum + Number(r.earnings), 0);
    const totalFuel = petrols.reduce((sum, p) => sum + Number(p.cost), 0);
    const totalExp = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
    const net = totalEarn - totalFuel - totalExp;
    
    const metrics = [
        { label: 'Net Profit', value: `₹${net.toLocaleString()}`, color: net >= 0 ? 'green' : 'orange' },
        { label: 'Fuel Cost', value: `₹${totalFuel.toLocaleString()}`, color: 'blue' },
        { label: 'Expenses', value: `₹${totalExp.toLocaleString()}`, color: 'purple' },
        { label: 'Avg / KM', value: `₹${(totalEarn / (rides.reduce((s,r) => s + (r.endKM-r.startKM), 0) || 1)).toFixed(2)}`, color: 'teal' }
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
        if (settings.initialKM > 0 && petrols[0].km > settings.initialKM) {
            return (petrols[0].km - settings.initialKM) / petrols[0].litres;
        }
        return 0;
    }
    const dist = petrols[index].km - petrols[index-1].km;
    return dist / petrols[index].litres;
}

function calculateStreak(data) {
    if (data.length === 0) return 0;
    let s = 0;
    const today = new Date().toISOString().split('T')[0];
    const dates = [...new Set(data.map(r => r.date))].sort().reverse();
    
    let current = new Date();
    for (let d of dates) {
        if (d === current.toISOString().split('T')[0]) {
            s++;
            current.setDate(current.getDate() - 1);
        } else break;
    }
    return s;
}

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
            return rides.filter(r => r.date === dayStr).reduce((s, r) => s + Number(r.earnings), 0);
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

    // 2. Mileage Chart
    const ctxMileage = document.getElementById('mileageChart');
    if (ctxMileage) {
        const milData = petrols.map((_, i) => calculateMileage(i).toFixed(1));
        const milLabels = petrols.map(p => new Date(p.date || Date.now()).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
        if (charts.mileage) {
            charts.mileage.data.labels = milLabels;
            charts.mileage.data.datasets[0].data = milData;
            charts.mileage.update();
        } else {
            charts.mileage = new Chart(ctxMileage, {
                type: 'bar',
                data: { labels: milLabels, datasets: [{ label: 'KM/L', data: milData, backgroundColor: '#10b981' }] },
                options: { responsive: true, maintainAspectRatio: false }
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
        const totalEarn = rides.reduce((sum, r) => sum + Number(r.earnings), 0);
        const totalFuel = petrols.reduce((sum, p) => sum + Number(p.cost), 0);
        const totalExp = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
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
    const data = {
        date: document.getElementById('rideDate').value || new Date().toISOString().split('T')[0],
        startKM: Number(document.getElementById('startKM').value),
        endKM: Number(document.getElementById('endKM').value),
        earnings: Number(document.getElementById('earnings').value),
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
    const data = {
        date: new Date().toISOString().split('T')[0],
        km: Number(document.getElementById('petrolKM').value),
        litres: Number(document.getElementById('litres').value),
        cost: Number(document.getElementById('cost').value),
        timestamp: serverTimestamp()
    };

    if (isFirebaseReady) {
        await addDoc(collection(db, "users", userId, "petrols"), data);
    }
    e.target.reset();
});

document.getElementById('expenseForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
        date: new Date().toISOString().split('T')[0],
        category: document.getElementById('expenseCategory').value,
        amount: Number(document.getElementById('expenseAmount').value),
        timestamp: serverTimestamp()
    };

    if (isFirebaseReady) {
        await addDoc(collection(db, "users", userId, "expenses"), data);
    }
    e.target.reset();
});

window.saveSettings = async () => {
    const newGoals = Number(document.getElementById('monthlyGoalInput').value) || 8000;
    const newSavings = Number(document.getElementById('savingsPercentInput').value) || 30;
    const newInitialKM = Number(document.getElementById('initialKMInput').value) || 0;

    // Update local state first for immediate UI feel
    settings.monthlyGoal = newGoals;
    settings.savingPercent = newSavings;
    settings.initialKM = newInitialKM;

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
        console.log("User logged in:", user.uid);
        userId = user.uid;
        document.body.classList.add("logged-in");
        
        // One-time migration
        await migrateLocalData(user.uid);
        
        // Start Sync
        await initFirebase();
        
        // Final UI Polish
        render(); 
        
        // Update Settings UI
        if (document.getElementById('monthlyGoalInput')) {
            document.getElementById('monthlyGoalInput').value = settings.monthlyGoal || 8000;
        }
        
    } else {
        console.log("No user logged in.");
        userId = null;
        document.body.classList.remove("logged-in");
        document.body.classList.remove("loading");
    }
});