// ===================== Data source =====================
const CSV_PATH = "data/agentic_ai_performance_dataset_20250622.csv";

// Quick DOM helper
const $ = (id) => document.getElementById(id);

// Store parsed data
let rawRows = [];

// Store Chart.js instances (so we can destroy and re-render cleanly)
const chartRefs = {
    autonomySuccess: null,
    cpuLine: null,
    bubble: null,
    mlCoefficients: null,
    mlBoxplot: null,
    mlPredActual: null
};

// ===================== Utility functions =====================

// Convert value to number safely
function toNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

// Mean of numeric array
function mean(arr) {
    if (!arr.length) return null;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

// Destroy a chart if it exists
function destroyChart(refName) {
    if (chartRefs[refName]) {
        chartRefs[refName].destroy();
        chartRefs[refName] = null;
    }
}

// Build (avg) grouped series for numeric keys (1..10)
function groupAvg(rows, key, valueKey) {
    const map = new Map(); // key -> {sum,count}
    for (const r of rows) {
        const k = r[key];
        const v = r[valueKey];
        if (k == null || v == null) continue;
        const cur = map.get(k) || { sum: 0, count: 0 };
        cur.sum += v;
        cur.count += 1;
        map.set(k, cur);
    }

    const labels = [...map.keys()].sort((a, b) => a - b).map(String);
    const values = labels.map(l => {
        const v = map.get(Number(l));
        return +(v.sum / v.count).toFixed(3);
    });

    return { labels, values };
}

// Quantile (for boxplot). Uses linear interpolation.
function quantile(sortedArr, q) {
    if (!sortedArr.length) return null;
    const pos = (sortedArr.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sortedArr[base + 1] === undefined) return sortedArr[base];
    return sortedArr[base] + rest * (sortedArr[base + 1] - sortedArr[base]);
}

// Build boxplot stats for each complexity value
function buildBoxplotStats(rows) {
    const groups = new Map(); // complexity -> [accuracy]
    for (const r of rows) {
        if (r.task_complexity == null || r.accuracy_score == null) continue;
        const k = r.task_complexity;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r.accuracy_score);
    }

    const labels = [...groups.keys()].sort((a, b) => a - b).map(String);
    const stats = [];
    for (const lab of labels) {
        const arr = groups.get(Number(lab)).slice().sort((a, b) => a - b);
        const q1 = quantile(arr, 0.25);
        const med = quantile(arr, 0.5);
        const q3 = quantile(arr, 0.75);
        const iqr = q3 - q1;

        // Tukey whiskers
        const lowFence = q1 - 1.5 * iqr;
        const highFence = q3 + 1.5 * iqr;

        const inliers = arr.filter(v => v >= lowFence && v <= highFence);
        const whiskerMin = inliers.length ? Math.min(...inliers) : arr[0];
        const whiskerMax = inliers.length ? Math.max(...inliers) : arr[arr.length - 1];

        const outliers = arr.filter(v => v < lowFence || v > highFence);

        stats.push({
            label: lab,
            q1, med, q3,
            min: whiskerMin,
            max: whiskerMax,
            outliers
        });
    }

    return { labels, stats };
}

// ===================== Global Chart.js style =====================
function applyChartDefaults() {
    Chart.defaults.font.family = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = "rgba(17,24,39,.78)";

    // Less clutter
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.boxWidth = 10;
    Chart.defaults.plugins.legend.labels.boxHeight = 10;

    // Tooltip style
    Chart.defaults.plugins.tooltip.backgroundColor = "rgba(17,24,39,.92)";
    Chart.defaults.plugins.tooltip.titleColor = "#fff";
    Chart.defaults.plugins.tooltip.bodyColor = "#fff";
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.displayColors = true;
}

// Base options for grid
function baseOptions() {
    const grid = "rgba(17,24,39,0.08)";
    return {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
            x: {
                grid: { color: grid, drawBorder: false },
                ticks: { maxRotation: 0, autoSkip: true }
            },
            y: {
                grid: { color: grid, drawBorder: false },
                ticks: { maxTicksLimit: 6 }
            }
        },
        plugins: {
            legend: { position: "top" }
        }
    };
}

// ===================== UI (KPIs + Table + Filters) =====================

