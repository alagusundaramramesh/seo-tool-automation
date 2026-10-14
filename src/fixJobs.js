import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import AdmZip from "adm-zip";
import { createTwoFilesPatch } from "diff";
import { saveFile, readFile, readBinaryFile, listFolders } from "./storage.js";
import { canFixProject, planFixes, applyFixes, restoreBackup, getRuleIdsFromAuditReport, SKIPPED_FOLDERS } from "./fixer/fixProject.js";
import CONFIG from "./config.js";

// Auto-fix for the web dashboard.
//
// The project comes from one of two places:
//   "folder" - a folder path on the computer running Yngo (only when CONFIG.ALLOW_LOCAL_FOLDERS is on)
//   "zip"    - a .zip the user uploads (works locally and online)
//
// Each fix is saved in storage:
//   fixes/<fixId>/fix.json     summary + every change + diff text (what the dashboard shows)
//   fixes/<fixId>/plan.json    original and fixed text of each changed file (used to apply)
//   fixes/<fixId>/upload.zip   the uploaded project (zip only)
//   fixes/<fixId>/fixed.zip    the fixed project to download (zip only, after apply)
//
// status:  planned -> applied -> undone (undo is for folders only)

const MAX_UNZIPPED_MB = 300;

function createFixId() {
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    return `${timestamp}_${crypto.randomBytes(3).toString("hex")}`;
}

export function isValidFixId(fixId) {
    return /^[0-9T-]{19}_[a-f0-9]{6}$/.test(fixId);
}

async function saveFixRecord(fixRecord) {
    await saveFile(`fixes/${fixRecord.fixId}/fix.json`, JSON.stringify(fixRecord, null, 2), "application/json");
}

export async function getFixRecord(fixId) {
    const fixRecordText = await readFile(`fixes/${fixId}/fix.json`);
    return fixRecordText ? JSON.parse(fixRecordText) : null;
}

export async function listFixRecords(ownerId, limit) {
    const fixIds = await listFolders("fixes");
    fixIds.sort().reverse();

    const fixRecords = [];
    for (const fixId of fixIds) {
        if (fixRecords.length >= limit) {
            break;
        }

        const fixRecord = await getFixRecord(fixId);
        if (fixRecord && fixRecord.ownerId === ownerId) {
            // The list does not need every diff
            fixRecords.push({ ...fixRecord, files: undefined });
        }
    }
    return fixRecords;
}

// Gives all fixes of one user to another user (a guest who just created an account or logged in)
export async function changeFixOwner(fromOwnerId, toOwnerId) {
    const fixIds = await listFolders("fixes");

    for (const fixId of fixIds) {
        const fixRecord = await getFixRecord(fixId);
        if (fixRecord && fixRecord.ownerId === fromOwnerId) {
            fixRecord.ownerId = toOwnerId;
            await saveFixRecord(fixRecord);
        }
    }
}

// If the user picked one of their audits, only fix the problems that audit found
async function getRuleIdsForAudit(ownerId, auditId) {
    if (!auditId) {
        return undefined;
    }

    const auditRecordText = await readFile(`audits/${auditId}/audit.json`);
    const auditRecord = auditRecordText ? JSON.parse(auditRecordText) : null;
    if (!auditRecord || auditRecord.ownerId !== ownerId) {
        throw new Error("The selected audit was not found");
    }

    const reportText = await readFile(`audits/${auditId}/report.json`);
    if (!reportText) {
        throw new Error("The selected audit has no report yet. Wait until it is completed.");
    }

    return getRuleIdsFromAuditReport(JSON.parse(reportText));
}

