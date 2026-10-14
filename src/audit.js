import CONFIG from "./config.js";
import { crawlSite } from "./crawler.js";
import { startChrome, runLighthouse } from "./lighthouse.js";
import { runPageChecks, runSiteChecks, getPageTitle } from "./checks.js";
import { getFixSuggestion } from "./suggestions.js";
import { getPageScore, getSiteScores } from "./scoring.js";
import { buildHtmlReport } from "./report.js";
import { saveFile } from "./storage.js";

// Our own checks overlap with some Lighthouse audits.
// If Lighthouse already reported the problem, we drop our copy so the user does not see it twice.
const SAME_AS_LIGHTHOUSE_RULE = {
    "seo/missing-title": "lighthouse/document-title",
    "seo/missing-meta-description": "lighthouse/meta-description",
    "seo/missing-html-lang": "lighthouse/html-has-lang",
    "seo/missing-viewport": "lighthouse/viewport-insight",
    "seo/image-missing-alt": "lighthouse/image-alt"
};

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };

function removeDuplicateIssues(lighthouseIssues, checkIssues) {
    const lighthouseRuleIds = lighthouseIssues.map(issue => issue.ruleId);

    const uniqueCheckIssues = checkIssues.filter(checkIssue => {
        const sameLighthouseRule = SAME_AS_LIGHTHOUSE_RULE[checkIssue.ruleId];
        return !lighthouseRuleIds.includes(sameLighthouseRule);
    });

    return [...lighthouseIssues, ...uniqueCheckIssues];
}

async function auditPage(crawledPage, chrome) {
    const auditedPage = {
        url: crawledPage.url,
        title: getPageTitle(crawledPage.html),
        status: "audited",
        error: "",
        score: null,
        categoryScores: {},
        issues: []
    };

    const checkIssues = runPageChecks(crawledPage);

    // A page that returned 404/500 cannot be audited by Lighthouse
    if (crawledPage.statusCode !== 200) {
        auditedPage.status = "failed";
        auditedPage.error = `Page returned HTTP ${crawledPage.statusCode}`;
        auditedPage.issues = checkIssues;
        return auditedPage;
    }

    try {
        const lighthouseResult = await runLighthouse(crawledPage.url, chrome);
        auditedPage.categoryScores = lighthouseResult.scores;
        auditedPage.score = getPageScore(lighthouseResult.scores);
        auditedPage.issues = removeDuplicateIssues(lighthouseResult.issues, checkIssues);
    } catch (error) {
        console.error("Lighthouse failed for page", { pageUrl: crawledPage.url, reason: error.message });
        auditedPage.status = "failed";
        auditedPage.error = error.message;
        auditedPage.issues = checkIssues;
    }

    return auditedPage;
}

function addSuggestionsAndSort(auditedPage) {
    for (const issue of auditedPage.issues) {
        issue.fix = getFixSuggestion(issue.ruleId);
    }

    auditedPage.issues.sort((firstIssue, secondIssue) => {
        return SEVERITY_ORDER[firstIssue.severity] - SEVERITY_ORDER[secondIssue.severity];
    });
}

// Each audit gets an id like "2026-10-13T07-10-00_example.com".
// It is also the storage folder name: audits/<auditId>/report.json
export function createAuditId(siteUrl, startedAt) {
    const siteHost = new URL(siteUrl).host.replace(/[^a-zA-Z0-9.-]/g, "_");
    const timestamp = startedAt.toISOString().slice(0, 19).replace(/:/g, "-");
    return `${timestamp}_${siteHost}`;
}

// Hosts that point at this machine or a private network.
// A hosted (online) Yngo must not audit them, or users could scan our own servers.
function isPrivateHost(hostname) {
    const privateHostPatterns = [
        /^localhost$/,
        /^127\./,
        /^10\./,
        /^192\.168\./,
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
        /^169\.254\./,
        /^0\.0\.0\.0$/,
        /^\[?::1\]?$/
    ];
    return privateHostPatterns.some(pattern => pattern.test(hostname));
}

// Checks the URL before we start. Returns { allowed, reason, siteUrl }.
// allowPrivateUrl is used for "audit this folder", where we audit our own local server on purpose.
export function checkSiteUrl(siteUrl, allowPrivateUrl = false) {
    let parsedSiteUrl;
    try {
        parsedSiteUrl = new URL(siteUrl);
    } catch (error) {
        return { allowed: false, reason: `"${siteUrl}" is not a valid URL. Example: https://example.com` };
    }

    if (parsedSiteUrl.protocol !== "http:" && parsedSiteUrl.protocol !== "https:") {
        return { allowed: false, reason: `Only http and https websites can be audited, got "${parsedSiteUrl.protocol}"` };
    }

    if (!CONFIG.ALLOW_PRIVATE_URLS && !allowPrivateUrl && isPrivateHost(parsedSiteUrl.hostname)) {
        return { allowed: false, reason: "Auditing localhost or private network addresses is turned off on this server" };
    }

    return { allowed: true, siteUrl: parsedSiteUrl.href };
}

// options.maxPages   - how many pages to audit (default CONFIG.MAX_PAGES)
// options.auditId    - storage folder name (default: created from the URL and time)
// options.onProgress - called with a short text like "Auditing page 2 of 5"
// options.allowPrivateUrl - true only when we audit our own local folder server
export async function runSiteAudit(siteUrl, options = {}) {
    const maxPages = options.maxPages || CONFIG.MAX_PAGES;
    const onProgress = options.onProgress || (async () => {});

    const urlCheck = checkSiteUrl(siteUrl, options.allowPrivateUrl);
    if (!urlCheck.allowed) {
        throw new Error(urlCheck.reason);
    }

    const startedAt = new Date();
    const auditId = options.auditId || createAuditId(urlCheck.siteUrl, startedAt);

    await onProgress("Finding pages");
    const crawledPages = await crawlSite(urlCheck.siteUrl, maxPages);

    if (crawledPages.length === 0) {
        throw new Error(`No pages found at ${urlCheck.siteUrl}. Check that the site is online.`);
    }

    console.log(`Found ${crawledPages.length} page(s). Running Lighthouse on each one...`);

    const chrome = await startChrome();
    const auditedPages = [];

    try {
        // One page at a time: Lighthouse scores are not reliable when pages run in parallel
        for (const crawledPage of crawledPages) {
            await onProgress(`Auditing page ${auditedPages.length + 1} of ${crawledPages.length}`);
            console.log(`Auditing ${crawledPage.url}`);
            auditedPages.push(await auditPage(crawledPage, chrome));
        }
    } finally {
        await chrome.kill();
    }

    runSiteChecks(auditedPages);
    for (const auditedPage of auditedPages) {
        addSuggestionsAndSort(auditedPage);
    }

    const auditReport = {
        auditId: auditId,
        siteUrl: urlCheck.siteUrl,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
        pageCount: auditedPages.length,
        issueCount: auditedPages.reduce((count, auditedPage) => count + auditedPage.issues.length, 0),
        siteScores: getSiteScores(auditedPages),
        pages: auditedPages
    };

    const jsonLocation = await saveFile(`audits/${auditId}/report.json`, JSON.stringify(auditReport, null, 2), "application/json");
    const htmlLocation = await saveFile(`audits/${auditId}/report.html`, buildHtmlReport(auditReport), "text/html");

    return { auditReport, jsonLocation, htmlLocation };
}