// Fill KPI card values
function renderKpis(rows) {
    $("kpiRows").textContent = `${rows.length.toLocaleString()} rows`;
    $("kpiCols").textContent = `26 columns`;

    const acc = mean(rows.map(r => r.accuracy_score).filter(v => v != null));
    const cost = mean(rows.map(r => r.cost_per_task_cents).filter(v => v != null));
    const t = mean(rows.map(r => r.execution_time_seconds).filter(v => v != null));
    const cpu = mean(rows.map(r => r.cpu_usage_percent).filter(v => v != null));

    $("kpiAcc").textContent = acc != null ? acc.toFixed(3) : "—";
    $("kpiCost").textContent = cost != null ? `${cost.toFixed(3)}¢` : "—";
    $("kpiTime").textContent = t != null ? `${t.toFixed(2)} s` : "—";
    $("kpiCpu").textContent = cpu != null ? `${cpu.toFixed(1)}%` : "—";
}

// Top performers table
function renderTopModels(rows) {
    const tbody = $("topModelsTable");
    const map = new Map(); // model_architecture -> {sumPerf,sumAcc,count}

    for (const r of rows) {
        const k = r.model_architecture;
        if (!k) continue;
        const cur = map.get(k) || { sumPerf: 0, sumAcc: 0, count: 0 };
        cur.sumPerf += r.performance_index ?? 0;
        cur.sumAcc += r.accuracy_score ?? 0;
        cur.count += 1;
        map.set(k, cur);
    }

    const items = [...map.entries()]
        .map(([name, v]) => ({ name, perf: v.sumPerf / v.count, acc: v.sumAcc / v.count }))
        .sort((a, b) => b.perf - a.perf)
        .slice(0, 6);

    tbody.innerHTML = "";
    for (const it of items) {
        const tr = document.createElement("tr");
        tr.innerHTML = `
      <td>${it.name}</td>
      <td class="text-end">${it.perf.toFixed(4)}</td>
      <td class="text-end">${it.acc.toFixed(4)}</td>
    `;
        tbody.appendChild(tr);
    }
}

// Fill filter dropdowns once
function ensureFilters(rows) {
    const taskSel = $("filterTask");
    const envSel = $("filterEnv");

    if (taskSel.options.length === 1) {
        const tasks = [...new Set(rows.map(r => r.task_category).filter(Boolean))].sort();
        for (const t of tasks) {
            const opt = document.createElement("option");
            opt.value = t;
            opt.textContent = t;
            taskSel.appendChild(opt);
        }
    }

    if (envSel.options.length === 1) {
        const envs = [...new Set(rows.map(r => r.deployment_environment).filter(Boolean))].sort();
        for (const e of envs) {
            const opt = document.createElement("option");
            opt.value = e;
            opt.textContent = e;
            envSel.appendChild(opt);
        }
    }
}

// Return filtered dataset
function getFilteredRows() {
    const task = $("filterTask").value;
    const env = $("filterEnv").value;

    return rawRows.filter(r => {
        const okTask = task === "__all__" ? true : r.task_category === task;
        const okEnv = env === "__all__" ? true : r.deployment_environment === env;
        return okTask && okEnv;
    });
}

// ===================== Charts (Exploration) =====================