// Plans the fixes for a folder on disk and saves the plan. Nothing in the project is changed yet.
async function createFixRecord(fixRecord, projectFolder, reportRuleIds, siteUrl) {
    const fixPlan = planFixes(projectFolder, { reportRuleIds, siteUrl });

    const changedFiles = fixPlan.plannedFiles.filter(plannedFile => plannedFile.isChanged);
    const allChanges = fixPlan.plannedFiles.flatMap(plannedFile => plannedFile.changes);

    fixRecord.projectType = fixPlan.projectType;
    fixRecord.scannedFileCount = fixPlan.scannedFileCount;
    fixRecord.changedFileCount = changedFiles.length;
    fixRecord.reviewCount = allChanges.filter(change => change.needsReview).length;
    fixRecord.autoCount = allChanges.filter(change => !change.needsReview).length;
    fixRecord.files = fixPlan.plannedFiles.map(plannedFile => ({
        relativePath: plannedFile.relativePath.split(path.sep).join("/"),
        isChanged: plannedFile.isChanged,
        changes: plannedFile.changes,
        diffText: plannedFile.isChanged
            ? createTwoFilesPatch(plannedFile.relativePath, plannedFile.relativePath, plannedFile.originalText, plannedFile.updatedText, "", "", { context: 2 })
            : ""
    }));

    const savedPlan = changedFiles.map(changedFile => ({
        relativePath: changedFile.relativePath.split(path.sep).join("/"),
        originalText: changedFile.originalText,
        updatedText: changedFile.updatedText
    }));

    await saveFile(`fixes/${fixRecord.fixId}/plan.json`, JSON.stringify(savedPlan), "application/json");
    await saveFixRecord(fixRecord);
    return fixRecord;
}

function newFixRecord(ownerId, sourceType, auditId) {
    return {
        fixId: createFixId(),
        ownerId: ownerId,
        sourceType: sourceType,
        folderPath: "",
        zipName: "",
        auditId: auditId || "",
        status: "planned",
        createdAt: new Date().toISOString(),
        appliedAt: null,
        backupName: "",
        projectType: "",
        scannedFileCount: 0,
        changedFileCount: 0,
        reviewCount: 0,
        autoCount: 0,
        files: []
    };
}

// Returns { created: true, fixRecord } or { created: false, code, reason }
export async function createFolderFix(ownerId, folderPath, auditId, siteUrl) {
    if (!CONFIG.ALLOW_LOCAL_FOLDERS) {
        return { created: false, code: "LOCAL_FOLDERS_DISABLED", reason: "Fixing folders by path is turned off on this server. Upload a .zip instead." };
    }

    const folderCheck = canFixProject(folderPath);
    if (!folderCheck.allowed) {
        return { created: false, code: "INVALID_FOLDER", reason: folderCheck.reason };
    }

    const reportRuleIds = await getRuleIdsForAudit(ownerId, auditId);
    const fixRecord = newFixRecord(ownerId, "folder", auditId);
    fixRecord.folderPath = folderCheck.projectFolder;

    return { created: true, fixRecord: await createFixRecord(fixRecord, folderCheck.projectFolder, reportRuleIds, siteUrl) };
}

// Unzips into a temporary folder, skipping node_modules and similar, and refusing unsafe paths
function extractZip(zipFile, targetFolder) {
    const zipEntries = zipFile.getEntries();

    const totalSize = zipEntries.reduce((sum, zipEntry) => sum + zipEntry.header.size, 0);
    if (totalSize > MAX_UNZIPPED_MB * 1024 * 1024) {
        throw new Error(`The project is bigger than ${MAX_UNZIPPED_MB} MB when unzipped. Remove node_modules and build folders and try again.`);
    }

    for (const zipEntry of zipEntries) {
        if (zipEntry.isDirectory) {
            continue;
        }

        const entryParts = zipEntry.entryName.split("/");
        if (entryParts.some(entryPart => SKIPPED_FOLDERS.includes(entryPart))) {
            continue;
        }

        // A bad zip can contain names like "../../etc/passwd". Those must never leave the target folder.
        const outputPath = path.resolve(targetFolder, zipEntry.entryName);
        if (!outputPath.startsWith(path.resolve(targetFolder) + path.sep)) {
            throw new Error(`Unsafe file path in zip: ${zipEntry.entryName}`);
        }

        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, zipEntry.getData());
    }
}

// Many zips have everything inside one top folder ("my-site/index.html"). We fix from inside that folder.
function getProjectRoot(extractFolder) {
    const topEntries = fs.readdirSync(extractFolder);
    if (topEntries.length === 1 && fs.statSync(path.join(extractFolder, topEntries[0])).isDirectory()) {
        return { projectRoot: path.join(extractFolder, topEntries[0]), zipPrefix: `${topEntries[0]}/` };
    }
    return { projectRoot: extractFolder, zipPrefix: "" };
}

