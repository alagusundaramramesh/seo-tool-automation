import path from "path";
import fs from "fs";
import { runSiteAudit, createAuditId, checkSiteUrl } from "./audit.js";
import { saveFile, readFile, listFolders } from "./storage.js";
import { startStaticServer } from "./staticServer.js";
import { detectProjectType } from "./fixer/fixProject.js";
import CONFIG from "./config.js";

// Runs audits for the web dashboard in the background, one at a time.
//
// Each audit has a small record saved at audits/<auditId>/audit.json:
//   { auditId, ownerId, siteUrl, folderPath, maxPages, status, progress, error, createdAt, finishedAt, siteScores, pageCount, issueCount }
//
// An audit checks either a website (siteUrl) or a project folder on this computer (folderPath):
// a plain HTML folder, or a React / Vite / Next.js project with a build folder.
//
// status moves only forward:  queued -> running -> completed
//                                              \-> failed

const waitingAuditIds = [];
let isQueueRunning = false;

// When a guest creates an account, their audits move to the new user: { guestUserId: newUserId }.
// A running audit keeps its record in memory, so saveAuditRecord checks this too.
const movedOwnerIds = {};

async function saveAuditRecord(auditRecord) {
    if (movedOwnerIds[auditRecord.ownerId]) {
        auditRecord.ownerId = movedOwnerIds[auditRecord.ownerId];
    }
    await saveFile(`audits/${auditRecord.auditId}/audit.json`, JSON.stringify(auditRecord, null, 2), "application/json");
}

export async function getAuditRecord(auditId) {
    const auditRecordText = await readFile(`audits/${auditId}/audit.json`);

    if (!auditRecordText) {
        return null;
    }
    return JSON.parse(auditRecordText);
}

// Newest first, only this user's audits
export async function listAuditRecords(ownerId, limit) {
    const auditIds = await listFolders("audits");
    auditIds.sort().reverse();

    const auditRecords = [];
    for (const auditId of auditIds) {
        if (auditRecords.length >= limit) {
            break;
        }

        const auditRecord = await getAuditRecord(auditId);
        if (auditRecord && auditRecord.ownerId === ownerId) {
            auditRecords.push(auditRecord);
        }
    }

    return auditRecords;
}

// Gives all audits of one user to another user (a guest who just created an account or logged in)
export async function changeAuditOwner(fromOwnerId, toOwnerId) {
    movedOwnerIds[fromOwnerId] = toOwnerId;

    const auditIds = await listFolders("audits");
    for (const auditId of auditIds) {
        const auditRecord = await getAuditRecord(auditId);
        if (auditRecord && auditRecord.ownerId === fromOwnerId) {
            await saveAuditRecord(auditRecord);
        }
    }
}

async function isAlreadyWaiting(ownerId, targetName) {
    for (const waitingAuditId of waitingAuditIds) {
        const waitingAudit = await getAuditRecord(waitingAuditId);
        const waitingTargetName = waitingAudit && (waitingAudit.folderPath || new URL(waitingAudit.siteUrl).host);

        if (waitingAudit && waitingAudit.ownerId === ownerId && waitingTargetName === targetName) {
            return true;
        }
    }
    return false;
}

function createAuditRecord(ownerId, auditTarget) {
    const now = new Date();
    const folderName = path.basename(auditTarget.folderPath || "").replace(/[^a-zA-Z0-9-]/g, "-");
    const auditIdSource = auditTarget.siteUrl || `http://folder-${folderName}/`;

    return {
        auditId: createAuditId(auditIdSource, now),
        ownerId: ownerId,
        siteUrl: auditTarget.siteUrl || "",
        folderPath: auditTarget.folderPath || "",
        maxPages: auditTarget.maxPages,
        status: "queued",
        progress: "Waiting for other audits to finish",
        error: "",
        createdAt: now.toISOString(),
        finishedAt: null,
        siteScores: null,
        pageCount: 0,
        issueCount: 0
    };
}

async function queueAudit(auditRecord) {
    await saveAuditRecord(auditRecord);
    waitingAuditIds.push(auditRecord.auditId);

    // We do not wait here: the audit runs in the background and the dashboard polls for its status
    runQueue();
}

// Returns { started: true, auditRecord } or { started: false, code, reason }
export async function startAudit(ownerId, siteUrl, maxPages) {
    const urlCheck = checkSiteUrl(siteUrl);
    if (!urlCheck.allowed) {
        return { started: false, code: "INVALID_SITE_URL", reason: urlCheck.reason };
    }

    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > CONFIG.MAX_PAGES) {
        return { started: false, code: "INVALID_MAX_PAGES", reason: `Pages must be a whole number from 1 to ${CONFIG.MAX_PAGES}` };
    }

    const siteHost = new URL(urlCheck.siteUrl).host;
    if (await isAlreadyWaiting(ownerId, siteHost)) {
        return { started: false, code: "AUDIT_ALREADY_QUEUED", reason: `An audit for ${siteHost} is already waiting or running` };
    }

    const auditRecord = createAuditRecord(ownerId, { siteUrl: urlCheck.siteUrl, maxPages });
    await queueAudit(auditRecord);
    return { started: true, auditRecord };
}

// Build folders that React / Vite / Next.js (static export) create with "npm run build"
const BUILD_FOLDER_NAMES = ["dist", "build", "out"];