function renderExplorationCharts(rows) {
    applyChartDefaults();

    // Destroy old charts
    destroyChart("autonomySuccess");
    destroyChart("cpuLine");
    destroyChart("bubble");

    // Figure 1: Autonomy -> Success (bar)
    const s = groupAvg(rows, "autonomy_level", "success_rate");
    chartRefs.autonomySuccess = new Chart($("chartAutonomySuccess"), {
        type: "bar",
        data: {
            labels: s.labels,
            datasets: [{ label: "Avg success rate", data: s.values, borderRadius: 12 }]
        },
        options: {
            ...baseOptions(),
            scales: {
                ...baseOptions().scales,
                y: { ...baseOptions().scales.y, min: 0, max: 1, title: { display: true, text: "Success rate (0–1)" } },
                x: { ...baseOptions().scales.x, title: { display: true, text: "Autonomy level" } }
            }
        }
    });

    // Figure 2: Complexity -> CPU (line)
    const c = groupAvg(rows, "task_complexity", "cpu_usage_percent");
    chartRefs.cpuLine = new Chart($("chartCpuLine"), {
        type: "line",
        data: {
            labels: c.labels,
            datasets: [{
                label: "Avg CPU usage (%)",
                data: c.values,
                borderWidth: 2,
                tension: 0.25,
                pointRadius: 3,
                pointHoverRadius: 4,
                fill: true
            }]
        },
        options: {
            ...baseOptions(),
            scales: {
                ...baseOptions().scales,
                y: { ...baseOptions().scales.y, beginAtZero: true, title: { display: true, text: "CPU usage (%)" } },
                x: { ...baseOptions().scales.x, title: { display: true, text: "Task complexity" } }
            }
        }
    });

    // Figure 3: Bubble (complexity vs time, size=accuracy)
    const bubbles = rows.map(r => {
        if (r.task_complexity == null || r.execution_time_seconds == null || r.accuracy_score == null) return null;
        return {
            x: r.task_complexity,
            y: r.execution_time_seconds,
            r: 3 + Math.max(0, Math.min(1, r.accuracy_score)) * 10,
            _acc: r.accuracy_score
        };
    }).filter(Boolean);

    chartRefs.bubble = new Chart($("chartBubble"), {
        type: "bubble",
        data: { datasets: [{ label: "Tasks (bubble size = accuracy)", data: bubbles }] },
        options: {
            ...baseOptions(),
            scales: {
                x: { ...baseOptions().scales.x, title: { display: true, text: "Task complexity (X)" } },
                y: { ...baseOptions().scales.y, title: { display: true, text: "Execution time (seconds) (Y)" } }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const p = ctx.raw;
                            return `Complexity ${p.x}, Time ${Number(p.y).toFixed(2)}s, Accuracy ${Number(p._acc).toFixed(3)}`;
                        }
                    }
                }
            }
        }
    });
}

// ===================== ML Charts (Regression + Custom Boxplot) =====================

// Simple OLS regression: accuracy ~ complexity + cost + time
function fitRegression(rows) {
    const X = [];
    const y = [];

    for (const r of rows) {
        if (r.task_complexity == null || r.cost_per_task_cents == null || r.execution_time_seconds == null || r.accuracy_score == null) continue;
        X.push([1, r.task_complexity, r.cost_per_task_cents, r.execution_time_seconds]);
        y.push(r.accuracy_score);
    }

    // Matrix helpers (small 4x4)
    const transpose = (A) => A[0].map((_, j) => A.map(row => row[j]));
    const mulMat = (A, B) => {
        const r = A.length, k = A[0].length, c = B[0].length;
        const out = Array.from({ length: r }, () => Array(c).fill(0));
        for (let i = 0; i < r; i++) for (let t = 0; t < k; t++) for (let j = 0; j < c; j++) out[i][j] += A[i][t] * B[t][j];
        return out;
    };
    const invertMatrix = (A) => {
        const n = A.length;
        const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);

        for (let i = 0; i < n; i++) {
            let pivot = M[i][i];
            if (Math.abs(pivot) < 1e-12) {
                let swap = i + 1;
                while (swap < n && Math.abs(M[swap][i]) < 1e-12) swap++;
                if (swap === n) throw new Error("Matrix not invertible");
                [M[i], M[swap]] = [M[swap], M[i]];
                pivot = M[i][i];
            }

            for (let j = 0; j < 2 * n; j++) M[i][j] /= pivot;

            for (let r = 0; r < n; r++) {
                if (r === i) continue;
                const factor = M[r][i];
                for (let c = 0; c < 2 * n; c++) M[r][c] -= factor * M[i][c];
            }
        }

        return M.map(row => row.slice(n));
    };

    // Compute beta = (X'X)^-1 X'y
    const Xt = transpose(X);
    const XtX = mulMat(Xt, X);
    const XtX_inv = invertMatrix(XtX);
    const yCol = y.map(v => [v]);
    const Xty = mulMat(Xt, yCol);
    const beta = mulMat(XtX_inv, Xty).map(b => b[0]); // [b0,b1,b2,b3]

    const yhat = X.map(row => row.reduce((s, x, i) => s + x * beta[i], 0));

    const yMean = y.reduce((a, b) => a + b, 0) / y.length;
    const ssTot = y.reduce((s, v) => s + (v - yMean) ** 2, 0);
    const ssRes = y.reduce((s, v, i) => s + (v - yhat[i]) ** 2, 0);
    const r2 = 1 - ssRes / ssTot;

    return { beta, y, yhat, r2 };
}

