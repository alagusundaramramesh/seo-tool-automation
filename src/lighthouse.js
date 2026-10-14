import lighthouse from "lighthouse";
import * as chromeLauncher from "chrome-launcher";
import CONFIG from "./config.js";

// Runs Google Lighthouse (the same engine as the Lighthouse tab in Chrome DevTools)
// and converts its very large result into our own small format.

const CATEGORY_NAMES = {
    "performance": "performance",
    "accessibility": "accessibility",
    "best-practices": "bestPractices",
    "seo": "seo"
};

export async function startChrome() {
    const chromeOptions = {
        chromeFlags: ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
    };

    if (CONFIG.CHROME_PATH) {
        chromeOptions.chromePath = CONFIG.CHROME_PATH;
    }

    try {
        return await chromeLauncher.launch(chromeOptions);
    } catch (error) {
        console.error("Chrome failed to start", { chromePath: CONFIG.CHROME_PATH, reason: error.message });
        throw new Error("Google Chrome could not be started. Install Chrome, or set CHROME_PATH in .env to your Chrome program.");
    }
}

export async function runLighthouse(pageUrl, chrome) {
    const lighthouseRun = await lighthouse(pageUrl, {
        port: chrome.port,
        output: "json",
        logLevel: "error",
        onlyCategories: Object.keys(CATEGORY_NAMES)
    });

    if (!lighthouseRun || !lighthouseRun.lhr) {
        throw new Error(`Lighthouse returned no result for ${pageUrl}`);
    }

    if (lighthouseRun.lhr.runtimeError) {
        throw new Error(`Lighthouse could not load ${pageUrl}: ${lighthouseRun.lhr.runtimeError.message}`);
    }

    return formatLighthouseResult(lighthouseRun.lhr);
}

// Lighthouse scores are 0..1, we use 0..100 everywhere in the app
function toPercent(lighthouseScore) {
    if (lighthouseScore === null || lighthouseScore === undefined) {
        return null;
    }
    return Math.round(lighthouseScore * 100);
}

function getSeverity(auditScore) {
    if (auditScore < 0.5) {
        return "high";
    }
    if (auditScore < 0.9) {
        return "medium";
    }
    return "low";
}

// Keep the Lighthouse format inside this file. The rest of the app only sees
// { scores: { performance, accessibility, bestPractices, seo }, issues: [...] }
function formatLighthouseResult(lhr) {
    const scores = {};
    const issues = [];
    const addedAuditIds = new Set();

    for (const [lighthouseCategoryId, categoryName] of Object.entries(CATEGORY_NAMES)) {
        const category = lhr.categories[lighthouseCategoryId];
        if (!category) {
            continue;
        }

        scores[categoryName] = toPercent(category.score);

        for (const auditRef of category.auditRefs) {
            const audit = lhr.audits[auditRef.id];

            // Some audits are only informational and have no pass/fail score
            const hasScore = audit && audit.score !== null && audit.scoreDisplayMode !== "informative";
            if (!hasScore || audit.score >= 0.9) {
                continue;
            }

            // The same audit can appear in two categories, we report it once
            if (addedAuditIds.has(audit.id)) {
                continue;
            }
            addedAuditIds.add(audit.id);

            issues.push({
                ruleId: `lighthouse/${audit.id}`,
                category: categoryName,
                severity: getSeverity(audit.score),
                title: audit.title,
                description: cleanDescription(audit.description),
                displayValue: audit.displayValue || "",
                elements: getFailingElements(audit)
            });
        }
    }

    return { scores, issues };
}

// Lighthouse descriptions end with "[Learn more](https://...)". We keep the text and the link.
function cleanDescription(description) {
    if (!description) {
        return "";
    }
    return description.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1: $2");
}

// Picks up to 5 examples of what failed (an HTML element or a file URL) so the user can find it
function getFailingElements(audit) {
    // Most audits list rows in details.items, but a few (like the request chain tree) use an object there
    const detailItems = audit.details && audit.details.items;
    const failingRows = Array.isArray(detailItems) ? detailItems : [];
    const failingElements = [];

    for (const failingRow of failingRows.slice(0, 5)) {
        if (failingRow.node && failingRow.node.snippet) {
            failingElements.push(failingRow.node.snippet);
        } else if (failingRow.url) {
            failingElements.push(failingRow.url);
        }
    }

    return failingElements;
}
