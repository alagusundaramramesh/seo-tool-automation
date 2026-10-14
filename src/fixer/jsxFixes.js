import path from "path";
import { findTags, replaceTags, hasAttribute, getAttributeValue, addAttribute, altTextFromSource } from "./tagHelpers.js";
import { getLocalImageSize } from "./localImages.js";

// Automatic fixes for React and Next.js files (.jsx, .tsx, and .js/.ts files that contain JSX).
// Same shape as htmlFixes.js: { fixId, fixesRuleIds, apply(fileText, fileInfo) -> { updatedText, changes } }

function noChange(fileText) {
    return { updatedText: fileText, changes: [] };
}

// Next.js App Router: app/layout.js  ->  <html lang="en">
// Next.js Pages Router: pages/_document.js  ->  <Html lang="en">
const htmlLangFix = {
    fixId: "html-lang",
    fixesRuleIds: ["seo/missing-html-lang", "lighthouse/html-has-lang"],
    apply(fileText, fileInfo) {
        const htmlTags = findTags(fileText, ["html", "Html"]);
        if (htmlTags.length === 0 || hasAttribute(htmlTags[0].tagText, "lang")) {
            return noChange(fileText);
        }

        const updatedText = replaceTags(fileText, ["html", "Html"], (tagText) => addAttribute(tagText, `lang="${fileInfo.language}"`));
        return { updatedText, changes: [{ message: `Added lang="${fileInfo.language}" to <html>`, needsReview: false }] };
    }
};

// Works for <img> and the Next.js <Image> component
const imageFix = {
    fixId: "images",
    fixesRuleIds: ["seo/image-missing-alt", "lighthouse/image-alt", "lighthouse/unsized-images", "lighthouse/image-delivery-insight"],
    apply(fileText, fileInfo) {
        const changes = [];
        // In React/Next.js projects, "/logo.png" lives in the public folder
        const imageFolders = [path.join(fileInfo.projectFolder, "public")];

        const updatedText = replaceTags(fileText, ["img", "Image"], (tagText, imageNumber) => {
            let updatedTag = tagText;
            const isNextImage = tagText.startsWith("<Image");
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

            // next/image sets width/height and lazy loading itself, so only plain <img> needs these
            if (isNextImage) {
                return updatedTag;
            }

            const hasStaticSource = /\ssrc\s*=\s*["']/.test(tagText);
            if (hasStaticSource && !hasAttribute(updatedTag, "width") && !hasAttribute(updatedTag, "height")) {
                const imageDimensions = getLocalImageSize(imageSource, imageFolders, fileInfo.projectFolder);
                if (imageDimensions) {
                    updatedTag = addAttribute(updatedTag, `width={${imageDimensions.width}} height={${imageDimensions.height}}`);
                    changes.push({ message: `Added width/height ${imageDimensions.width}x${imageDimensions.height} to ${imageSource}`, needsReview: false });
                }
            }

            // Keep the first image of the component loading right away (it may be the hero image)
            if (imageNumber > 0 && !hasAttribute(updatedTag, "loading")) {
                updatedTag = addAttribute(updatedTag, 'loading="lazy"');
                changes.push({ message: `Added loading="lazy" to ${imageSource}`, needsReview: false });
            }

            return updatedTag;
        });

        return { updatedText, changes };
    }
};

// Works for <a> and the Next.js <Link> component
const safeLinkFix = {
    fixId: "safe-links",
    fixesRuleIds: ["seo/link-missing-noopener"],
    apply(fileText) {
        const changes = [];

        const updatedText = replaceTags(fileText, ["a", "Link"], (tagText) => {
            const opensNewTab = /target\s*=\s*["']_blank["']/.test(tagText) || /target\s*=\s*\{\s*["']_blank["']\s*\}/.test(tagText);
            if (!opensNewTab || hasAttribute(tagText, "rel")) {
                return tagText;
            }

            changes.push({ message: `Added rel="noopener noreferrer" to link ${getAttributeValue(tagText, "href")}`, needsReview: false });
            return addAttribute(tagText, 'rel="noopener noreferrer"');
        });

        return { updatedText, changes };
    }
};

// Next.js App Router only: SEO title/description come from "export const metadata" in app/layout or app/**/page.
// Writing a good description needs a human, so we only point it out.
const nextMetadataCheck = {
    fixId: "next-metadata",
    fixesRuleIds: ["seo/missing-title", "lighthouse/document-title", "seo/missing-meta-description", "lighthouse/meta-description"],
    apply(fileText, fileInfo) {
        const relativePath = fileInfo.relativePath.split(path.sep).join("/");
        const isAppLayout = /^(src\/)?app\/layout\.(js|jsx|ts|tsx)$/.test(relativePath);

        if (!isAppLayout || /export\s+(const\s+metadata|async\s+function\s+generateMetadata|function\s+generateMetadata)/.test(fileText)) {
            return noChange(fileText);
        }

        return {
            updatedText: fileText,
            changes: [{
                message: 'No metadata export. Add: export const metadata = { title: "Your site", description: "What the site is about" };',
                needsReview: true
            }]
        };
    }
};

export const JSX_FIXES = [
    htmlLangFix,
    imageFix,
    safeLinkFix,
    nextMetadataCheck
];
