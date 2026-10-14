import * as cheerio from "cheerio";

// Extra SEO checks that Lighthouse does not do (or does not explain clearly).
// They read the page HTML that the crawler downloaded.
// Note: for React apps that render only in the browser, the HTML may be almost empty,
// so these checks work best on plain HTML and server-rendered Next.js pages.

function createIssue(ruleId, severity, title, description, elements) {
    return {
        ruleId: ruleId,
        category: "seo",
        severity: severity,
        title: title,
        description: description,
        displayValue: "",
        elements: elements || []
    };
}

export function runPageChecks(page) {
    const issues = [];

    if (page.statusCode !== 200) {
        issues.push(createIssue(
            "page/bad-status",
            "high",
            `Page returned HTTP ${page.statusCode}`,
            "Search engines and visitors cannot see pages that return an error status."
        ));
        // Nothing else to check if the page did not load
        return issues;
    }

    const $ = cheerio.load(page.html);

    const pageTitle = $("head > title").text().trim();
    if (!pageTitle) {
        issues.push(createIssue("seo/missing-title", "high", "Page has no <title>",
            "The title is the blue link people click in Google results."));
    } else if (pageTitle.length > 60) {
        issues.push(createIssue("seo/title-too-long", "low", `Title is ${pageTitle.length} characters (keep it under 60)`,
            "Google cuts off long titles in search results.", [pageTitle]));
    }

    const metaDescription = $('meta[name="description"]').attr("content");
    if (!metaDescription || !metaDescription.trim()) {
        issues.push(createIssue("seo/missing-meta-description", "medium", "Page has no meta description",
            "Google often shows the meta description under the title in search results."));
    } else if (metaDescription.length > 160) {
        issues.push(createIssue("seo/meta-description-too-long", "low",
            `Meta description is ${metaDescription.length} characters (keep it under 160)`,
            "Google cuts off long descriptions in search results."));
    }

    const h1Count = $("h1").length;
    if (h1Count === 0) {
        issues.push(createIssue("seo/missing-h1", "medium", "Page has no <h1> heading",
            "The h1 tells search engines and screen readers what the page is about."));
    } else if (h1Count > 1) {
        issues.push(createIssue("seo/multiple-h1", "low", `Page has ${h1Count} <h1> headings`,
            "Use one h1 for the main topic and h2/h3 for sections."));
    }

    if (!$("html").attr("lang")) {
        issues.push(createIssue("seo/missing-html-lang", "medium", "<html> tag has no lang attribute",
            "The lang attribute tells browsers and screen readers which language the page uses."));
    }

    if ($('meta[name="viewport"]').length === 0) {
        issues.push(createIssue("seo/missing-viewport", "high", "Page has no viewport meta tag",
            "Without it the page looks tiny on phones, and Google ranks mobile-first."));
    }

    if ($('link[rel="canonical"]').length === 0) {
        issues.push(createIssue("seo/missing-canonical", "low", "Page has no canonical link",
            "A canonical link tells Google which URL is the main version of this page."));
    }

    if ($('meta[property="og:title"]').length === 0 || $('meta[property="og:image"]').length === 0) {
        issues.push(createIssue("seo/missing-open-graph", "low", "Open Graph tags are missing",
            "og:title and og:image control how the page looks when shared on WhatsApp, LinkedIn, Facebook, etc."));
    }

    const imagesWithoutAlt = [];
    $("img").each((index, imageElement) => {
        if ($(imageElement).attr("alt") === undefined) {
            imagesWithoutAlt.push($.html(imageElement));
        }
    });
    if (imagesWithoutAlt.length > 0) {
        issues.push(createIssue("seo/image-missing-alt", "medium", `${imagesWithoutAlt.length} image(s) have no alt text`,
            "Alt text describes the image for Google Images and for blind users.", imagesWithoutAlt.slice(0, 5)));
    }

    const unsafeExternalLinks = [];
    $('a[target="_blank"]').each((index, linkElement) => {
        const relValue = $(linkElement).attr("rel") || "";
        if (!relValue.includes("noopener") && !relValue.includes("noreferrer")) {
            unsafeExternalLinks.push($.html(linkElement));
        }
    });
    if (unsafeExternalLinks.length > 0) {
        issues.push(createIssue("seo/link-missing-noopener", "low",
            `${unsafeExternalLinks.length} link(s) open a new tab without rel="noopener"`,
            "The opened page can control your page through window.opener.", unsafeExternalLinks.slice(0, 5)));
    }

    return issues;
}

// Checks that need all pages at once, like the same title used on two pages
export function runSiteChecks(auditedPages) {
    const pagesByTitle = {};

    for (const auditedPage of auditedPages) {
        if (!auditedPage.title) {
            continue;
        }
        if (!pagesByTitle[auditedPage.title]) {
            pagesByTitle[auditedPage.title] = [];
        }
        pagesByTitle[auditedPage.title].push(auditedPage);
    }

    for (const [pageTitle, pagesWithSameTitle] of Object.entries(pagesByTitle)) {
        if (pagesWithSameTitle.length < 2) {
            continue;
        }

        const otherPageUrls = pagesWithSameTitle.map(auditedPage => auditedPage.url);
        for (const auditedPage of pagesWithSameTitle) {
            auditedPage.issues.push(createIssue("seo/duplicate-title", "medium",
                `Title "${pageTitle}" is used on ${pagesWithSameTitle.length} pages`,
                "Each page should have its own title so Google can tell them apart.", otherPageUrls));
        }
    }
}

export function getPageTitle(html) {
    const $ = cheerio.load(html || "");
    return $("head > title").text().trim();
}
