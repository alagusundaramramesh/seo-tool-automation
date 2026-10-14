import express from "express";
import { startAudit, startFolderAudit, getAuditRecord, listAuditRecords } from "../auditJobs.js";
import { readFile } from "../storage.js";
import CONFIG from "../config.js";

// Audit API. Every route here needs a logged-in user (see server.js).
// Users only see their own audits: someone else's audit answers "not found".

const router = express.Router();

// auditId comes from the URL, so we check its shape before using it as a storage folder name
function isValidAuditId(auditId) {
    return /^[0-9T-]{19}_[a-zA-Z0-9._-]+$/.test(auditId);
}

// Loads the audit and checks it belongs to the logged-in user. Sends the error response itself and returns null on failure.
async function loadOwnAudit(req, res) {
    const auditId = req.params.auditId;

    if (!isValidAuditId(auditId)) {
        res.status(400).json({ status: false, code: "INVALID_AUDIT_ID", message: "Invalid audit id" });
        return null;
    }

    const audit = await getAuditRecord(auditId);
    if (!audit || audit.ownerId !== res.locals.user.userId) {
        res.status(404).json({ status: false, code: "AUDIT_NOT_FOUND", message: "Audit not found" });
        return null;
    }

    return audit;
}

// Start a website audit. Body: { "siteUrl": "https://example.com", "maxPages": 5 }
router.post("/", async (req, res) => {
    const siteUrl = req.body && req.body.siteUrl;
    const maxPages = req.body && req.body.maxPages ? Number(req.body.maxPages) : CONFIG.MAX_PAGES;

    if (!siteUrl) {
        return res.status(400).json({ status: false, code: "SITE_URL_REQUIRED", message: "Please enter a website URL" });
    }

    try {
        const auditStart = await startAudit(res.locals.user.userId, siteUrl, maxPages);

        if (!auditStart.started) {
            return res.status(400).json({ status: false, code: auditStart.code, message: auditStart.reason });
        }

        return res.status(201).json({ status: true, audit: auditStart.auditRecord });
    } catch (error) {
        console.error("Could not start audit", { siteUrl, reason: error.message });
        return res.status(500).json({ status: false, code: "AUDIT_START_FAILED", message: "Unable to start the audit. Please try again." });
    }
});

// Audit a plain HTML folder on this computer. Body: { "folderPath": "C:\\sites\\my-shop" }
router.post("/folder", async (req, res) => {
    const folderPath = req.body && req.body.folderPath;

    try {
        const auditStart = await startFolderAudit(res.locals.user.userId, folderPath);

        if (!auditStart.started) {
            return res.status(400).json({ status: false, code: auditStart.code, message: auditStart.reason });
        }

        return res.status(201).json({ status: true, audit: auditStart.auditRecord });
    } catch (error) {
        console.error("Could not start folder audit", { folderPath, reason: error.message });
        return res.status(500).json({ status: false, code: "AUDIT_START_FAILED", message: "Unable to start the audit. Please try again." });
    }
});

router.get("/", async (req, res) => {
    try {
        const audits = await listAuditRecords(res.locals.user.userId, 50);
        return res.json({ status: true, audits });
    } catch (error) {
        console.error("Could not list audits", { reason: error.message });
        return res.status(500).json({ status: false, code: "AUDIT_LIST_FAILED", message: "Unable to load audits" });
    }
});

router.get("/:auditId", async (req, res) => {
    try {
        const audit = await loadOwnAudit(req, res);
        if (!audit) {
            return;
        }
        return res.json({ status: true, audit });
    } catch (error) {
        console.error("Could not load audit", { auditId: req.params.auditId, reason: error.message });
        return res.status(500).json({ status: false, code: "AUDIT_LOAD_FAILED", message: "Unable to load audit" });
    }
});

router.get("/:auditId/report.json", async (req, res) => {
    try {
        const audit = await loadOwnAudit(req, res);
        if (!audit) {
            return;
        }

        const reportText = await readFile(`audits/${audit.auditId}/report.json`);
        if (!reportText) {
            return res.status(404).json({ status: false, code: "REPORT_NOT_READY", message: "Report is not ready yet" });
        }

        res.set("Content-Type", "application/json");
        res.set("Content-Disposition", `attachment; filename="yngo-report-${audit.auditId}.json"`);
        return res.send(reportText);
    } catch (error) {
        console.error("Could not load report", { auditId: req.params.auditId, reason: error.message });
        return res.status(500).json({ status: false, code: "REPORT_LOAD_FAILED", message: "Unable to load report" });
    }
});

router.get("/:auditId/report.html", async (req, res) => {
    try {
        const audit = await loadOwnAudit(req, res);
        if (!audit) {
            return;
        }

        const reportHtml = await readFile(`audits/${audit.auditId}/report.html`);
        if (!reportHtml) {
            return res.status(404).send("Report is not ready yet");
        }

        res.set("Content-Type", "text/html");
        return res.send(reportHtml);
    } catch (error) {
        console.error("Could not load HTML report", { auditId: req.params.auditId, reason: error.message });
        return res.status(500).send("Unable to load report");
    }
});

export default router;
