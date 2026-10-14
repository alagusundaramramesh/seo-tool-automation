import "dotenv/config";

// All settings come from environment variables (or the .env file).
// See .env.example for what each one means.
const CONFIG = {
    // "local" saves reports on this computer, "s3" saves them in an AWS S3 bucket
    STORAGE_DRIVER: process.env.STORAGE_DRIVER || "local",
    LOCAL_STORAGE_DIR: process.env.LOCAL_STORAGE_DIR || "./storage",

    S3_BUCKET: process.env.S3_BUCKET || "",
    S3_REGION: process.env.S3_REGION || "ap-south-1",

    // How many pages we audit per site in one run
    MAX_PAGES: Number(process.env.MAX_PAGES || 10),

    // false on a public server, so nobody can use it to scan localhost or private networks
    ALLOW_PRIVATE_URLS: process.env.ALLOW_PRIVATE_URLS !== "false",

    // Web dashboard port (npm start)
    PORT: Number(process.env.PORT || 3000),

    // true: the dashboard can fix a project folder on this computer by its path.
    // Set to false on a public server, so users cannot read or change the server's own files.
    ALLOW_LOCAL_FOLDERS: process.env.ALLOW_LOCAL_FOLDERS !== "false",

    // Biggest project .zip a user can upload for auto-fix
    MAX_UPLOAD_MB: Number(process.env.MAX_UPLOAD_MB || 50),

    // Secret used to sign login cookies. If empty, one is created and saved in storage on first start.
    SESSION_SECRET: process.env.SESSION_SECRET || "",

    // true when the site is served over https (online). Keeps the login cookie https-only.
    COOKIE_SECURE: process.env.COOKIE_SECURE === "true",

    // Optional: path to a Chrome/Chromium binary. Empty means "find Chrome automatically".
    CHROME_PATH: process.env.CHROME_PATH || ""
};

export default CONFIG;
