// One audit: progress while running, then scores and the full report with filters, and a button to fix the problems

const auditId = getPageParam("id");
const auditSummary = document.getElementById("audit-summary");
const reportCard = document.getElementById("report-card");
const pageTabs = document.getElementById("page-tabs");
const categoryChips = document.getElementById("category-chips");
const severityChips = document.getElementById("severity-chips");
const issueSearch = document.getElementById("issue-search");
const issueCount = document.getElementById("issue-count");
const pageNote = document.getElementById("page-note");
const issueList = document.getElementById("issue-list");

const CATEGORY_NAMES = {
    performance: "Performance",
    accessibility: "Accessibility",
    bestPractices: "Best practices",
    seo: "SEO"
};
const SEVERITY_NAMES = { high: "High", medium: "Medium", low: "Low" };

let auditReport = null;
// What the user picked in the report filters. "all" means no filter.
const reportFilters = { pageIndex: "all", category: "all", severity: "all", searchText: "" };

function summaryHtml(audit) {
    const scores = audit.siteScores || {};
    const target = audit.siteUrl || audit.folderPath;
    const targetIcon = audit.siteUrl ? "🌐" : "📁";
    const isActive = audit.status === "queued" || audit.status === "running";

    let statusHtml = "";
    if (isActive) {
        statusHtml = `
            <div style="margin-top: 16px">
                <b>${escapeHtml(audit.progress || "Starting")}</b>
                <p class="muted">Audits take a few seconds per page. This page updates by itself.</p>
                <div class="progress"><span></span></div>
            </div>`;
    }
    if (audit.status === "failed") {
        statusHtml = `
            <p class="message error">${escapeHtml(audit.error)}</p>
            <div class="actions" style="margin-top: 12px"><button id="rerun-button">Try again</button></div>`;
    }

    let scoresHtml = "";
    let actionsHtml = "";
    if (audit.status === "completed") {
        const reportPath = `/api/audits/${encodeURIComponent(audit.auditId)}`;
        scoresHtml = `
            <div class="score-grid" style="margin-top: 22px">
                <div class="score-tile">${scoreRingHtml(scores.overall, "large")}<span>Site score</span></div>
                <div class="score-divider"></div>
                <div class="score-tile">${scoreRingHtml(scores.performance)}<span>Performance</span></div>
                <div class="score-tile">${scoreRingHtml(scores.accessibility)}<span>Accessibility</span></div>
                <div class="score-tile">${scoreRingHtml(scores.bestPractices)}<span>Best practices</span></div>
                <div class="score-tile">${scoreRingHtml(scores.seo)}<span>SEO</span></div>
            </div>
            <p class="muted" style="margin-top: 14px">
                <span class="score good">●</span> 90–100 good &nbsp;
                <span class="score needs-work">●</span> 50–89 needs work &nbsp;
                <span class="score poor">●</span> 0–49 poor
            </p>`;
        actionsHtml = `
            <div class="actions" style="margin-top: 18px">
                <a class="button" href="fix.html?auditId=${encodeURIComponent(audit.auditId)}">🛠️ Fix these problems automatically</a>
                <button class="secondary" id="rerun-button">↻ Audit again</button>
                <a class="button secondary" href="${reportPath}/report.html" target="_blank" rel="noopener">Printable report</a>
                <a class="button secondary" href="${reportPath}/report.json">Download JSON</a>
            </div>`;
    }

    const detailParts = [formatDate(audit.createdAt)];
    if (audit.status === "completed") {
        detailParts.push(`${audit.pageCount} page(s)`, `${audit.issueCount} problem(s)`);
    }

    return `
        <div class="report-summary">
            <div class="report-target">
                <p style="margin-bottom: 6px"><span class="badge ${audit.status}">${audit.status}</span></p>
                <h1>${targetIcon} ${escapeHtml(target)}</h1>
                <p class="muted">${detailParts.join(" · ")}</p>
            </div>
        </div>
        ${statusHtml}
        ${scoresHtml}
        ${actionsHtml}
        <p id="action-message" class="message"></p>`;
}

// ---------- Report ----------

// Issues of the chosen page, or of every page (each issue remembers its page)
function getIssuesForPage() {
    const chosenIssues = [];

    auditReport.pages.forEach((auditedPage, pageIndex) => {
        if (reportFilters.pageIndex !== "all" && reportFilters.pageIndex !== pageIndex) {
            return;
        }
        for (const issue of auditedPage.issues) {
            chosenIssues.push({ ...issue, pageUrl: auditedPage.url });
        }
    });

    return chosenIssues;
}

