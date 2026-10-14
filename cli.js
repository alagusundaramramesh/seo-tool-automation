#!/usr/bin/env node
import { createTwoFilesPatch } from "diff";
import { runSiteAudit } from "./src/audit.js";
import { canFixProject, planFixes, applyFixes, undoLastFix, getRuleIdsFromReport, detectProjectType } from "./src/fixer/fixProject.js";
import { startStaticServer } from "./src/staticServer.js";

const USAGE = `
Usage:
  node cli.js audit <website-url> [--pages 5] [--min-score 80]
  node cli.js fix <project-folder> [--apply] [--report report.json] [--site-url https://your-site.com] [--lang en] [--compare]
  node cli.js undo <project-folder>
  node cli.js serve <html-folder> [port]

Examples:
  node cli.js audit https://example.com --pages 5
  node cli.js fix ./my-site                      (shows what would change, writes nothing)
  node cli.js fix ./my-site --apply              (writes the fixes, keeps a backup)
  node cli.js fix ./my-site --apply --compare    (plain HTML only: audits before and after)
  node cli.js undo ./my-site                     (puts the files back from the last backup)
`;

// Reads "--pages 5" style options from the command line
function getFlagValue(commandArgs, flagName) {
    const flagIndex = commandArgs.indexOf(flagName);
    if (flagIndex === -1) {
        return undefined;
    }
    return commandArgs[flagIndex + 1];
}

function hasFlag(commandArgs, flagName) {
    return commandArgs.includes(flagName);
}

function stopWithError(message) {
    console.error(message);
    process.exit(1);
}

// Prints a diff with green "+" and red "-" lines
function printColoredDiff(relativePath, originalText, updatedText) {
    const filePatch = createTwoFilesPatch(relativePath, relativePath, originalText, updatedText, "", "", { context: 1 });

    for (const patchLine of filePatch.split("\n").slice(2)) {
        if (patchLine.startsWith("+")) {
            console.log(`\x1b[32m${patchLine}\x1b[0m`);
        } else if (patchLine.startsWith("-")) {
            console.log(`\x1b[31m${patchLine}\x1b[0m`);
        } else {
            console.log(patchLine);
        }
    }
}

function printAuditSummary(auditReport) {
    console.log(`Site score: ${auditReport.siteScores.overall}/100`);
    for (const auditedPage of auditReport.pages) {
        const shownScore = auditedPage.score === null ? "failed" : `${auditedPage.score}/100`;
        console.log(`  ${shownScore}  ${auditedPage.url}  (${auditedPage.issues.length} issues)`);
    }
}

async function runAuditCommand(commandArgs) {
    const siteUrl = commandArgs[0];
    if (!siteUrl) {
        stopWithError(USAGE);
    }

    let maxPages;
    if (getFlagValue(commandArgs, "--pages") !== undefined) {
        maxPages = Number(getFlagValue(commandArgs, "--pages"));
        if (!Number.isInteger(maxPages) || maxPages < 1) {
            stopWithError("--pages must be a whole number, for example --pages 5");
        }
    }

    const { auditReport, jsonLocation, htmlLocation } = await runSiteAudit(siteUrl, { maxPages });

    console.log("");
    printAuditSummary(auditReport);
    console.log("");
    console.log(`JSON report: ${jsonLocation}`);
    console.log(`HTML report: ${htmlLocation}`);

    // For CI pipelines: fail the build when the site score drops below a minimum
    const minScoreText = getFlagValue(commandArgs, "--min-score");
    if (minScoreText !== undefined && auditReport.siteScores.overall < Number(minScoreText)) {
        stopWithError(`\nSite score ${auditReport.siteScores.overall} is below the minimum ${minScoreText}`);
    }
}

async function auditFolder(projectFolder) {
    const staticServer = await startStaticServer(projectFolder);
    try {
        const { auditReport } = await runSiteAudit(staticServer.siteUrl, {});
        return auditReport;
    } finally {
        await staticServer.stop();
    }
}

