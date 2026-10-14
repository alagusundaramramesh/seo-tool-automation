import express from "express";
import multer from "multer";
import CONFIG from "../config.js";
import {
    createFolderFix, createZipFix, getFixRecord, listFixRecords, isValidFixId,
    canApplyFix, canUndoFix, applyFix, undoFix, getFixedZip
} from "../fixJobs.js";

// Auto-fix API. Every route here needs a logged-in user (see server.js).

const router = express.Router();

// Keeps the uploaded zip in memory (it is saved to storage by createZipFix)
const zipUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: CONFIG.MAX_UPLOAD_MB * 1024 * 1024 }
});

async function loadOwnFix(req, res) {
    const fixId = req.params.fixId;

    if (!isValidFixId(fixId)) {
        res.status(400).json({ status: false, code: "INVALID_FIX_ID", message: "Invalid fix id" });
        return null;
    }

    const fixRecord = await getFixRecord(fixId);
    if (!fixRecord || fixRecord.ownerId !== res.locals.user.userId) {
        res.status(404).json({ status: false, code: "FIX_NOT_FOUND", message: "Fix not found" });
        return null;
    }

    return fixRecord;
}

// Check a folder on this computer. Body: { "folderPath": "...", "auditId": "...", "siteUrl": "..." }
router.post("/folder", async (req, res) => {
    const { folderPath, auditId, siteUrl } = req.body || {};

    try {
        const fixStart = await createFolderFix(res.locals.user.userId, folderPath, auditId, siteUrl);

        if (!fixStart.created) {
            return res.status(400).json({ status: false, code: fixStart.code, message: fixStart.reason });
        }

        return res.status(201).json({ status: true, fix: fixStart.fixRecord });
    } catch (error) {
        console.error("Could not check folder", { folderPath, reason: error.message });
        return res.status(500).json({ status: false, code: "FIX_CHECK_FAILED", message: error.message });
    }
});

// Check an uploaded .zip. Form fields: projectZip (file), auditId, siteUrl
router.post("/upload", (req, res) => {
    zipUpload.single("projectZip")(req, res, async (uploadError) => {
        if (uploadError) {
            const message = uploadError.code === "LIMIT_FILE_SIZE"
                ? `The zip is bigger than ${CONFIG.MAX_UPLOAD_MB} MB. Remove node_modules and build folders and try again.`
                : "Upload failed. Please try again.";
            return res.status(400).json({ status: false, code: "UPLOAD_FAILED", message });
        }

        if (!req.file) {
            return res.status(400).json({ status: false, code: "ZIP_REQUIRED", message: "Please choose a .zip file of your project" });
        }

        try {
            const fixStart = await createZipFix(res.locals.user.userId, req.file.buffer, req.file.originalname, req.body.auditId, req.body.siteUrl);

            if (!fixStart.created) {
                return res.status(400).json({ status: false, code: fixStart.code, message: fixStart.reason });
            }

            return res.status(201).json({ status: true, fix: fixStart.fixRecord });
        } catch (error) {
            console.error("Could not check uploaded zip", { zipName: req.file.originalname, reason: error.message });
            return res.status(500).json({ status: false, code: "FIX_CHECK_FAILED", message: error.message });
        }
    });
});

router.get("/", async (req, res) => {
    try {
        const fixes = await listFixRecords(res.locals.user.userId, 30);
        return res.json({ status: true, fixes });
    } catch (error) {
        console.error("Could not list fixes", { reason: error.message });
        return res.status(500).json({ status: false, code: "FIX_LIST_FAILED", message: "Unable to load fixes" });
    }
});

router.get("/:fixId", async (req, res) => {
    try {
        const fixRecord = await loadOwnFix(req, res);
        if (!fixRecord) {
            return;
        }
        return res.json({ status: true, fix: fixRecord });
    } catch (error) {
        console.error("Could not load fix", { fixId: req.params.fixId, reason: error.message });
        return res.status(500).json({ status: false, code: "FIX_LOAD_FAILED", message: "Unable to load fix" });
    }
});

router.post("/:fixId/apply", async (req, res) => {
    try {
        const fixRecord = await loadOwnFix(req, res);
        if (!fixRecord) {
            return;
        }

        const decision = canApplyFix(fixRecord);
        if (!decision.allowed) {
            return res.status(400).json({ status: false, code: decision.code, message: decision.reason });
        }

        return res.json({ status: true, fix: await applyFix(fixRecord) });
    } catch (error) {
        console.error("Could not apply fix", { fixId: req.params.fixId, reason: error.message });
        return res.status(500).json({ status: false, code: "FIX_APPLY_FAILED", message: error.message });
    }
});

router.post("/:fixId/undo", async (req, res) => {
    try {
        const fixRecord = await loadOwnFix(req, res);
        if (!fixRecord) {
            return;
        }

        const decision = canUndoFix(fixRecord);
        if (!decision.allowed) {
            return res.status(400).json({ status: false, code: decision.code, message: decision.reason });
        }

        return res.json({ status: true, fix: await undoFix(fixRecord) });
    } catch (error) {
        console.error("Could not undo fix", { fixId: req.params.fixId, reason: error.message });
        return res.status(500).json({ status: false, code: "FIX_UNDO_FAILED", message: error.message });
    }
});

router.get("/:fixId/download", async (req, res) => {
    try {
        const fixRecord = await loadOwnFix(req, res);
        if (!fixRecord) {
            return;
        }

        const fixedZip = await getFixedZip(fixRecord);
        if (!fixedZip) {
            return res.status(400).json({ status: false, code: "DOWNLOAD_NOT_READY", message: "Apply the fixes first, then download" });
        }

        const downloadName = fixRecord.zipName.replace(/\.zip$/i, "") + "-fixed.zip";
        res.set("Content-Type", "application/zip");
        res.set("Content-Disposition", `attachment; filename="${downloadName.replace(/"/g, "")}"`);
        return res.send(fixedZip);
    } catch (error) {
        console.error("Could not download fixed zip", { fixId: req.params.fixId, reason: error.message });
        return res.status(500).json({ status: false, code: "DOWNLOAD_FAILED", message: "Unable to download" });
    }
});

export default router;
