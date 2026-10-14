import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { altTextFromSource, addAttribute, hasAttribute, getAttributeValue } from "../src/fixer/tagHelpers.js";
import { planFixes, applyFixes, undoLastFix, canFixProject } from "../src/fixer/fixProject.js";

// Run with: npm test

function createTempProject(projectFiles) {
    const projectFolder = fs.mkdtempSync(path.join(os.tmpdir(), "yngo-test-"));

    for (const [relativePath, fileText] of Object.entries(projectFiles)) {
        const filePath = path.join(projectFolder, relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, fileText);
    }

    return projectFolder;
}

test("altTextFromSource makes readable alt text from file names", () => {
    assert.equal(altTextFromSource("/images/brown-leather_wallet.jpg"), "Brown leather wallet");
    assert.equal(altTextFromSource("heroBanner"), "Hero banner");
    assert.equal(altTextFromSource("/IMG_0042.jpg"), "");
    assert.equal(altTextFromSource(null), "");
});

test("addAttribute adds at the end of normal and self-closing tags", () => {
    assert.equal(addAttribute('<img src="a.png">', 'alt="A"'), '<img src="a.png" alt="A">');
    assert.equal(addAttribute("<Image src={hero} />", 'alt="A"'), '<Image src={hero} alt="A" />');
});

test("hasAttribute and getAttributeValue read HTML and JSX attributes", () => {
    assert.equal(hasAttribute('<img src="a.png" alt="">', "alt"), true);
    assert.equal(hasAttribute('<img src="a.png" data-alt="x">', "alt"), false);
    assert.equal(getAttributeValue('<img src="a.png">', "src"), "a.png");
    assert.equal(getAttributeValue("<Image src={heroBanner} />", "src"), "heroBanner");
});

test("plain HTML: adds lang, viewport, charset, alt and safe links", () => {
    const projectFolder = createTempProject({
        "index.html": '<html>\n<head>\n<title>Shop</title>\n</head>\n<body>\n<img src="red-shoes.png">\n<a href="https://x.com" target="_blank">X</a>\n</body>\n</html>\n'
    });

    const fixPlan = planFixes(projectFolder);
    const fixedHtml = fixPlan.plannedFiles[0].updatedText;

    assert.equal(fixPlan.projectType, "html");
    assert.match(fixedHtml, /<html lang="en">/);
    assert.match(fixedHtml, /<meta name="viewport"/);
    assert.match(fixedHtml, /<head>\n<meta charset="utf-8">/);
    assert.match(fixedHtml, /<img src="red-shoes.png" alt="Red shoes">/);
    assert.match(fixedHtml, /target="_blank" rel="noopener noreferrer"/);
});

test("Next.js: fixes layout lang and images, skips width/height for next/image", () => {
    const projectFolder = createTempProject({
        "package.json": JSON.stringify({ dependencies: { next: "15.0.0", react: "19.0.0" } }),
        "app/layout.js": "export default function Layout({ children }) {\n    return <html><body>{children}</body></html>;\n}\n",
        "app/page.js": 'import Image from "next/image";\nexport default function Page() {\n    return <main><Image src={heroBanner} /></main>;\n}\n'
    });

    const fixPlan = planFixes(projectFolder);
    const fixedLayout = fixPlan.plannedFiles.find(plannedFile => plannedFile.relativePath.endsWith("layout.js")).updatedText;
    const fixedPage = fixPlan.plannedFiles.find(plannedFile => plannedFile.relativePath.endsWith("page.js")).updatedText;

    assert.equal(fixPlan.projectType, "nextjs");
    assert.match(fixedLayout, /<html lang="en">/);
    assert.match(fixedPage, /<Image src=\{heroBanner\} alt="Hero banner" \/>/);
    assert.doesNotMatch(fixedPage, /loading=/);
});

test("report filter: only runs fixes for problems found in the report", () => {
    const projectFolder = createTempProject({
        "index.html": '<html>\n<head>\n</head>\n<body><img src="cat.png"></body>\n</html>\n'
    });

    const fixPlan = planFixes(projectFolder, { reportRuleIds: new Set(["lighthouse/image-alt"]) });
    const fixedHtml = fixPlan.plannedFiles[0].updatedText;

    assert.match(fixedHtml, /alt="Cat"/);
    assert.doesNotMatch(fixedHtml, /lang=/);
});

test("apply then undo puts the original files back", () => {
    const originalHtml = '<html>\n<head>\n</head>\n<body></body>\n</html>\n';
    const projectFolder = createTempProject({ "index.html": originalHtml });

    const fixPlan = planFixes(projectFolder);
    applyFixes(projectFolder, fixPlan.plannedFiles);
    assert.notEqual(fs.readFileSync(path.join(projectFolder, "index.html"), "utf8"), originalHtml);

    undoLastFix(projectFolder);
    assert.equal(fs.readFileSync(path.join(projectFolder, "index.html"), "utf8"), originalHtml);
});

test("running the fixer twice changes nothing the second time", () => {
    const projectFolder = createTempProject({
        "index.html": '<html>\n<head>\n<title>Shop</title>\n</head>\n<body><img src="cat.png"><img src="dog.png"></body>\n</html>\n'
    });

    applyFixes(projectFolder, planFixes(projectFolder).plannedFiles);
    const secondPlan = planFixes(projectFolder);
    const changedFiles = secondPlan.plannedFiles.filter(plannedFile => plannedFile.isChanged);

    assert.equal(changedFiles.length, 0);
});

test("canFixProject refuses missing folders and the home folder", () => {
    assert.equal(canFixProject("/this/folder/does/not/exist").allowed, false);
    assert.equal(canFixProject(os.homedir()).allowed, false);
    assert.equal(canFixProject(undefined).allowed, false);
});