async function runFixCommand(commandArgs) {
    const folderCheck = canFixProject(commandArgs[0]);
    if (!folderCheck.allowed) {
        stopWithError(folderCheck.reason);
    }
    const projectFolder = folderCheck.projectFolder;

    const shouldApply = hasFlag(commandArgs, "--apply");
    const shouldCompare = hasFlag(commandArgs, "--compare");
    const reportPath = getFlagValue(commandArgs, "--report");
    const siteUrl = getFlagValue(commandArgs, "--site-url");

    if (shouldCompare && !shouldApply) {
        stopWithError("--compare only works together with --apply");
    }
    if (shouldCompare && detectProjectType(projectFolder) !== "html") {
        stopWithError("--compare works for plain HTML folders only. For React/Next.js, run your dev server and use the audit command before and after.");
    }

    const reportRuleIds = reportPath ? getRuleIdsFromReport(reportPath) : undefined;

    let scoresBefore;
    if (shouldCompare) {
        console.log("Auditing the folder BEFORE fixing...");
        scoresBefore = (await auditFolder(projectFolder)).siteScores;
    }

    const fixPlan = planFixes(projectFolder, {
        reportRuleIds,
        siteUrl,
        language: getFlagValue(commandArgs, "--lang") || "en"
    });

    console.log(`Project type: ${fixPlan.projectType}. Checked ${fixPlan.scannedFileCount} file(s).`);

    if (fixPlan.plannedFiles.length === 0) {
        console.log("Nothing to fix. 🎉");
        return;
    }

    let reviewCount = 0;
    for (const plannedFile of fixPlan.plannedFiles) {
        console.log(`\n\x1b[1m${plannedFile.relativePath}\x1b[0m`);

        for (const change of plannedFile.changes) {
            const marker = change.needsReview ? "\x1b[33m[review]\x1b[0m" : "\x1b[32m[auto]\x1b[0m  ";
            console.log(`  ${marker} ${change.message}`);
            if (change.needsReview) {
                reviewCount++;
            }
        }

        if (plannedFile.isChanged) {
            printColoredDiff(plannedFile.relativePath, plannedFile.originalText, plannedFile.updatedText);
        }
    }

    const changedFileCount = fixPlan.plannedFiles.filter(plannedFile => plannedFile.isChanged).length;
    console.log(`\n${changedFileCount} file(s) to change. ${reviewCount} item(s) marked [review] need a quick human check.`);

    if (!shouldApply) {
        console.log("Nothing was written. Run again with --apply to save these changes.");
        return;
    }

    if (changedFileCount === 0) {
        console.log("No file changes to apply. The [review] items above must be fixed by hand.");
        return;
    }

    const backupFolder = applyFixes(projectFolder, fixPlan.plannedFiles);
    console.log(`\nSaved ${changedFileCount} file(s). Backup: ${backupFolder}`);
    console.log(`To undo: node cli.js undo ${commandArgs[0]}`);

    if (shouldCompare) {
        console.log("\nAuditing the folder AFTER fixing...");
        const scoresAfter = (await auditFolder(projectFolder)).siteScores;

        console.log("\nScore          Before  After");
        for (const scoreName of ["overall", "performance", "accessibility", "bestPractices", "seo"]) {
            console.log(`${scoreName.padEnd(15)}${String(scoresBefore[scoreName]).padStart(6)}  ${String(scoresAfter[scoreName]).padStart(5)}`);
        }
    }
}

function runUndoCommand(commandArgs) {
    const folderCheck = canFixProject(commandArgs[0]);
    if (!folderCheck.allowed) {
        stopWithError(folderCheck.reason);
    }

    const restoredFiles = undoLastFix(folderCheck.projectFolder);
    console.log(`Restored ${restoredFiles.length} file(s):`);
    for (const relativePath of restoredFiles) {
        console.log(`  ${relativePath}`);
    }
}

async function runServeCommand(commandArgs) {
    const folderCheck = canFixProject(commandArgs[0]);
    if (!folderCheck.allowed) {
        stopWithError(folderCheck.reason);
    }

    const port = Number(commandArgs[1] || 8080);
    const staticServer = await startStaticServer(folderCheck.projectFolder, port);
    console.log(`Serving ${folderCheck.projectFolder} at ${staticServer.siteUrl} (Ctrl+C to stop)`);
}

async function main() {
    const [command, ...commandArgs] = process.argv.slice(2);

    try {
        if (command === "audit") {
            await runAuditCommand(commandArgs);
        } else if (command === "fix") {
            await runFixCommand(commandArgs);
        } else if (command === "undo") {
            runUndoCommand(commandArgs);
        } else if (command === "serve") {
            await runServeCommand(commandArgs);
        } else {
            stopWithError(USAGE);
        }
    } catch (error) {
        stopWithError(`${command} failed: ${error.message}`);
    }
}

main();
