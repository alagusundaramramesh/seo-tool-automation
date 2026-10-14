import fs from "fs/promises";
import path from "path";
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import CONFIG from "./config.js";

// Storage works in two modes, chosen by CONFIG.STORAGE_DRIVER:
//   "local" -> files are written under CONFIG.LOCAL_STORAGE_DIR
//   "s3"    -> files are uploaded to CONFIG.S3_BUCKET
// The rest of the app only calls saveFile(), readFile(), readBinaryFile() and listFolders() and does not care which mode is on.

let s3Client = null;

function getS3Client() {
    if (!CONFIG.S3_BUCKET) {
        throw new Error("S3_BUCKET is not set. Add it to .env or use STORAGE_DRIVER=local");
    }

    if (!s3Client) {
        // AWS credentials are read automatically from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
        s3Client = new S3Client({ region: CONFIG.S3_REGION });
    }

    return s3Client;
}

// Keys look like "audits/example.com/2026-10-13T06-50-00/report.json".
// We block ".." so a key can never write outside the storage folder.
function checkFileKey(fileKey) {
    if (!fileKey || fileKey.includes("..")) {
        throw new Error(`Invalid storage key: "${fileKey}"`);
    }
}

export async function saveFile(fileKey, content, contentType) {
    checkFileKey(fileKey);

    if (CONFIG.STORAGE_DRIVER === "s3") {
        await getS3Client().send(new PutObjectCommand({
            Bucket: CONFIG.S3_BUCKET,
            Key: fileKey,
            Body: content,
            ContentType: contentType
        }));

        return `s3://${CONFIG.S3_BUCKET}/${fileKey}`;
    }

    if (CONFIG.STORAGE_DRIVER !== "local") {
        throw new Error(`Unknown STORAGE_DRIVER "${CONFIG.STORAGE_DRIVER}". Use "local" or "s3"`);
    }

    const filePath = path.resolve(CONFIG.LOCAL_STORAGE_DIR, fileKey);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content);

    return filePath;
}

// Returns the file text, or null when the file does not exist
export async function readFile(fileKey) {
    checkFileKey(fileKey);

    if (CONFIG.STORAGE_DRIVER === "s3") {
        try {
            const s3Object = await getS3Client().send(new GetObjectCommand({
                Bucket: CONFIG.S3_BUCKET,
                Key: fileKey
            }));
            return await s3Object.Body.transformToString();
        } catch (error) {
            if (error.name === "NoSuchKey") {
                return null;
            }
            throw error;
        }
    }

    try {
        const filePath = path.resolve(CONFIG.LOCAL_STORAGE_DIR, fileKey);
        return await fs.readFile(filePath, "utf8");
    } catch (error) {
        if (error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

// Same as readFile() but for binary files like .zip. Returns a Buffer, or null when missing.
export async function readBinaryFile(fileKey) {
    checkFileKey(fileKey);

    if (CONFIG.STORAGE_DRIVER === "s3") {
        try {
            const s3Object = await getS3Client().send(new GetObjectCommand({
                Bucket: CONFIG.S3_BUCKET,
                Key: fileKey
            }));
            return Buffer.from(await s3Object.Body.transformToByteArray());
        } catch (error) {
            if (error.name === "NoSuchKey") {
                return null;
            }
            throw error;
        }
    }

    try {
        return await fs.readFile(path.resolve(CONFIG.LOCAL_STORAGE_DIR, fileKey));
    } catch (error) {
        if (error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}

// Returns the names of the folders directly inside a folder.
// Example: listFolders("audits") -> ["2026-10-13T07-10-00_example.com", ...]
export async function listFolders(folderKey) {
    checkFileKey(folderKey);

    if (CONFIG.STORAGE_DRIVER === "s3") {
        // S3 has no real folders. Asking with a Delimiter groups keys by their next "/" part.
        const listing = await getS3Client().send(new ListObjectsV2Command({
            Bucket: CONFIG.S3_BUCKET,
            Prefix: `${folderKey}/`,
            Delimiter: "/"
        }));

        const commonPrefixes = listing.CommonPrefixes || [];
        return commonPrefixes.map(commonPrefix => {
            return commonPrefix.Prefix.slice(folderKey.length + 1, -1);
        });
    }

    try {
        const folderPath = path.resolve(CONFIG.LOCAL_STORAGE_DIR, folderKey);
        const folderEntries = await fs.readdir(folderPath, { withFileTypes: true });
        return folderEntries.filter(entry => entry.isDirectory()).map(entry => entry.name);
    } catch (error) {
        if (error.code === "ENOENT") {
            return [];
        }
        throw error;
    }
}
