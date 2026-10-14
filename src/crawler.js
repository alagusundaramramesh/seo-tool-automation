import * as cheerio from "cheerio";

// Finds the pages of a website, starting from one URL.
// It reads sitemap.xml (if the site has one) and follows links on each page,
// but only links on the same website, and never more than maxPages.

async function fetchText(pageUrl) {
    try {
        const pageResponse = await fetch(pageUrl, { redirect: "follow" });

        if (!pageResponse.ok) {
            return { statusCode: pageResponse.status, body: "" };
        }

        return { statusCode: pageResponse.status, body: await pageResponse.text() };
    } catch (error) {
        console.error("Could not fetch page", { pageUrl, reason: error.message });
        return { statusCode: 0, body: "" };
    }
}

// Reads the "Disallow:" lines for all robots (User-agent: *) from robots.txt
async function getDisallowedPaths(siteOrigin) {
    const robotsFile = await fetchText(`${siteOrigin}/robots.txt`);
    const disallowedPaths = [];
    let appliesToUs = false;

    for (const rawLine of robotsFile.body.split("\n")) {
        const line = rawLine.trim();

        if (line.toLowerCase().startsWith("user-agent:")) {
            appliesToUs = line.split(":")[1].trim() === "*";
            continue;
        }

        if (appliesToUs && line.toLowerCase().startsWith("disallow:")) {
            const blockedPath = line.slice("disallow:".length).trim();
            if (blockedPath) {
                disallowedPaths.push(blockedPath);
            }
        }
    }

    return disallowedPaths;
}

async function getSitemapUrls(siteOrigin) {
    const sitemap = await fetchText(`${siteOrigin}/sitemap.xml`);

    if (!sitemap.body) {
        return [];
    }

    const $ = cheerio.load(sitemap.body, { xmlMode: true });
    const sitemapUrls = [];

    $("url > loc").each((index, locElement) => {
        sitemapUrls.push($(locElement).text().trim());
    });

    return sitemapUrls;
}

// Turns "/about#team" into "https://site.com/about" so the same page is not counted twice
function cleanPageUrl(link, baseUrl) {
    try {
        const pageUrl = new URL(link, baseUrl);
        pageUrl.hash = "";

        // "/index.html" and "/" are the same page
        if (pageUrl.pathname.endsWith("/index.html")) {
            pageUrl.pathname = pageUrl.pathname.slice(0, -"index.html".length);
        }

        return pageUrl.href;
    } catch (error) {
        // Links like "javascript:void(0)" are not real pages, so we skip them on purpose
        return null;
    }
}

function isFileLink(pageUrl) {
    const fileExtensions = [".pdf", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".webp", ".zip", ".mp4", ".css", ".js"];
    const pathname = new URL(pageUrl).pathname.toLowerCase();

    return fileExtensions.some(extension => pathname.endsWith(extension));
}

export async function crawlSite(startUrl, maxPages) {
    const siteOrigin = new URL(startUrl).origin;
    const disallowedPaths = await getDisallowedPaths(siteOrigin);
    const sitemapUrls = await getSitemapUrls(siteOrigin);

    const pagesToVisit = [startUrl, ...sitemapUrls];
    const seenUrls = new Set();
    const crawledPages = [];

    while (pagesToVisit.length > 0 && crawledPages.length < maxPages) {
        const pageUrl = cleanPageUrl(pagesToVisit.shift(), startUrl);

        if (!pageUrl || seenUrls.has(pageUrl)) {
            continue;
        }
        seenUrls.add(pageUrl);

        if (new URL(pageUrl).origin !== siteOrigin || isFileLink(pageUrl)) {
            continue;
        }

        const pagePath = new URL(pageUrl).pathname;
        const isBlockedByRobots = disallowedPaths.some(blockedPath => pagePath.startsWith(blockedPath));
        if (isBlockedByRobots) {
            continue;
        }

        console.log(`Crawling ${pageUrl}`);
        const page = await fetchText(pageUrl);

        // We keep the HTML because the extra SEO checks read it later
        crawledPages.push({ url: pageUrl, statusCode: page.statusCode, html: page.body });

        const $ = cheerio.load(page.body);
        $("a[href]").each((index, linkElement) => {
            const linkUrl = cleanPageUrl($(linkElement).attr("href"), pageUrl);
            if (linkUrl) {
                pagesToVisit.push(linkUrl);
            }
        });
    }

    return crawledPages;
}