export async function createZipFix(ownerId, zipBuffer, zipName, auditId, siteUrl) {
    if (!zipBuffer || zipBuffer.length === 0) {
        return { created: false, code: "ZIP_REQUIRED", reason: "Please choose a .zip file of your project" };
    }

    let zipFile;
    try {
        zipFile = new AdmZip(zipBuffer);
        zipFile.getEntries();
    } catch (error) {
        return { created: false, code: "INVALID_ZIP", reason: "This file is not a valid .zip" };
    }

    const reportRuleIds = await getRuleIdsForAudit(ownerId, auditId);
    const fixRecord = newFixRecord(ownerId, "zip", auditId);
    fixRecord.zipName = path.basename(zipName || "project.zip");

    const extractFolder = fs.mkdtempSync(path.join(os.tmpdir(), "yngo-fix-"));
    try {
        extractZip(zipFile, extractFolder);
        const { projectRoot, zipPrefix } = getProjectRoot(extractFolder);
        fixRecord.zipPrefix = zipPrefix;

        await saveFile(`fixes/${fixRecord.fixId}/upload.zip`, zipBuffer, "application/zip");
        return { created: true, fixRecord: await createFixRecord(fixRecord, projectRoot, reportRuleIds, siteUrl) };
    } finally {
        // The unzipped copy was only needed for planning
        fs.rmSync(extractFolder, { recursive: true, force: true });
    }
}

// Business rules for each action. Returns { allowed, code, reason }.
export function canApplyFix(fixRecord) {
    if (fixRecord.status !== "planned") {
        return { allowed: false, code: "FIX_ALREADY_APPLIED", reason: `These fixes are already ${fixRecord.status}` };
    }
    if (fixRecord.changedFileCount === 0) {
        return { allowed: false, code: "NOTHING_TO_APPLY", reason: "There are no file changes to apply. The review items must be fixed by hand." };
    }
    if (fixRecord.sourceType === "folder" && !CONFIG.ALLOW_LOCAL_FOLDERS) {
        return { allowed: false, code: "LOCAL_FOLDERS_DISABLED", reason: "Fixing folders is turned off on this server" };
    }
    return { allowed: true };
}

export function canUndoFix(fixRecord) {
    if (fixRecord.sourceType !== "folder") {
        return { allowed: false, code: "UNDO_NOT_AVAILABLE", reason: "Undo is only for folders. For a .zip, just keep using your original files." };
    }
    if (fixRecord.status !== "applied") {
        return { allowed: false, code: "FIX_NOT_APPLIED", reason: "Only applied fixes can be undone" };
    }
    return { allowed: true };
}

async function getSavedPlan(fixId) {
    const planText = await readFile(`fixes/${fixId}/plan.json`);
    if (!planText) {
        throw new Error(`Saved plan for fix ${fixId} is missing`);
    }
    return JSON.parse(planText);
}

export async function applyFix(fixRecord) {
    const savedPlan = await getSavedPlan(fixRecord.fixId);

    if (fixRecord.sourceType === "folder") {
        // applyFixes checks each file is unchanged since planning, then makes a backup and writes
        const plannedFiles = savedPlan.map(plannedFile => ({
            relativePath: plannedFile.relativePath.split("/").join(path.sep),
            originalText: plannedFile.originalText,
            updatedText: plannedFile.updatedText,
            isChanged: true
        }));
        const backupFolder = applyFixes(fixRecord.folderPath, plannedFiles);
        fixRecord.backupName = path.basename(backupFolder);
    } else {
        // For a zip, we put the fixed files into a copy of the uploaded zip
        const uploadedZip = await readBinaryFile(`fixes/${fixRecord.fixId}/upload.zip`);
        const fixedZip = new AdmZip(uploadedZip);

        for (const plannedFile of savedPlan) {
            fixedZip.updateFile(`${fixRecord.zipPrefix}${plannedFile.relativePath}`, Buffer.from(plannedFile.updatedText, "utf8"));
        }
        await saveFile(`fixes/${fixRecord.fixId}/fixed.zip`, fixedZip.toBuffer(), "application/zip");
    }

    fixRecord.status = "applied";
    fixRecord.appliedAt = new Date().toISOString();
    await saveFixRecord(fixRecord);
    return fixRecord;
}

export async function undoFix(fixRecord) {
    restoreBackup(fixRecord.folderPath, fixRecord.backupName);
    fixRecord.status = "undone";
    await saveFixRecord(fixRecord);
    return fixRecord;
}

export async function getFixedZip(fixRecord) {
    if (fixRecord.sourceType !== "zip" || fixRecord.status !== "applied") {
        return null;
    }
    return await readBinaryFile(`fixes/${fixRecord.fixId}/fixed.zip`);
}
