const CSV_PATH = "data/agentic_ai_performance_dataset_20250622.csv";

function toNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null; }

function groupAvg(rows, xKey, yKey) {
    const map = new Map();
    for (const r of rows) {
        const x = r[xKey], y = r[yKey];
        if (x == null || y == null) continue;
        const cur = map.get(x) || { sum: 0, count: 0 };
        cur.sum += y; cur.count += 1;
        map.set(x, cur);
    }
    const labels = [...map.keys()].sort((a, b) => a - b).map(String);
    const values = labels.map(l => {
        const v = map.get(Number(l));
        return +(v.sum / v.count).toFixed(3);
    });
    return { labels, values };
}

function renderKpis(rows) {
    document.getElementById("kpiRows").textContent = `${rows.length.toLocaleString()} rows`;
    document.getElementById("kpiCols").textContent = `26 columns`;

    const acc = mean(rows.map(r => r.accuracy_score).filter(v => v != null));
    const cost = mean(rows.map(r => r.cost_per_task_cents).filter(v => v != null));
    const time = mean(rows.map(r => r.execution_time_seconds).filter(v => v != null));
    const cpu = mean(rows.map(r => r.cpu_usage_percent).filter(v => v != null));

    document.getElementById("kpiAcc").textContent = acc != null ? acc.toFixed(3) : "—";
    document.getElementById("kpiCost").textContent = cost != null ? `${cost.toFixed(3)}¢` : "—";
    document.getElementById("kpiTime").textContent = time != null ? `${time.toFixed(2)} s` : "—";
    document.getElementById("kpiCpu").textContent = cpu != null ? `${cpu.toFixed(1)}%` : "—";
}

function renderTopModels(rows) {
    const tbody = document.getElementById("topModelsTable");
    const map = new Map();

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

/* Simple regression: accuracy ~ complexity + cost + time */
function fitRegression(rows) {
    const X = [], y = [];
    for (const r of rows) {
        if (r.task_complexity == null || r.cost_per_task_cents == null || r.execution_time_seconds == null || r.accuracy_score == null) continue;
        X.push([1, r.task_complexity, r.cost_per_task_cents, r.execution_time_seconds]);
        y.push(r.accuracy_score);
    }

    const T = (A) => A[0].map((_, j) => A.map(r => r[j]));
    const mul = (A, B) => {
        const out = Array.from({ length: A.length }, () => Array(B[0].length).fill(0));
        for (let i = 0; i < A.length; i++) for (let k = 0; k < A[0].length; k++) for (let j = 0; j < B[0].length; j++) out[i][j] += A[i][k] * B[k][j];
        return out;
    };
    const inv = (A) => {
        const n = A.length;
        const M = A.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => i === j ? 1 : 0)]);
        for (let i = 0; i < n; i++) {
            let p = M[i][i];
            if (Math.abs(p) < 1e-12) {
                let s = i + 1; while (s < n && Math.abs(M[s][i]) < 1e-12) s++;
                if (s === n) throw new Error("Matrix not invertible");
                [M[i], M[s]] = [M[s], M[i]];
                p = M[i][i];
            }
            for (let j = 0; j < 2 * n; j++) M[i][j] /= p;
            for (let r = 0; r < n; r++) {
                if (r === i) continue;
                const f = M[r][i];
                for (let c = 0; c < 2 * n; c++) M[r][c] -= f * M[i][c];
            }
        }
        return M.map(row => row.slice(n));
    };

    const Xt = T(X);
    const beta = mul(mul(inv(mul(Xt, X)), Xt), y.map(v => [v])).map(b => b[0]);
    const yhat = X.map(row => row.reduce((s, x, i) => s + x * beta[i], 0));

    const yMean = y.reduce((a, b) => a + b, 0) / y.length;
    const ssTot = y.reduce((s, v) => s + (v - yMean) ** 2, 0);
    const ssRes = y.reduce((s, v, i) => s + (v - yhat[i]) ** 2, 0);
    const r2 = 1 - ssRes / ssTot;

    return { beta, y, yhat, r2 };
}

