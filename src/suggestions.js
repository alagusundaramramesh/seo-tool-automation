// How to fix each problem, in plain words with a small code example.
// "autoFixable: true" means the Phase 2 auto-fix will be able to fix it without AI.
// To add a suggestion for a new rule, add one more entry here.

const FIX_SUGGESTIONS = {
    "page/bad-status": {
        howToFix: "Make sure the page exists, or redirect the old URL to the new page with a 301 redirect.",
        example: "",
        autoFixable: false
    },
    "seo/missing-title": {
        howToFix: "Add a unique <title> inside <head>, 50-60 characters, with the main keyword first.",
        example: "<title>Handmade Leather Wallets | Yngo Store</title>",
        autoFixable: true
    },
    "seo/title-too-long": {
        howToFix: "Shorten the title to under 60 characters. Keep the most important words at the start.",
        example: "",
        autoFixable: false
    },
    "seo/missing-meta-description": {
        howToFix: "Add a meta description inside <head> that summarises the page in 120-160 characters.",
        example: '<meta name="description" content="Shop handmade leather wallets with free shipping across India.">',
        autoFixable: true
    },
    "seo/meta-description-too-long": {
        howToFix: "Shorten the meta description to under 160 characters.",
        example: "",
        autoFixable: false
    },
    "seo/missing-h1": {
        howToFix: "Add one <h1> at the top of the main content describing the page topic.",
        example: "<h1>Handmade Leather Wallets</h1>",
        autoFixable: false
    },
    "seo/multiple-h1": {
        howToFix: "Keep one <h1> for the main topic and change the others to <h2>.",
        example: "",
        autoFixable: false
    },
    "seo/missing-html-lang": {
        howToFix: "Add the lang attribute to the <html> tag. In Next.js App Router, set it in app/layout.js.",
        example: '<html lang="en">',
        autoFixable: true
    },
    "seo/missing-viewport": {
        howToFix: "Add the viewport meta tag inside <head> so the page fits phone screens.",
        example: '<meta name="viewport" content="width=device-width, initial-scale=1">',
        autoFixable: true
    },
    "seo/missing-canonical": {
        howToFix: "Add a canonical link inside <head> pointing to the main URL of this page.",
        example: '<link rel="canonical" href="https://example.com/wallets">',
        autoFixable: true
    },
    "seo/missing-open-graph": {
        howToFix: "Add og:title, og:description and og:image meta tags inside <head>.",
        example: '<meta property="og:title" content="Handmade Leather Wallets">\n<meta property="og:image" content="https://example.com/share.jpg">',
        autoFixable: true
    },
    "seo/image-missing-alt": {
        howToFix: "Add an alt attribute that describes the image. Use alt=\"\" for decorative images.",
        example: '<img src="wallet.jpg" alt="Brown leather wallet, open">',
        autoFixable: true
    },
    "seo/link-missing-noopener": {
        howToFix: "Add rel=\"noopener noreferrer\" to every link that uses target=\"_blank\".",
        example: '<a href="https://x.com" target="_blank" rel="noopener noreferrer">',
        autoFixable: true
    },
    "seo/duplicate-title": {
        howToFix: "Give each page its own title that describes that page.",
        example: "",
        autoFixable: false
    },
    "lighthouse/image-delivery-insight": {
        howToFix: "Compress images and serve them as WebP. In Next.js use the <Image> component from next/image.",
        example: 'import Image from "next/image";\n<Image src="/wallet.jpg" width={600} height={400} alt="Wallet" />',
        autoFixable: true
    },
    "lighthouse/unsized-images": {
        howToFix: "Give images a width and height so the page does not jump while loading.",
        example: '<img src="wallet.jpg" width="600" height="400" alt="Wallet">',
        autoFixable: true
    },
    "lighthouse/render-blocking-insight": {
        howToFix: "Add defer to scripts in <head>, and inline only the CSS needed for the first screen.",
        example: '<script src="app.js" defer></script>',
        autoFixable: false
    },
    "lighthouse/cache-insight": {
        howToFix: "Tell browsers to cache images, CSS and JS for a long time with the Cache-Control header on your server or CDN.",
        example: "Cache-Control: public, max-age=31536000, immutable",
        autoFixable: false
    },
    "lighthouse/lcp-discovery-insight": {
        howToFix: "Make the biggest image on the first screen load early: do not lazy-load it, and add fetchpriority=\"high\".",
        example: '<img src="hero.jpg" fetchpriority="high" alt="Hero">',
        autoFixable: false
    },
    "lighthouse/charset": {
        howToFix: "Add the charset meta tag as the very first tag inside <head>.",
        example: '<meta charset="utf-8">',
        autoFixable: true
    },
    "lighthouse/landmark-one-main": {
        howToFix: "Wrap the main content of the page in a <main> tag so screen readers can jump to it.",
        example: "<main>\n  <h1>Page title</h1>\n  ...\n</main>",
        autoFixable: false
    },
    "lighthouse/errors-in-console": {
        howToFix: "Open Chrome DevTools > Console on this page and fix the red errors (often missing files or JavaScript errors).",
        example: "",
        autoFixable: false
    },
    "lighthouse/color-contrast": {
        howToFix: "Make the text colour darker (or the background lighter) so the contrast ratio is at least 4.5:1.",
        example: "",
        autoFixable: false
    },
    "lighthouse/link-name": {
        howToFix: "Every link needs visible text or an aria-label so screen readers can describe it.",
        example: '<a href="/cart" aria-label="Open cart"><svg>...</svg></a>',
        autoFixable: false
    },
    "lighthouse/button-name": {
        howToFix: "Every button needs visible text or an aria-label.",
        example: '<button aria-label="Close menu">×</button>',
        autoFixable: false
    }
};

// Lighthouse reports some of the same problems as our own checks, so they share the same suggestion
FIX_SUGGESTIONS["lighthouse/document-title"] = FIX_SUGGESTIONS["seo/missing-title"];
FIX_SUGGESTIONS["lighthouse/meta-description"] = FIX_SUGGESTIONS["seo/missing-meta-description"];
FIX_SUGGESTIONS["lighthouse/html-has-lang"] = FIX_SUGGESTIONS["seo/missing-html-lang"];
FIX_SUGGESTIONS["lighthouse/viewport-insight"] = FIX_SUGGESTIONS["seo/missing-viewport"];
FIX_SUGGESTIONS["lighthouse/image-alt"] = FIX_SUGGESTIONS["seo/image-missing-alt"];

export function getFixSuggestion(ruleId) {
    const fixSuggestion = FIX_SUGGESTIONS[ruleId];

    if (!fixSuggestion) {
        return {
            howToFix: "Read the explanation and the 'Learn more' link above for how to fix this.",
            example: "",
            autoFixable: false
        };
    }

    return fixSuggestion;
}
