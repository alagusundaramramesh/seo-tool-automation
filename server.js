import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import authRoutes from "./src/routes/authRoutes.js";
import auditRoutes from "./src/routes/auditRoutes.js";
import fixRoutes from "./src/routes/fixRoutes.js";
import folderRoutes from "./src/routes/folderRoutes.js";
import { requireLogin, loadSessionSecret } from "./src/auth.js";
import { markInterruptedAudits } from "./src/auditJobs.js";
import CONFIG from "./src/config.js";

// The whole Yngo web app. Start with: npm start  ->  http://localhost:3000

const projectFolder = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(express.json());

// Login, register and guest work without being logged in. Everything else needs a login (a guest session counts).
app.use("/api/auth", authRoutes);
app.use("/api/audits", requireLogin, auditRoutes);
app.use("/api/fixes", requireLogin, fixRoutes);
app.use("/api/folders", requireLogin, folderRoutes);

// Unknown API paths get a JSON error instead of an HTML page
app.use("/api", (req, res) => {
    res.status(404).json({ status: false, code: "API_NOT_FOUND", message: `No API at ${req.method} ${req.originalUrl}` });
});

app.use(express.static(path.join(projectFolder, "public")));

async function startServer() {
    await loadSessionSecret();
    await markInterruptedAudits();

    app.listen(CONFIG.PORT, () => {
        console.log("");
        console.log(`  Yngo is running:  http://localhost:${CONFIG.PORT}`);
        console.log(`  Reports saved to: ${CONFIG.STORAGE_DRIVER === "s3" ? `S3 bucket ${CONFIG.S3_BUCKET}` : path.resolve(CONFIG.LOCAL_STORAGE_DIR)}`);
        console.log("");
    });
}

startServer().catch(error => {
    console.error("Yngo failed to start", { reason: error.message });
    process.exit(1);
});
