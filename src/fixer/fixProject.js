import fs from "fs";
import path from "path";
import os from "os";
import { HTML_FIXES } from "./htmlFixes.js";
import { JSX_FIXES } from "./jsxFixes.js";

// Auto-fix for a project folder on the developer's computer.
//
//   1. planFixes()   reads the files and works out every change, but writes nothing
//   2. applyFixes()  saves a backup of each file, then writes the changes
//   3. undoLastFix() puts the files from the latest backup back
//
// The CLI shows the plan as a diff first, and only applies it with --apply.

export const SKIPPED_FOLDERS = ["node_modules", ".git", ".next", "dist", "build", "out", "coverage", ".yngo-backup", ".vercel"];
const BACKUP_FOLDER_NAME = ".yngo-backup";

// Returns { allowed, reason, projectFolder }
export function canFixProject(projectFolder) {
    if (!projectFolder) {
        return { allowed: false, reason: "Please give the project folder, for example: node cli.js fix ./my-site" };
    }

    const absoluteFolder = path.resolve(projectFolder);

    if (!fs.existsSync(absoluteFolder) || !fs.statSync(absoluteFolder).isDirectory()) {
        return { allowed: false, reason: `Folder not found: ${absoluteFolder}` };
    }

    // Protect against fixing the whole disk or home folder by mistake
    if (absoluteFolder === path.parse(absoluteFolder).root || absoluteFolder === os.homedir()) {
        return { allowed: false, reason: `Refusing to fix ${absoluteFolder}. Point to a single project folder.` };
    }

    return { allowed: true, projectFolder: absoluteFolder };
}

export function detectProjectType(projectFolder) {
    const packageJsonPath = path.join(projectFolder, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
        return "html";
    }

    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const allDependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };

    if (allDependencies.next) {
        return "nextjs";
    }
    if (allDependencies.react) {
        return "react";
    }
    return "html";
}

function findSourceFiles(folderPath, projectType, foundFiles = []) {
    for (const folderEntry of fs.readdirSync(folderPath, { withFileTypes: true })) {
        const entryPath = path.join(folderPath, folderEntry.name);

        if (folderEntry.isDirectory()) {
            if (!SKIPPED_FOLDERS.includes(folderEntry.name)) {
                findSourceFiles(entryPath, projectType, foundFiles);
            }
            continue;
        }

        const extension = path.extname(folderEntry.name).toLowerCase();

        if (extension === ".html" || extension === ".htm") {
            foundFiles.push({ filePath: entryPath, fileKind: "html" });
        } else if (extension === ".jsx" || extension === ".tsx") {
            foundFiles.push({ filePath: entryPath, fileKind: "jsx" });
        } else if ((extension === ".js" || extension === ".ts") && projectType !== "html") {
            // Many React projects write JSX in .js files. We only touch files that contain tags.
            const fileText = fs.readFileSync(entryPath, "utf8");
            if (/<[A-Za-z][^>]*\/?>/.test(fileText) && (fileText.includes("</") || fileText.includes("/>"))) {
                foundFiles.push({ filePath: entryPath, fileKind: "jsx" });
            }
        }
    }

    return foundFiles;
}

// Returns the rule ids found in a Yngo audit report, so we only fix real problems
export function getRuleIdsFromAuditReport(auditReport) {
    if (!auditReport || !Array.isArray(auditReport.pages)) {
        throw new Error('This is not a Yngo report (it has no "pages" list)');
    }

    const reportRuleIds = new Set();
    for (const auditedPage of auditReport.pages) {
        for (const issue of auditedPage.issues) {
            reportRuleIds.add(issue.ruleId);
        }
    }
    return reportRuleIds;
}

// Same as above, for a report.json file on disk (used by the CLI)
export function getRuleIdsFromReport(reportPath) {
    if (!fs.existsSync(reportPath)) {
        throw new Error(`Report file not found: ${reportPath}`);
    }
    return getRuleIdsFromAuditReport(JSON.parse(fs.readFileSync(reportPath, "utf8")));
}

