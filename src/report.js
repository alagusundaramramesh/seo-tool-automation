import { getGrade } from "./scoring.js";

// Builds a single HTML file that anyone can open in a browser.
// No framework on purpose: it is just a template string.

function escapeHtml(text) {
    return String(text || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function scoreBadge(label, score) {
    const grade = getGrade(score);
    const shownScore = score === null || score === undefined ? "–" : score;
    return `<div class="score ${grade.replace(" ", "-")}"><b>${shownScore}</b><span>${label}</span></div>`;
}

function issueCard(issue) {
    const elementList = issue.elements.length === 0
        ? ""
        : `<details><summary>Where (${issue.elements.length})</summary><pre>${issue.elements.map(escapeHtml).join("\n\n")}</pre></details>`;

    const fixExample = issue.fix.example ? `<pre>${escapeHtml(issue.fix.example)}</pre>` : "";
    const autoFixBadge = issue.fix.autoFixable ? `<span class="tag auto">auto-fixable</span>` : "";

    return `
    <div class="issue">
        <div class="issue-head">
            <span class="tag ${issue.severity}">${issue.severity}</span>
            <span class="tag">${issue.category}</span>
            ${autoFixBadge}
            <b>${escapeHtml(issue.title)}</b> ${escapeHtml(issue.displayValue)}
        </div>
        <p>${escapeHtml(issue.description)}</p>
        <p class="fix"><b>How to fix:</b> ${escapeHtml(issue.fix.howToFix)}</p>
        ${fixExample}
        ${elementList}
    </div>`;
}

function pageSection(auditedPage) {
    const failedNote = auditedPage.status === "failed"
        ? `<p class="error">Audit failed: ${escapeHtml(auditedPage.error)}</p>`
        : "";

    return `
    <section class="page">
        <h2>${escapeHtml(auditedPage.url)}</h2>
        <p class="muted">${escapeHtml(auditedPage.title)} · ${auditedPage.issues.length} issue(s)</p>
        ${failedNote}
        <div class="scores">
            ${scoreBadge("Page score", auditedPage.score)}
            ${scoreBadge("Performance", auditedPage.categoryScores.performance)}
            ${scoreBadge("Accessibility", auditedPage.categoryScores.accessibility)}
            ${scoreBadge("Best practices", auditedPage.categoryScores.bestPractices)}
            ${scoreBadge("SEO", auditedPage.categoryScores.seo)}
        </div>
        ${auditedPage.issues.map(issueCard).join("")}
    </section>`;
}

export function buildHtmlReport(auditReport) {
    const siteScores = auditReport.siteScores;

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Yngo audit: ${escapeHtml(auditReport.siteUrl)}</title>
<style>
    body { font-family: system-ui, sans-serif; max-width: 960px; margin: 0 auto; padding: 16px; color: #1f2328; background: #f6f8fa; }
    h1 { margin-bottom: 4px; }
    h2 { font-size: 18px; word-break: break-all; margin-bottom: 4px; }
    .muted { color: #59636e; margin-top: 0; }
    .page { background: #fff; border: 1px solid #d1d9e0; border-radius: 8px; padding: 16px; margin: 16px 0; }
    .scores { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
    .score { border-radius: 8px; padding: 8px 12px; min-width: 90px; text-align: center; background: #eef1f4; }
    .score b { display: block; font-size: 24px; }
    .score span { font-size: 12px; }
    .good { background: #dafbe1; color: #116329; }
    .needs-work { background: #fff8c5; color: #7d4e00; }
    .poor { background: #ffebe9; color: #a40e26; }
    .issue { border-top: 1px solid #d1d9e0; padding: 10px 0; }
    .issue p { margin: 6px 0; }
    .tag { display: inline-block; font-size: 11px; padding: 2px 6px; border-radius: 4px; background: #eef1f4; margin-right: 4px; text-transform: uppercase; }
    .tag.high { background: #ffebe9; color: #a40e26; }
    .tag.medium { background: #fff8c5; color: #7d4e00; }
    .tag.low { background: #ddf4ff; color: #0550ae; }
    .tag.auto { background: #dafbe1; color: #116329; }
    .fix { color: #116329; }
    .error { color: #a40e26; }
    pre { background: #f6f8fa; padding: 8px; border-radius: 6px; overflow-x: auto; font-size: 12px; white-space: pre-wrap; }
</style>
</head>
<body>
    <h1>Website audit</h1>
    <p class="muted">${escapeHtml(auditReport.siteUrl)} · ${auditReport.pageCount} page(s) · ${auditReport.issueCount} issue(s) · ${escapeHtml(auditReport.finishedAt)}</p>
    <div class="scores">
        ${scoreBadge("Site score", siteScores.overall)}
        ${scoreBadge("Performance", siteScores.performance)}
        ${scoreBadge("Accessibility", siteScores.accessibility)}
        ${scoreBadge("Best practices", siteScores.bestPractices)}
        ${scoreBadge("SEO", siteScores.seo)}
    </div>
    ${auditReport.pages.map(pageSection).join("")}
</body>
</html>`;
}