function countBy(issues, fieldName) {
    const counts = {};
    for (const issue of issues) {
        counts[issue[fieldName]] = (counts[issue[fieldName]] || 0) + 1;
    }
    return counts;
}

function chipHtml(filterName, value, label, count) {
    const isActive = reportFilters[filterName] === value;
    return `<button type="button" class="chip ${isActive ? "active" : ""}" data-filter="${filterName}" data-value="${value}">${label}<span class="count">${count}</span></button>`;
}

function issueHtml(issue, showPage) {
    const elementsHtml = issue.elements.length === 0
        ? ""
        : `<div class="elements-title">Where on the page (${issue.elements.length})</div><pre>${issue.elements.map(escapeHtml).join("\n\n")}</pre>`;
    const exampleHtml = issue.fix.example ? `<pre>${escapeHtml(issue.fix.example)}</pre>` : "";
    const autoFixTag = issue.fix.autoFixable ? `<span class="tag auto">auto-fix</span>` : "";
    const pageHtml = showPage ? `<p class="faint break" style="font-size: 12px">Page: ${escapeHtml(issue.pageUrl)}</p>` : "";

    return `
        <details class="issue">
            <summary>
                <span class="tag ${issue.severity}">${SEVERITY_NAMES[issue.severity] || issue.severity}</span>
                <span class="issue-title">${escapeHtml(issue.title)}</span>
                ${autoFixTag}
                <span class="issue-value">${escapeHtml(issue.displayValue)}</span>
                <span class="issue-cat">${CATEGORY_NAMES[issue.category] || escapeHtml(issue.category)}</span>
                <span class="toggle">›</span>
            </summary>
            <div class="issue-body">
                ${pageHtml}
                <p>${linkifyText(issue.description)}</p>
                <div class="how-to-fix">
                    <b>How to fix</b>
                    <p>${linkifyText(issue.fix.howToFix)}</p>
                    ${exampleHtml}
                </div>
                ${elementsHtml}
            </div>
        </details>`;
}

function showReport() {
    const pageCount = auditReport.pages.length;

    // Page tabs, only when more than one page was audited
    pageTabs.hidden = pageCount < 2;
    if (pageCount > 1) {
        const tabButtons = [`<button type="button" class="page-tab ${reportFilters.pageIndex === "all" ? "active" : ""}" data-page="all">All pages</button>`];
        auditReport.pages.forEach((auditedPage, pageIndex) => {
            const pagePath = new URL(auditedPage.url).pathname;
            tabButtons.push(`
                <button type="button" class="page-tab ${reportFilters.pageIndex === pageIndex ? "active" : ""}" data-page="${pageIndex}" title="${escapeHtml(auditedPage.url)}">
                    ${scoreHtml(auditedPage.score)} <span class="tab-label">${escapeHtml(pagePath)}</span>
                </button>`);
        });
        pageTabs.innerHTML = tabButtons.join("");
    }

    const pageIssues = getIssuesForPage();

    // Category chips count the issues of the chosen page; severity chips also follow the chosen category
    const categoryCounts = countBy(pageIssues, "category");
    const categoryButtons = [chipHtml("category", "all", "All", pageIssues.length)];
    for (const categoryName of Object.keys(CATEGORY_NAMES)) {
        if (categoryCounts[categoryName]) {
            categoryButtons.push(chipHtml("category", categoryName, CATEGORY_NAMES[categoryName], categoryCounts[categoryName]));
        }
    }
    categoryChips.innerHTML = categoryButtons.join("");

    const categoryIssues = pageIssues.filter(issue => reportFilters.category === "all" || issue.category === reportFilters.category);
    const severityCounts = countBy(categoryIssues, "severity");
    const severityButtons = [chipHtml("severity", "all", "Any severity", categoryIssues.length)];
    for (const severityName of Object.keys(SEVERITY_NAMES)) {
        if (severityCounts[severityName]) {
            severityButtons.push(chipHtml("severity", severityName, SEVERITY_NAMES[severityName], severityCounts[severityName]));
        }
    }
    severityChips.innerHTML = severityButtons.join("");

    const searchText = reportFilters.searchText.toLowerCase();
    const shownIssues = categoryIssues.filter(issue => {
        if (reportFilters.severity !== "all" && issue.severity !== reportFilters.severity) {
            return false;
        }
        if (!searchText) {
            return true;
        }
        return `${issue.title} ${issue.description} ${issue.displayValue}`.toLowerCase().includes(searchText);
    });

    issueCount.textContent = `${shownIssues.length} of ${auditReport.issueCount} shown`;

    // A page that could not be audited says why
    const chosenPage = reportFilters.pageIndex === "all" ? null : auditReport.pages[reportFilters.pageIndex];
    pageNote.innerHTML = chosenPage && chosenPage.status === "failed"
        ? `<p class="page-failed">This page could not be audited: ${escapeHtml(chosenPage.error)}</p>`
        : "";

    if (shownIssues.length === 0) {
        const emptyText = pageIssues.length === 0 ? "No problems found. Great work! 🎉" : "No problems match these filters.";
        issueList.innerHTML = `<div class="empty-state"><div class="empty-icon">✅</div><b>${emptyText}</b></div>`;
        return;
    }

    const showPage = reportFilters.pageIndex === "all" && pageCount > 1;
    issueList.innerHTML = shownIssues.map(issue => issueHtml(issue, showPage)).join("");
}

