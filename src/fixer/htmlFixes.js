import path from "path";
import { findTags, replaceTags, hasAttribute, getAttributeValue, addAttribute, altTextFromSource, escapeForAttribute } from "./tagHelpers.js";
import { getLocalImageSize } from "./localImages.js";

// Automatic fixes for plain .html files.
//
// Every fix has:
//   fixId        - our name for the fix
//   fixesRuleIds - the audit rule ids (from report.json) that this fix solves
//   apply(fileText, fileInfo) -> { updatedText, changes: [{ message, needsReview }] }
//
// needsReview: true means "we guessed the text, please read it" (for example alt text made from a file name).

function getTagInnerText(fileText, tagName) {
    const tagMatch = fileText.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
    if (!tagMatch) {
        return "";
    }
    // Remove inner tags like <span> and squash spaces
    return tagMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// Inserts a line right after <head>, using the same indentation as the next line
function insertIntoHead(fileText, newLine) {
    const headMatch = fileText.match(/<head\b[^>]*>\s*?\n?([ \t]*)/i);
    if (!headMatch) {
        return null;
    }

    const indentation = headMatch[1];
    const headTagEnd = fileText.indexOf(">", headMatch.index) + 1;

    return fileText.slice(0, headTagEnd) + `\n${indentation}${newLine}` + fileText.slice(headTagEnd);
}

function shortenAtWord(text, maxLength) {
    if (text.length <= maxLength) {
        return text;
    }
    const shortText = text.slice(0, maxLength);
    return shortText.slice(0, shortText.lastIndexOf(" ")).replace(/[,.;:]$/, "") + "...";
}

function noChange(fileText) {
    return { updatedText: fileText, changes: [] };
}

const htmlLangFix = {
    fixId: "html-lang",
    fixesRuleIds: ["seo/missing-html-lang", "lighthouse/html-has-lang"],
    apply(fileText, fileInfo) {
        const htmlTags = findTags(fileText, ["html"]);
        if (htmlTags.length === 0 || hasAttribute(htmlTags[0].tagText, "lang")) {
            return noChange(fileText);
        }

        const updatedText = replaceTags(fileText, ["html"], (tagText) => addAttribute(tagText, `lang="${fileInfo.language}"`));
        return { updatedText, changes: [{ message: `Added lang="${fileInfo.language}" to <html>`, needsReview: false }] };
    }
};

const viewportFix = {
    fixId: "viewport",
    fixesRuleIds: ["seo/missing-viewport", "lighthouse/viewport-insight"],
    apply(fileText) {
        if (/<meta[^>]+name=["']viewport["']/i.test(fileText)) {
            return noChange(fileText);
        }

        const updatedText = insertIntoHead(fileText, '<meta name="viewport" content="width=device-width, initial-scale=1">');
        if (!updatedText) {
            return noChange(fileText);
        }
        return { updatedText, changes: [{ message: "Added viewport meta tag", needsReview: false }] };
    }
};

const titleFix = {
    fixId: "title",
    fixesRuleIds: ["seo/missing-title", "lighthouse/document-title"],
    apply(fileText) {
        if (getTagInnerText(fileText, "title")) {
            return noChange(fileText);
        }

        const pageHeading = getTagInnerText(fileText, "h1");
        if (!pageHeading) {
            return { updatedText: fileText, changes: [{ message: "Page has no <title> and no <h1> to build one from. Add a title by hand.", needsReview: true }] };
        }

        // An empty <title></title> is replaced, otherwise a new one is added
        let updatedText;
        if (/<title\b[^>]*>\s*<\/title>/i.test(fileText)) {
            updatedText = fileText.replace(/<title\b[^>]*>\s*<\/title>/i, `<title>${escapeForAttribute(pageHeading)}</title>`);
        } else {
            updatedText = insertIntoHead(fileText, `<title>${escapeForAttribute(pageHeading)}</title>`);
        }

        if (!updatedText) {
            return noChange(fileText);
        }
        return { updatedText, changes: [{ message: `Added <title> "${pageHeading}" (from the h1)`, needsReview: true }] };
    }
};

const metaDescriptionFix = {
    fixId: "meta-description",
    fixesRuleIds: ["seo/missing-meta-description", "lighthouse/meta-description"],
    apply(fileText) {
        if (/<meta[^>]+name=["']description["'][^>]+content=["'][^"']+["']/i.test(fileText)) {
            return noChange(fileText);
        }

        const firstParagraph = getTagInnerText(fileText, "p");
        if (firstParagraph.length < 40) {
            return { updatedText: fileText, changes: [{ message: "No meta description, and no paragraph long enough to build one from. Write one by hand.", needsReview: true }] };
        }

        const description = shortenAtWord(firstParagraph, 155);
        const updatedText = insertIntoHead(fileText, `<meta name="description" content="${escapeForAttribute(description)}">`);
        if (!updatedText) {
            return noChange(fileText);
        }
        return { updatedText, changes: [{ message: "Added meta description (from the first paragraph)", needsReview: true }] };
    }
};

const openGraphFix = {
    fixId: "open-graph",
    fixesRuleIds: ["seo/missing-open-graph"],
    apply(fileText) {
        const changes = [];
        let updatedText = fileText;

        const pageTitle = getTagInnerText(fileText, "title");
        if (pageTitle && !/property=["']og:title["']/i.test(fileText)) {
            updatedText = insertIntoHead(updatedText, `<meta property="og:title" content="${escapeForAttribute(pageTitle)}">`) || updatedText;
            changes.push({ message: "Added og:title (same as the page title)", needsReview: false });
        }

        const descriptionMatch = fileText.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i);
        if (descriptionMatch && !/property=["']og:description["']/i.test(fileText)) {
            updatedText = insertIntoHead(updatedText, `<meta property="og:description" content="${descriptionMatch[1]}">`) || updatedText;
            changes.push({ message: "Added og:description (same as the meta description)", needsReview: false });
        }

        if (!/property=["']og:image["']/i.test(fileText)) {
            changes.push({ message: 'og:image is missing. Add <meta property="og:image" content="https://your-site.com/share.jpg"> by hand.', needsReview: true });
        }

        return { updatedText, changes };
    }
};

const canonicalFix = {
    fixId: "canonical",
    fixesRuleIds: ["seo/missing-canonical"],
    apply(fileText, fileInfo) {
        // We can only build the full URL when the developer tells us the live site address (--site-url)
        if (!fileInfo.siteUrl || /<link[^>]+rel=["']canonical["']/i.test(fileText)) {
            return noChange(fileText);
        }

        let pagePath = "/" + fileInfo.relativePath.split(path.sep).join("/");
        if (pagePath.endsWith("/index.html")) {
            pagePath = pagePath.slice(0, -"index.html".length);
        }

        const canonicalUrl = new URL(pagePath, fileInfo.siteUrl).href;
        const updatedText = insertIntoHead(fileText, `<link rel="canonical" href="${canonicalUrl}">`);
        if (!updatedText) {
            return noChange(fileText);
        }
        return { updatedText, changes: [{ message: `Added canonical link ${canonicalUrl}`, needsReview: false }] };
    }
};

// Runs last so it ends up as the very first tag inside <head>, where it belongs
const charsetFix = {
    fixId: "charset",
    fixesRuleIds: ["lighthouse/charset"],
    apply(fileText) {
        if (/<meta[^>]+charset=/i.test(fileText)) {
            return noChange(fileText);
        }

        const updatedText = insertIntoHead(fileText, '<meta charset="utf-8">');
        if (!updatedText) {
            return noChange(fileText);
        }
        return { updatedText, changes: [{ message: "Added <meta charset=\"utf-8\">", needsReview: false }] };
    }
};

const imageFix = {
    fixId: "images",
    fixesRuleIds: ["seo/image-missing-alt", "lighthouse/image-alt", "lighthouse/unsized-images", "lighthouse/image-delivery-insight"],
    apply(fileText, fileInfo) {
        const changes = [];
        const imageFolders = [path.dirname(fileInfo.filePath), fileInfo.projectFolder];

        const updatedText = replaceTags(fileText, ["img"], (tagText, imageNumber) => {
            let updatedTag = tagText;
            const imageSource = getAttributeValue(tagText, "src");

            if (!hasAttribute(updatedTag, "alt")) {
                const altText = altTextFromSource(imageSource);
                if (altText) {
                    updatedTag = addAttribute(updatedTag, `alt="${altText}"`);
                    changes.push({ message: `Added alt="${altText}" to ${imageSource}`, needsReview: true });
                } else {
                    changes.push({ message: `Image ${imageSource} needs alt text written by hand`, needsReview: true });
                }
            }

            if (!hasAttribute(updatedTag, "width") && !hasAttribute(updatedTag, "height")) {
                const imageDimensions = getLocalImageSize(imageSource, imageFolders, fileInfo.projectFolder);
                if (imageDimensions) {
                    updatedTag = addAttribute(updatedTag, `width="${imageDimensions.width}" height="${imageDimensions.height}"`);
                    changes.push({ message: `Added width/height ${imageDimensions.width}x${imageDimensions.height} to ${imageSource}`, needsReview: false });
                }
            }

            // The first image is often the big one at the top of the page, so it must load right away.
            // All later images load only when the user scrolls near them.
            if (imageNumber > 0 && !hasAttribute(updatedTag, "loading")) {
                updatedTag = addAttribute(updatedTag, 'loading="lazy"');
                changes.push({ message: `Added loading="lazy" to ${imageSource}`, needsReview: false });
            }

            return updatedTag;
        });

        return { updatedText, changes };
    }
};

const safeLinkFix = {
    fixId: "safe-links",
    fixesRuleIds: ["seo/link-missing-noopener"],
    apply(fileText) {
        const changes = [];

        const updatedText = replaceTags(fileText, ["a"], (tagText) => {
            const opensNewTab = /target\s*=\s*["']_blank["']/.test(tagText);
            if (!opensNewTab || hasAttribute(tagText, "rel")) {
                return tagText;
            }

            changes.push({ message: `Added rel="noopener noreferrer" to link ${getAttributeValue(tagText, "href")}`, needsReview: false });
            return addAttribute(tagText, 'rel="noopener noreferrer"');
        });

        return { updatedText, changes };
    }
};

// The order matters: title before open-graph (og:title copies the title), charset last (see above)
export const HTML_FIXES = [
    htmlLangFix,
    viewportFix,
    titleFix,
    metaDescriptionFix,
    openGraphFix,
    canonicalFix,
    imageFix,
    safeLinkFix,
    charsetFix
];
