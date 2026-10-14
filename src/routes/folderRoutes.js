import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import CONFIG from "../config.js";
import { findAuditableFolder } from "../auditJobs.js";

// Folder picker API. The dashboard uses it to let users click through the folders
// on the computer running Yngo, instead of typing a path by hand.
// Only folder names are returned, never file contents.
// Works only when CONFIG.ALLOW_LOCAL_FOLDERS is on (Yngo running on your own computer).

const router = express.Router();

// Folders that are never a project to choose, so we hide them to keep the list short
const HIDDEN_FOLDER_NAMES = ["node_modules", "$RECYCLE.BIN", "System Volume Information"];

// On Windows the starting point is the list of drives (C:\, D:\ ...). Elsewhere it is "/".
function getStartFolders() {
    if (process.platform !== "win32") {
        return [
            { name: "Home", path: os.homedir() },
            { name: "/", path: "/" }
        ];
    }

    const driveFolders = [];
    for (const driveLetter of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
        const drivePath = `${driveLetter}:\\`;
        if (fs.existsSync(drivePath)) {
            driveFolders.push({ name: `${driveLetter}:`, path: drivePath });
        }
    }
    return driveFolders;
}

// Short description of a folder, so the picker can say "React project, ready to audit"
function describeProject(folderPath) {
    const folderCheck = findAuditableFolder(folderPath);
    const hasProjectFiles = fs.existsSync(path.join(folderPath, "package.json")) || fs.existsSync(path.join(folderPath, "index.html"));

    if (!hasProjectFiles) {
        return null;
    }

    return {
        projectType: folderCheck.projectType,
        canAudit: folderCheck.allowed,
        auditFolder: folderCheck.allowed ? path.relative(folderPath, folderCheck.folderToServe) : "",
        reason: folderCheck.allowed ? "" : folderCheck.reason
    };
}

// GET /api/folders?path=D:\projects  ->  the folders inside it
// GET /api/folders                   ->  drives (Windows) or home and / (Mac, Linux)
router.get("/", (req, res) => {
    if (!CONFIG.ALLOW_LOCAL_FOLDERS) {
        return res.status(403).json({ status: false, code: "LOCAL_FOLDERS_DISABLED", message: "Choosing folders is turned off on this server. Upload a .zip instead." });
    }

    const requestedPath = req.query.path ? String(req.query.path) : "";

    if (!requestedPath) {
        return res.json({ status: true, currentPath: "", parentPath: null, folders: getStartFolders(), project: null });
    }

    const currentPath = path.resolve(requestedPath);

    try {
        if (!fs.statSync(currentPath).isDirectory()) {
            return res.status(400).json({ status: false, code: "NOT_A_FOLDER", message: "This is not a folder" });
        }

        const childFolders = fs.readdirSync(currentPath, { withFileTypes: true })
            .filter(folderEntry => folderEntry.isDirectory())
            .filter(folderEntry => !folderEntry.name.startsWith(".") && !HIDDEN_FOLDER_NAMES.includes(folderEntry.name))
            .map(folderEntry => ({ name: folderEntry.name, path: path.join(currentPath, folderEntry.name) }))
            .sort((first, second) => first.name.localeCompare(second.name));

        // At a drive root (C:\ or /) the parent is the start list
        const parentFolder = path.dirname(currentPath);
        const parentPath = parentFolder === currentPath ? "" : parentFolder;

        return res.json({ status: true, currentPath, parentPath, folders: childFolders, project: describeProject(currentPath) });
    } catch (error) {
        if (error.code === "ENOENT") {
            return res.status(404).json({ status: false, code: "FOLDER_NOT_FOUND", message: `Folder not found: ${currentPath}` });
        }
        if (error.code === "EPERM" || error.code === "EACCES") {
            return res.status(403).json({ status: false, code: "FOLDER_NOT_ALLOWED", message: "Yngo is not allowed to open this folder" });
        }

        console.error("Could not list folder", { currentPath, reason: error.message });
        return res.status(500).json({ status: false, code: "FOLDER_LIST_FAILED", message: "Unable to open this folder" });
    }
});

export default router;
