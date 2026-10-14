// Helpers to find and edit tags like <img ...> inside HTML and JSX files.
//
// We edit the file text directly (instead of parsing and re-printing the whole file)
// so that only the changed tags show up in the diff and the developer's formatting stays the same.

// Matches one opening tag, for example <img src="a.png" alt="x"> or <Image src={hero} />.
// The middle part allows JSX values in braces, one or two levels deep: {hero} or {{ width: 10 }}.
function createTagPattern(tagNames) {
    const attributePart = "(?:[^>{}]|\\{(?:[^{}]|\\{[^{}]*\\})*\\})*";
    return new RegExp(`<(?:${tagNames.join("|")})\\b${attributePart}\\/?>`, "g");
}

// Returns every tag found, with its position, so the caller can replace it
export function findTags(fileText, tagNames) {
    const tagPattern = createTagPattern(tagNames);
    const foundTags = [];
    let tagMatch;

    while ((tagMatch = tagPattern.exec(fileText)) !== null) {
        foundTags.push({ tagText: tagMatch[0], startIndex: tagMatch.index });
    }

    return foundTags;
}

// Replaces tags from the end of the file to the start, so earlier positions stay correct.
// updateTag(tagText, tagNumber) returns the new tag text (or the same text to leave it unchanged).
export function replaceTags(fileText, tagNames, updateTag) {
    const foundTags = findTags(fileText, tagNames);
    let updatedText = fileText;

    for (let tagNumber = foundTags.length - 1; tagNumber >= 0; tagNumber--) {
        const foundTag = foundTags[tagNumber];
        const newTagText = updateTag(foundTag.tagText, tagNumber);

        if (newTagText !== foundTag.tagText) {
            updatedText = updatedText.slice(0, foundTag.startIndex)
                + newTagText
                + updatedText.slice(foundTag.startIndex + foundTag.tagText.length);
        }
    }

    return updatedText;
}

export function hasAttribute(tagText, attributeName) {
    const attributePattern = new RegExp(`\\s${attributeName}(\\s*=|\\s|\\/?>)`);
    return attributePattern.test(tagText);
}

// Returns the value of name="value", name='value' or name={value}, or null
export function getAttributeValue(tagText, attributeName) {
    const quotedValue = tagText.match(new RegExp(`\\s${attributeName}\\s*=\\s*["']([^"']*)["']`));
    if (quotedValue) {
        return quotedValue[1];
    }

    const jsxValue = tagText.match(new RegExp(`\\s${attributeName}\\s*=\\s*\\{([^}]*)\\}`));
    if (jsxValue) {
        return jsxValue[1].trim();
    }

    return null;
}

// Adds the attribute at the end of the tag:
//   <img src="a.png">     -> <img src="a.png" alt="A">
//   <Image src={hero} />  -> <Image src={hero} alt="A" />
export function addAttribute(tagText, attributeText) {
    const tagEnd = tagText.endsWith("/>") ? "/>" : ">";
    const tagStart = tagText.slice(0, -tagEnd.length).trimEnd();
    const spaceBeforeEnd = tagEnd === "/>" ? " " : "";
    return `${tagStart} ${attributeText}${spaceBeforeEnd}${tagEnd}`;
}

export function escapeForAttribute(text) {
    return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// Makes alt text from an image file name or a JSX variable name:
//   "/images/brown-leather_wallet.jpg" -> "Brown leather wallet"
//   "heroBanner"                       -> "Hero banner"
// Returns "" when the name does not contain real words (like "IMG_0042" or "a83f9c").
export function altTextFromSource(imageSource) {
    if (!imageSource) {
        return "";
    }

    const fileName = imageSource.split("?")[0].split("/").pop();
    const nameWithoutExtension = fileName.replace(/\.[a-zA-Z0-9]+$/, "");

    const words = nameWithoutExtension
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/[-_.]+/g, " ")
        .split(" ")
        .filter(word => /^[a-zA-Z]{2,}$/.test(word))
        .filter(word => !["img", "image", "pic", "photo", "src"].includes(word.toLowerCase()));

    if (words.length === 0) {
        return "";
    }

    const altText = words.join(" ").toLowerCase();
    return escapeForAttribute(altText.charAt(0).toUpperCase() + altText.slice(1));
}