function renderCharts(rows) {
    Chart.defaults.font.family = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;

    const grid = "rgba(17,24,39,0.10)";

    // Chart 1
    const s = groupAvg(rows, "autonomy_level", "success_rate");
    new Chart(document.getElementById("chartAutonomySuccess"), {
        type: "bar",
        data: { labels: s.labels, datasets: [{ label: "Avg success rate", data: s.values, borderRadius: 10 }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { x: { grid: { color: grid } }, y: { grid: { color: grid }, min: 0, max: 1 } }
        }
    });

    // Chart 2
    const c = groupAvg(rows, "task_complexity", "cpu_usage_percent");
    new Chart(document.getElementById("chartCpuLine"), {
        type: "line",
        data: { labels: c.labels, datasets: [{ label: "Avg CPU (%)", data: c.values, borderWidth: 2, tension: .25, fill: true }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { x: { grid: { color: grid } }, y: { grid: { color: grid }, beginAtZero: true } }
        }
    });

    // Chart 3 bubble
    const pts = rows.map(r => {
        if (r.task_complexity == null || r.execution_time_seconds == null || r.accuracy_score == null) return null;
        return { x: r.task_complexity, y: r.execution_time_seconds, r: 3 + Math.max(0, Math.min(1, r.accuracy_score)) * 10 };
    }).filter(Boolean);

    new Chart(document.getElementById("chartBubble"), {
        type: "bubble",
        data: { datasets: [{ label: "Tasks", data: pts }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                x: { grid: { color: grid }, title: { display: true, text: "Task complexity" } },
                y: { grid: { color: grid }, title: { display: true, text: "Execution time (s)" } }
            }
        }
    });

    //  ML
    const { beta, y, yhat, r2 } = fitRegression(rows);

    // ML 1 coefficients
    new Chart(document.getElementById("mlCoefficients"), {
        type: "bar",
        data: {
            labels: ["task_complexity", "cost_per_task_cents", "execution_time_seconds"],
            datasets: [{ label: "Coefficient", data: [beta[1], beta[2], beta[3]], borderRadius: 10 }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            indexAxis: "y",
            plugins: { legend: { display: false } },
            scales: { x: { grid: { color: grid }, title: { display: true, text: "Coefficient value" } }, y: { grid: { display: false } } }
        }
    });

    // ML 2 avg accuracy by complexity
    const accC = groupAvg(rows, "task_complexity", "accuracy_score");
    new Chart(document.getElementById("mlAccByComplexity"), {
        type: "line",
        data: { labels: accC.labels, datasets: [{ label: "Avg accuracy", data: accC.values, borderWidth: 2, tension: .25, pointRadius: 3 }] },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                x: { grid: { color: grid }, title: { display: true, text: "Complexity" } },
                y: { grid: { color: grid }, min: 0, max: 1, title: { display: true, text: "Accuracy (0–1)" } }
            }
        }
    });

    // ML 3 predicted vs actual
    const n = y.length;
    const sampleN = Math.min(1000, n);
    const step = Math.max(1, Math.floor(n / sampleN));
    const scatter = [];
    for (let i = 0; i < n; i += step) scatter.push({ x: yhat[i], y: y[i] });

    const minV = Math.min(...scatter.map(p => Math.min(p.x, p.y)));
    const maxV = Math.max(...scatter.map(p => Math.max(p.x, p.y)));

    document.getElementById("mlTitle").textContent = `Predicted vs Actual (R² = ${r2.toFixed(3)})`;

    new Chart(document.getElementById("mlPredActual"), {
        type: "scatter",
        data: {
            datasets: [
                { label: "Observations", data: scatter, pointRadius: 2, pointHoverRadius: 3 },
                { label: "Ideal line", type: "line", data: [{ x: minV, y: minV }, { x: maxV, y: maxV }], borderWidth: 2, pointRadius: 0 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                x: { grid: { color: grid }, min: 0, max: 1, title: { display: true, text: "Predicted accuracy" } },
                y: { grid: { color: grid }, min: 0, max: 1, title: { display: true, text: "Actual accuracy" } }
            }
        }
    });
}

function wireMobileNav() {
    document.querySelectorAll("[data-close-offcanvas]").forEach(a => {
        a.addEventListener("click", () => {
            const el = document.getElementById("mobileNav");
            if (!el) return;
            bootstrap.Offcanvas.getOrCreateInstance(el).hide();
        });
    });
}

Papa.parse(CSV_PATH, {
    download: true,
    header: true,
    skipEmptyLines: true,
    complete: ({ data }) => {
        const rows = data.map(r => ({
            model_architecture: r.model_architecture,
            task_complexity: toNum(r.task_complexity),
            autonomy_level: toNum(r.autonomy_level),
            success_rate: toNum(r.success_rate),
            accuracy_score: toNum(r.accuracy_score),
            execution_time_seconds: toNum(r.execution_time_seconds),
            cpu_usage_percent: toNum(r.cpu_usage_percent),
            cost_per_task_cents: toNum(r.cost_per_task_cents),
            performance_index: toNum(r.performance_index)
        })).filter(r =>
            r.task_complexity != null && r.autonomy_level != null && r.success_rate != null &&
            r.accuracy_score != null && r.execution_time_seconds != null && r.cpu_usage_percent != null &&
            r.cost_per_task_cents != null
        );

        renderKpis(rows);
        renderTopModels(rows);
        renderCharts(rows);
        wireMobileNav();
    }
});