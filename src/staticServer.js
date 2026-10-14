import http from "http";
import fs from "fs";
import path from "path";

// A tiny web server for a folder of plain HTML files (or a React build folder).
// Used by "fix --compare" to audit a local HTML project before and after fixing it,
// and by "serve" to preview a folder (npm run sample-site).

const CONTENT_TYPES = {
    ".html": "text/html",
    ".htm": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".webmanifest": "application/manifest+json",
    ".ico": "image/x-icon",
    ".txt": "text/plain",
    ".xml": "application/xml"
};

// Returns { siteUrl, stop } once the server is listening.
// port 0 means "pick any free port".
// options.isSinglePageApp: true for React builds. Their routes like /about have no file,
// so we answer with index.html and the app shows the right page in the browser.
export function startStaticServer(folderPath, port = 0, options = {}) {
    const rootFolder = path.resolve(folderPath);

    const server = http.createServer((req, res) => {
        const urlPath = decodeURIComponent(req.url.split("?")[0]);
        let filePath = path.join(rootFolder, urlPath);

        // Never serve files outside the folder (for example /../../secret.txt)
        if (filePath !== rootFolder && !filePath.startsWith(rootFolder + path.sep)) {
            res.writeHead(403);
            return res.end("Forbidden");
        }

        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
            filePath = path.join(filePath, "index.html");
        }

        const isAppRoute = options.isSinglePageApp && path.extname(urlPath) === "";
        if (!fs.existsSync(filePath) && isAppRoute) {
            filePath = path.join(rootFolder, "index.html");
        }

        if (!fs.existsSync(filePath)) {
            res.writeHead(404, { "Content-Type": "text/plain" });
            return res.end("Not found");
        }

        const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": contentType });
        fs.createReadStream(filePath).pipe(res);
    });

    return new Promise((resolve) => {
        server.listen(port, "127.0.0.1", () => {
            const listeningPort = server.address().port;
            resolve({
                siteUrl: `http://127.0.0.1:${listeningPort}/`,
                stop: () => new Promise(resolveStop => server.close(resolveStop))
            });
        });
    });
}
