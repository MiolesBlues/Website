// CSV path
const CSV_PATH = "data/agentic_ai_performance_dataset_20250622.csv";

const $ = (id) => document.getElementById(id);

let rawRows = [];
let charts = {
    autonomy: null,
    cpu: null,
    bubble: null
};

function toNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function mean(arr) {
    if (!arr.length) return null;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function groupAvgNumericKey(rows, key, valueKey) {
    // numeric x-axis keys (e.g., complexity 1..10)
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
    const values = labels.map((lab) => {
        const v = map.get(Number(lab));
        return +(v.sum / v.count).toFixed(3);
    });
    return { labels, values };
}

function topModelsTable(rows) {
    // top by mean performance_index
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
        .map(([k, v]) => ({
            name: k,
            perf: v.sumPerf / v.count,
            acc: v.sumAcc / v.count
        }))
        .sort((a, b) => b.perf - a.perf)
        .slice(0, 6);

    const tbody = $("topModelsTable");
    if (!tbody) return;

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

function setKpis(rows) {
    if ($("kpiRows")) $("kpiRows").textContent = `${rows.length.toLocaleString()} rows`;
    if ($("kpiCols")) $("kpiCols").textContent = `26 columns`;

    const acc = mean(rows.map(r => r.accuracy_score).filter(v => v != null));
    const cost = mean(rows.map(r => r.cost_per_task_cents).filter(v => v != null));
    const t = mean(rows.map(r => r.execution_time_seconds).filter(v => v != null));
    const cpu = mean(rows.map(r => r.cpu_usage_percent).filter(v => v != null));

    if ($("kpiAcc")) $("kpiAcc").textContent = acc != null ? acc.toFixed(3) : "—";
    if ($("kpiCost")) $("kpiCost").textContent = cost != null ? `${cost.toFixed(3)}¢` : "—";
    if ($("kpiTime")) $("kpiTime").textContent = t != null ? `${t.toFixed(2)} s` : "—";
    if ($("kpiCpu")) $("kpiCpu").textContent = cpu != null ? `${cpu.toFixed(1)}%` : "—";
}

function ensureFilters(rows) {
    const taskSel = $("filterTask");
    const envSel = $("filterEnv");
    if (!taskSel || !envSel) return;

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

function getFilteredRows() {
    const taskSel = $("filterTask");
    const envSel = $("filterEnv");
    const task = taskSel ? taskSel.value : "__all__";
    const env = envSel ? envSel.value : "__all__";

    return rawRows.filter(r => {
        const okTask = (task === "__all__") ? true : r.task_category === task;
        const okEnv = (env === "__all__") ? true : r.deployment_environment === env;
        return okTask && okEnv;
    });
}

function destroyCharts() {
    for (const k of Object.keys(charts)) {
        if (charts[k]) {
            charts[k].destroy();
            charts[k] = null;
        }
    }
}

function renderCharts(rows) {
    destroyCharts();

    // Global chart style
    Chart.defaults.font.family = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;

    const gridColor = "rgba(17,24,39,0.10)";
    const tooltip = {
        backgroundColor: "rgba(17,24,39,0.92)",
        titleColor: "#fff",
        bodyColor: "#fff",
        padding: 10
    };

    const base = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { tooltip },
        scales: {
            x: { grid: { color: gridColor } },
            y: { grid: { color: gridColor } }
        }
    };

    // ----------------------------------------------------------
    // FIGURE 1 — Column: Autonomy Level -> Success Rate (avg)
    // ----------------------------------------------------------
    const successAgg = groupAvgNumericKey(rows, "autonomy_level", "success_rate");

    const elAutonomy = $("chartAutonomySuccess");
    if (elAutonomy) {
        charts.autonomy = new Chart(elAutonomy, {
            type: "bar",
            data: {
                labels: successAgg.labels,
                datasets: [{
                    label: "Avg success rate",
                    data: successAgg.values,
                    borderRadius: 12
                }]
            },
            options: {
                ...base,
                scales: {
                    ...base.scales,
                    y: {
                        ...base.scales.y,
                        min: 0,
                        max: 1,
                        title: { display: true, text: "Success rate (0–1)" }
                    },
                    x: {
                        ...base.scales.x,
                        title: { display: true, text: "Autonomy level" }
                    }
                }
            }
        });
    }

    // ----------------------------------------------------------
    // FIGURE 2 — Line: Task Complexity -> CPU usage (avg)
    // ----------------------------------------------------------
    const cpuAgg = groupAvgNumericKey(rows, "task_complexity", "cpu_usage_percent");

    const elCpu = $("chartCpuLine");
    if (elCpu) {
        charts.cpu = new Chart(elCpu, {
            type: "line",
            data: {
                labels: cpuAgg.labels,
                datasets: [{
                    label: "Avg CPU usage (%)",
                    data: cpuAgg.values,
                    borderWidth: 2,
                    tension: 0.25,
                    pointRadius: 3,
                    pointHoverRadius: 4,
                    fill: true
                }]
            },
            options: {
                ...base,
                scales: {
                    ...base.scales,
                    y: {
                        ...base.scales.y,
                        beginAtZero: true,
                        title: { display: true, text: "CPU usage (%)" }
                    },
                    x: {
                        ...base.scales.x,
                        title: { display: true, text: "Task complexity" }
                    }
                }
            }
        });
    }

    // ----------------------------------------------------------
    // FIGURE 3 — Bubble: X=Complexity, Y=Time, Size=Accuracy
    // ----------------------------------------------------------
    // radius scaling (accuracy 0..1 -> radius 3..13)
    const bubbles = rows
        .map(r => {
            if (r.task_complexity == null || r.execution_time_seconds == null || r.accuracy_score == null) return null;
            const acc = r.accuracy_score;
            const radius = 3 + Math.max(0, Math.min(1, acc)) * 10;
            return { x: r.task_complexity, y: r.execution_time_seconds, r: radius, _acc: acc };
        })
        .filter(Boolean);

    const elBubble = $("chartBubble");
    if (elBubble) {
        charts.bubble = new Chart(elBubble, {
            type: "bubble",
            data: {
                datasets: [{
                    label: "Tasks (bubble size = accuracy)",
                    data: bubbles
                }]
            },
            options: {
                ...base,
                scales: {
                    x: {
                        grid: { color: gridColor },
                        title: { display: true, text: "Task complexity (X)" }
                    },
                    y: {
                        grid: { color: gridColor },
                        title: { display: true, text: "Execution time (seconds) (Y)" }
                    }
                },
                plugins: {
                    legend: { display: true },
                    tooltip: {
                        ...tooltip,
                        callbacks: {
                            label: (ctx) => {
                                const p = ctx.raw;
                                const acc = p._acc;
                                return `Complexity ${p.x}, Time ${Number(p.y).toFixed(3)}s, Accuracy ${Number(acc).toFixed(3)}`;
                            }
                        }
                    }
                }
            }
        });
    }
}

function wireUi() {
    // Mobile nav: close offcanvas when clicking (if exists)
    document.querySelectorAll("[data-close-offcanvas]").forEach(a => {
        a.addEventListener("click", () => {
            const el = document.getElementById("mobileNav");
            if (!el) return;
            bootstrap.Offcanvas.getOrCreateInstance(el).hide();
        });
    });

    const taskSel = $("filterTask");
    const envSel = $("filterEnv");
    const resetBtn = $("resetFilters");

    if (taskSel) {
        taskSel.addEventListener("change", () => {
            const rows = getFilteredRows();
            setKpis(rows);
            topModelsTable(rows);
            renderCharts(rows);
        });
    }

    if (envSel) {
        envSel.addEventListener("change", () => {
            const rows = getFilteredRows();
            setKpis(rows);
            topModelsTable(rows);
            renderCharts(rows);
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener("click", () => {
            if (taskSel) taskSel.value = "__all__";
            if (envSel) envSel.value = "__all__";
            const rows = getFilteredRows();
            setKpis(rows);
            topModelsTable(rows);
            renderCharts(rows);
        });
    }
}

function loadCsv() {
    Papa.parse(CSV_PATH, {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: ({ data }) => {
            rawRows = data.map(r => ({
                agent_id: r.agent_id,
                agent_type: r.agent_type,
                model_architecture: r.model_architecture,
                deployment_environment: r.deployment_environment,
                task_category: r.task_category,

                task_complexity: toNum(r.task_complexity),
                autonomy_level: toNum(r.autonomy_level),
                success_rate: toNum(r.success_rate),
                accuracy_score: toNum(r.accuracy_score),
                efficiency_score: toNum(r.efficiency_score),

                execution_time_seconds: toNum(r.execution_time_seconds),
                response_latency_ms: toNum(r.response_latency_ms),
                memory_usage_mb: toNum(r.memory_usage_mb),
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

            const rows = getFilteredRows();
            setKpis(rows);
            topModelsTable(rows);
            renderCharts(rows);
            wireUi();
        }
    });
}

loadCsv();

// ===== Smooth section highlight on anchor navigation =====
(function () {
    const HOLD_MS = 2000;
    const FADE_MS = 480;

    function highlightSection(id) {
        const el = document.getElementById(id);
        if (!el) return;

        el.classList.remove("section-highlight", "fade-out");
        void el.offsetWidth; // force reflow to restart

        el.classList.add("section-highlight");

        window.setTimeout(() => {
            el.classList.add("fade-out");
        }, Math.max(0, HOLD_MS - FADE_MS));

        window.setTimeout(() => {
            el.classList.remove("section-highlight", "fade-out");
        }, HOLD_MS);

        if (history.replaceState) {
            history.replaceState(null, "", window.location.pathname + window.location.search);
        }
    }

    document.addEventListener("click", (e) => {
        const a = e.target.closest('a[href^="#"]');
        if (!a) return;

        const href = a.getAttribute("href");
        const id = decodeURIComponent(href.slice(1));
        if (!id) return;

        setTimeout(() => highlightSection(id), 70);
    });

    window.addEventListener("load", () => {
        const id = decodeURIComponent((location.hash || "").slice(1));
        if (id) setTimeout(() => highlightSection(id), 90);
    });
})();