// Custom plugin that draws boxplots on a category chart
function makeBoxplotPlugin(stats) {
    return {
        id: "customBoxplotDrawer",
        afterDatasetsDraw(chart) {
            const { ctx, scales } = chart;
            const x = scales.x;
            const y = scales.y;

            ctx.save();

            // Visual style (don’t overdo)
            ctx.strokeStyle = "rgba(17,24,39,0.65)";
            ctx.lineWidth = 1.4;
            ctx.fillStyle = "rgba(59,130,246,0.18)";

            const boxWidth = Math.max(10, x.getPixelForTick(1) - x.getPixelForTick(0)) * 0.7;

            for (let i = 0; i < stats.length; i++) {
                const s = stats[i];
                const cx = x.getPixelForTick(i);

                const yQ1 = y.getPixelForValue(s.q1);
                const yMed = y.getPixelForValue(s.med);
                const yQ3 = y.getPixelForValue(s.q3);
                const yMin = y.getPixelForValue(s.min);
                const yMax = y.getPixelForValue(s.max);

                // Box
                const top = Math.min(yQ3, yQ1);
                const height = Math.abs(yQ3 - yQ1);
                ctx.fillRect(cx - boxWidth / 2, top, boxWidth, height);
                ctx.strokeRect(cx - boxWidth / 2, top, boxWidth, height);

                // Median line
                ctx.beginPath();
                ctx.moveTo(cx - boxWidth / 2, yMed);
                ctx.lineTo(cx + boxWidth / 2, yMed);
                ctx.stroke();

                // Whiskers
                ctx.beginPath();
                ctx.moveTo(cx, yQ3);
                ctx.lineTo(cx, yMax);
                ctx.moveTo(cx, yQ1);
                ctx.lineTo(cx, yMin);
                ctx.stroke();

                // Whisker caps
                ctx.beginPath();
                ctx.moveTo(cx - boxWidth * 0.25, yMax);
                ctx.lineTo(cx + boxWidth * 0.25, yMax);
                ctx.moveTo(cx - boxWidth * 0.25, yMin);
                ctx.lineTo(cx + boxWidth * 0.25, yMin);
                ctx.stroke();

                // Outliers
                ctx.fillStyle = "rgba(17,24,39,0.45)";
                for (const v of s.outliers) {
                    const oy = y.getPixelForValue(v);
                    ctx.beginPath();
                    ctx.arc(cx, oy, 2.2, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.fillStyle = "rgba(59,130,246,0.22)";
            }

            ctx.restore();
        }
    };
}

function renderMlCharts(rows) {
    applyChartDefaults();

    // Destroy old ML charts
    destroyChart("mlCoefficients");
    destroyChart("mlBoxplot");
    destroyChart("mlPredActual");

    // Regression
    const { beta, y, yhat, r2 } = fitRegression(rows);

    // Coefficients bar (exclude intercept)
    chartRefs.mlCoefficients = new Chart($("mlCoefficients"), {
        type: "bar",
        data: {
            labels: ["task_complexity", "cost_per_task_cents", "execution_time_seconds"],
            datasets: [{
                label: "Coefficient value",
                data: [beta[1], beta[2], beta[3]],
                borderRadius: 12
            }]
        },
        options: {
            ...baseOptions(),
            indexAxis: "y",
            plugins: { legend: { display: false } },
            scales: {
                x: { ...baseOptions().scales.x, title: { display: true, text: "Coefficient value" } },
                y: { ...baseOptions().scales.y, grid: { display: false } }
            }
        }
    });

    // Boxplot chart (we use a dummy dataset + custom plugin to draw)
    const { labels, stats } = buildBoxplotStats(rows);

    chartRefs.mlBoxplot = new Chart($("mlBoxplot"), {
        type: "bar",
        data: {
            labels,
            datasets: [{
                label: "hidden",
                data: labels.map(() => 0),
                backgroundColor: "rgba(0,0,0,0)",
                borderColor: "rgba(0,0,0,0)"
            }]
        },
        options: {
            ...baseOptions(),
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false }, title: { display: true, text: "Complexity level (1–10)" } },
                y: { min: 0, max: 1, title: { display: true, text: "Accuracy" } }
            }
        },
        plugins: [makeBoxplotPlugin(stats)]
    });

    // Predicted vs Actual (scatter + ideal line)
    const n = y.length;
    const sampleN = Math.min(900, n);
    const step = Math.max(1, Math.floor(n / sampleN));

    const pts = [];
    for (let i = 0; i < n; i += step) pts.push({ x: yhat[i], y: y[i] });

    const minV = Math.min(...pts.map(p => Math.min(p.x, p.y)));
    const maxV = Math.max(...pts.map(p => Math.max(p.x, p.y)));

    const titleEl = $("mlTitle");
    titleEl.textContent = `Regression Results: Predicted vs Actual (R² = ${r2.toFixed(3)})`;

    chartRefs.mlPredActual = new Chart($("mlPredActual"), {
        type: "scatter",
        data: {
            datasets: [
                {
                    label: "Observations",
                    data: pts,
                    pointRadius: 2,
                    pointHoverRadius: 3
                },
                { label: "Ideal line", type: "line", data: [{ x: minV, y: minV }, { x: maxV, y: maxV }], borderWidth: 2, pointRadius: 0 }
            ]
        },
        options: {
            ...baseOptions(),
            scales: {
                x: { min: 0, max: 1, title: { display: true, text: "Predicted accuracy" } },
                y: { min: 0, max: 1, title: { display: true, text: "Actual accuracy" } }
            }
        }
    });
}