// Decides which folder we serve for a folder audit.
// Plain HTML: the folder itself. React / Next.js: its build folder, because the source files cannot run in a browser.
// Returns { allowed, projectType, folderToServe, isSinglePageApp } or { allowed: false, projectType, code, reason }
export function findAuditableFolder(projectFolder) {
    if (!projectFolder || !fs.existsSync(projectFolder) || !fs.statSync(projectFolder).isDirectory()) {
        return { allowed: false, projectType: "", code: "FOLDER_NOT_FOUND", reason: "Folder not found. Please choose the folder again." };
    }

    const projectType = detectProjectType(projectFolder);
    const hasPackageJson = fs.existsSync(path.join(projectFolder, "package.json"));

    if (!hasPackageJson) {
        if (fs.existsSync(path.join(projectFolder, "index.html"))) {
            return { allowed: true, projectType, folderToServe: projectFolder, isSinglePageApp: false };
        }
        return { allowed: false, projectType, code: "NOT_AN_HTML_FOLDER", reason: "This folder has no index.html. Choose your website folder, or a React project folder." };
    }

    for (const buildFolderName of BUILD_FOLDER_NAMES) {
        const buildFolder = path.join(projectFolder, buildFolderName);
        if (fs.existsSync(path.join(buildFolder, "index.html"))) {
            return { allowed: true, projectType, folderToServe: buildFolder, isSinglePageApp: true };
        }
    }

    if (projectType === "nextjs") {
        return {
            allowed: false, projectType, code: "BUILD_REQUIRED",
            reason: "This Next.js project has no static build. Start it with \"npm run dev\" and audit its address (for example http://localhost:3000), or add output: \"export\" to next.config.js and run \"npm run build\"."
        };
    }

    return {
        allowed: false, projectType, code: "BUILD_REQUIRED",
        reason: "This project has no build yet. Run \"npm run build\" in the folder and try again, or start it with \"npm run dev\" / \"npm start\" and audit its address (for example http://localhost:5173)."
    };
}

// Audits a project folder on this computer (plain HTML or a built React app) by serving it on a temporary local address
export async function startFolderAudit(ownerId, folderPath) {
    if (!CONFIG.ALLOW_LOCAL_FOLDERS) {
        return { started: false, code: "LOCAL_FOLDERS_DISABLED", reason: "Auditing folders is turned off on this server" };
    }

    if (!folderPath) {
        return { started: false, code: "FOLDER_REQUIRED", reason: "Please choose a project folder" };
    }

    const absoluteFolder = path.resolve(String(folderPath));
    const folderCheck = findAuditableFolder(absoluteFolder);
    if (!folderCheck.allowed) {
        return { started: false, code: folderCheck.code, reason: folderCheck.reason };
    }

    if (await isAlreadyWaiting(ownerId, absoluteFolder)) {
        return { started: false, code: "AUDIT_ALREADY_QUEUED", reason: "An audit for this folder is already waiting or running" };
    }

    const auditRecord = createAuditRecord(ownerId, { folderPath: absoluteFolder, maxPages: CONFIG.MAX_PAGES });
    auditRecord.projectType = folderCheck.projectType;
    await queueAudit(auditRecord);
    return { started: true, auditRecord };
}

async function runQueue() {
    if (isQueueRunning) {
        return;
    }
    isQueueRunning = true;

    while (waitingAuditIds.length > 0) {
        const auditId = waitingAuditIds[0];
        await runOneAudit(auditId);
        waitingAuditIds.shift();
    }

    isQueueRunning = false;
}

async function runOneAudit(auditId) {
    const auditRecord = await getAuditRecord(auditId);

    if (!auditRecord || auditRecord.status !== "queued") {
        console.error("Skipping audit that is not queued", { auditId, status: auditRecord && auditRecord.status });
        return;
    }

    auditRecord.status = "running";
    auditRecord.progress = "Starting";
    await saveAuditRecord(auditRecord);

    let folderServer = null;

    try {
        let urlToAudit = auditRecord.siteUrl;
        if (auditRecord.folderPath) {
            // Checked again here: the build folder may have changed since the audit was queued
            const folderCheck = findAuditableFolder(auditRecord.folderPath);
            if (!folderCheck.allowed) {
                throw new Error(folderCheck.reason);
            }
            folderServer = await startStaticServer(folderCheck.folderToServe, 0, { isSinglePageApp: folderCheck.isSinglePageApp });
            urlToAudit = folderServer.siteUrl;
        }

        const { auditReport } = await runSiteAudit(urlToAudit, {
            auditId: auditId,
            maxPages: auditRecord.maxPages,
            allowPrivateUrl: Boolean(auditRecord.folderPath),
            onProgress: async (progressText) => {
                auditRecord.progress = progressText;
                await saveAuditRecord(auditRecord);
            }
        });

        auditRecord.status = "completed";
        auditRecord.siteScores = auditReport.siteScores;
        auditRecord.pageCount = auditReport.pageCount;
        auditRecord.issueCount = auditReport.issueCount;
    } catch (error) {
        console.error("Audit failed", { auditId, siteUrl: auditRecord.siteUrl, folderPath: auditRecord.folderPath, reason: error.message });
        auditRecord.status = "failed";
        auditRecord.error = error.message;
    } finally {
        if (folderServer) {
            await folderServer.stop();
        }
    }

    auditRecord.progress = "";
    auditRecord.finishedAt = new Date().toISOString();
    await saveAuditRecord(auditRecord);
}

// When the server restarts, audits that were queued or running are lost from memory.
// We mark them failed so the dashboard does not show them as "running" forever.
export async function markInterruptedAudits() {
    const auditIds = await listFolders("audits");

    for (const auditId of auditIds) {
        const auditRecord = await getAuditRecord(auditId);
        if (!auditRecord || (auditRecord.status !== "queued" && auditRecord.status !== "running")) {
            continue;
        }

        auditRecord.status = "failed";
        auditRecord.progress = "";
        auditRecord.error = "The server restarted before this audit finished. Please run it again.";
        auditRecord.finishedAt = new Date().toISOString();
        await saveAuditRecord(auditRecord);
    }
}