// options.reportRuleIds - Set of rule ids from a report. Empty/undefined means "run every fix".
// options.siteUrl       - live address of the site, used for canonical links
// options.language      - for <html lang="...">, default "en"
export function planFixes(projectFolder, options = {}) {
    const projectType = detectProjectType(projectFolder);
    const sourceFiles = findSourceFiles(projectFolder, projectType);
    const reportRuleIds = options.reportRuleIds;
    const plannedFiles = [];

    for (const sourceFile of sourceFiles) {
        const fixesForFile = sourceFile.fileKind === "html" ? HTML_FIXES : JSX_FIXES;
        const originalText = fs.readFileSync(sourceFile.filePath, "utf8");
        const fileInfo = {
            filePath: sourceFile.filePath,
            relativePath: path.relative(projectFolder, sourceFile.filePath),
            projectFolder: projectFolder,
            siteUrl: options.siteUrl || "",
            language: options.language || "en"
        };

        let updatedText = originalText;
        const fileChanges = [];

        for (const fix of fixesForFile) {
            const isNeededByReport = !reportRuleIds || reportRuleIds.size === 0
                || fix.fixesRuleIds.some(ruleId => reportRuleIds.has(ruleId));
            if (!isNeededByReport) {
                continue;
            }

            const fixResult = fix.apply(updatedText, fileInfo);
            updatedText = fixResult.updatedText;
            fileChanges.push(...fixResult.changes);
        }

        if (fileChanges.length > 0) {
            plannedFiles.push({
                relativePath: fileInfo.relativePath,
                originalText: originalText,
                updatedText: updatedText,
                isChanged: updatedText !== originalText,
                changes: fileChanges
            });
        }
    }

    return { projectType, scannedFileCount: sourceFiles.length, plannedFiles };
}

// Saves the original files to .yngo-backup/<time>/ and then writes the fixed files.
// Returns the backup folder path.
export function applyFixes(projectFolder, plannedFiles) {
    const changedFiles = plannedFiles.filter(plannedFile => plannedFile.isChanged);

    if (changedFiles.length === 0) {
        throw new Error("There are no file changes to apply");
    }

    // Before writing anything, check that no file was edited since we planned the fixes
    for (const changedFile of changedFiles) {
        const currentText = fs.readFileSync(path.join(projectFolder, changedFile.relativePath), "utf8");
        if (currentText !== changedFile.originalText) {
            throw new Error(`${changedFile.relativePath} changed while fixing. Run the fix command again.`);
        }
    }

    const backupName = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFolder = path.join(projectFolder, BACKUP_FOLDER_NAME, backupName);

    for (const changedFile of changedFiles) {
        const backupFilePath = path.join(backupFolder, "files", changedFile.relativePath);
        fs.mkdirSync(path.dirname(backupFilePath), { recursive: true });
        fs.writeFileSync(backupFilePath, changedFile.originalText);
    }

    const backupManifest = { createdAt: new Date().toISOString(), files: changedFiles.map(changedFile => changedFile.relativePath) };
    fs.writeFileSync(path.join(backupFolder, "manifest.json"), JSON.stringify(backupManifest, null, 2));

    for (const changedFile of changedFiles) {
        fs.writeFileSync(path.join(projectFolder, changedFile.relativePath), changedFile.updatedText);
    }

    return backupFolder;
}

// Puts back the files saved in one backup, then deletes that backup.
// Returns the list of restored files.
export function restoreBackup(projectFolder, backupName) {
    // backupName comes from our own records, but we still block "../" tricks
    if (!/^[0-9TZ-]+$/.test(backupName)) {
        throw new Error(`Invalid backup name: ${backupName}`);
    }

    const backupFolder = path.join(projectFolder, BACKUP_FOLDER_NAME, backupName);
    if (!fs.existsSync(backupFolder)) {
        throw new Error(`Backup ${backupName} was not found in ${projectFolder}. It may have been undone already.`);
    }

    const backupManifest = JSON.parse(fs.readFileSync(path.join(backupFolder, "manifest.json"), "utf8"));

    for (const relativePath of backupManifest.files) {
        const originalText = fs.readFileSync(path.join(backupFolder, "files", relativePath), "utf8");
        fs.writeFileSync(path.join(projectFolder, relativePath), originalText);
    }

    fs.rmSync(backupFolder, { recursive: true });
    return backupManifest.files;
}

// Restores the newest backup, so running undo again restores the one before
export function undoLastFix(projectFolder) {
    const backupRoot = path.join(projectFolder, BACKUP_FOLDER_NAME);
    const backupNames = fs.existsSync(backupRoot) ? fs.readdirSync(backupRoot).sort() : [];

    if (backupNames.length === 0) {
        throw new Error(`No backups found in ${projectFolder}. Nothing to undo.`);
    }

    return restoreBackup(projectFolder, backupNames[backupNames.length - 1]);
}