pageTabs.addEventListener("click", (event) => {
    const tabButton = event.target.closest(".page-tab");
    if (!tabButton) {
        return;
    }
    reportFilters.pageIndex = tabButton.dataset.page === "all" ? "all" : Number(tabButton.dataset.page);
    reportFilters.category = "all";
    reportFilters.severity = "all";
    showReport();
});

function onChipClick(event) {
    const chipButton = event.target.closest(".chip");
    if (!chipButton) {
        return;
    }
    reportFilters[chipButton.dataset.filter] = chipButton.dataset.value;
    if (chipButton.dataset.filter === "category") {
        reportFilters.severity = "all";
    }
    showReport();
}

categoryChips.addEventListener("click", onChipClick);
severityChips.addEventListener("click", onChipClick);

issueSearch.addEventListener("input", () => {
    reportFilters.searchText = issueSearch.value.trim();
    showReport();
});

// The report file has no "status" field, so we read it with fetch instead of callApi
async function fetchReport() {
    const reportResponse = await fetch(`/api/audits/${encodeURIComponent(auditId)}/report.json`);
    const reportBody = await reportResponse.json();

    if (!reportResponse.ok) {
        throw new Error(reportBody.message || "Report is not ready yet");
    }
    return reportBody;
}

// ---------- Audit status ----------

function connectRerunButton(audit) {
    const rerunButton = document.getElementById("rerun-button");
    if (!rerunButton) {
        return;
    }

    rerunButton.addEventListener("click", async () => {
        rerunButton.disabled = true;
        try {
            const apiResult = audit.siteUrl
                ? await postJson("/api/audits", { siteUrl: audit.siteUrl, maxPages: audit.maxPages })
                : await postJson("/api/audits/folder", { folderPath: audit.folderPath });
            window.location.href = `audit.html?id=${encodeURIComponent(apiResult.audit.auditId)}`;
        } catch (error) {
            showMessage(document.getElementById("action-message"), error.message, "error");
            rerunButton.disabled = false;
        }
    });
}

async function loadAudit() {
    try {
        const apiResult = await callApi(`/api/audits/${encodeURIComponent(auditId)}`);
        const audit = apiResult.audit;
        auditSummary.innerHTML = summaryHtml(audit);
        connectRerunButton(audit);

        if (audit.status === "queued" || audit.status === "running") {
            setTimeout(loadAudit, 3000);
            return;
        }

        if (audit.status === "completed" && !auditReport) {
            try {
                auditReport = await fetchReport();
                if (auditReport.pages.length === 1) {
                    reportFilters.pageIndex = 0;
                }
                reportCard.hidden = false;
                showReport();
            } catch (error) {
                reportCard.hidden = false;
                issueList.innerHTML = `<p class="message error">Could not load the report: ${escapeHtml(error.message)}</p>`;
            }
        }
    } catch (error) {
        auditSummary.innerHTML = `<p class="message error">${escapeHtml(error.message)}</p>`;
    }
}

async function startAuditPage() {
    await startPage("audits");

    if (!auditId) {
        auditSummary.innerHTML = `<p class="message error">No audit selected. <a href="/">Go back</a></p>`;
        return;
    }

    await loadAudit();
}

startAuditPage();