// ===================== Rendering pipeline =====================

// Re-render everything (called on load + on filter changes)
function renderAll() {
    const rows = getFilteredRows();
    renderKpis(rows);
    renderTopModels(rows);
    renderExplorationCharts(rows);
    renderMlCharts(rows);
}

// ===================== Event wiring =====================

function wireUi() {
    // Close offcanvas on mobile when clicking a link
    document.querySelectorAll("[data-close-offcanvas]").forEach(a => {
        a.addEventListener("click", () => {
            const el = document.getElementById("mobileNav");
            if (!el) return;
            bootstrap.Offcanvas.getOrCreateInstance(el).hide();
        });
    });

    // Filters
    $("filterTask").addEventListener("change", renderAll);
    $("filterEnv").addEventListener("change", renderAll);

    $("resetFilters").addEventListener("click", () => {
        $("filterTask").value = "__all__";
        $("filterEnv").value = "__all__";
        renderAll();
    });
}

// ===================== Section highlight (nav click) =====================
(function enableSectionHighlight() {
    const HOLD_MS = 2000;
    const FADE_MS = 480;

    function highlightSection(id) {
        const el = document.getElementById(id);
        if (!el) return;

        el.classList.remove("section-highlight", "fade-out");
        void el.offsetWidth;

        el.classList.add("section-highlight");
        setTimeout(() => el.classList.add("fade-out"), Math.max(0, HOLD_MS - FADE_MS));
        setTimeout(() => el.classList.remove("section-highlight", "fade-out"), HOLD_MS);

        if (history.replaceState) {
            history.replaceState(null, "", window.location.pathname + window.location.search);
        }
    }

    document.addEventListener("click", (e) => {
        const a = e.target.closest('a[href^="#"]');
        if (!a) return;
        const id = decodeURIComponent(a.getAttribute("href").slice(1));
        if (!id) return;
        setTimeout(() => highlightSection(id), 70);
    });

    window.addEventListener("load", () => {
        const id = decodeURIComponent((location.hash || "").slice(1));
        if (id) setTimeout(() => highlightSection(id), 90);
    });
})();

// ===================== Load CSV =====================

function loadCsv() {
    Papa.parse(CSV_PATH, {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: ({ data }) => {
            // Map only fields we actually use
            rawRows = data.map(r => ({
                model_architecture: r.model_architecture,
                deployment_environment: r.deployment_environment,
                task_category: r.task_category,

                task_complexity: toNum(r.task_complexity),
                autonomy_level: toNum(r.autonomy_level),
                success_rate: toNum(r.success_rate),
                accuracy_score: toNum(r.accuracy_score),

                execution_time_seconds: toNum(r.execution_time_seconds),
                cpu_usage_percent: toNum(r.cpu_usage_percent),
                cost_per_task_cents: toNum(r.cost_per_task_cents),

                performance_index: toNum(r.performance_index)
            })).filter(r =>
                r.task_complexity != null &&
                r.autonomy_level != null &&
                r.success_rate != null &&
                r.accuracy_score != null &&
                r.execution_time_seconds != null &&
                r.cpu_usage_percent != null &&
                r.cost_per_task_cents != null
            );

            ensureFilters(rawRows);
            wireUi();
            renderAll();
        }
    });
}

loadCsv();