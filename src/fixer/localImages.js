import fs from "fs";
import path from "path";
import { imageSize } from "image-size";

// Finds the real width and height of an image that lives inside the project,
// so we can add width="..." height="..." to <img> tags (this stops the page from jumping while loading).
//
// searchFolders: where to look for the image, for example
//   plain HTML: [folder of the HTML file, project folder]
//   Next.js:    [project/public]   because "/logo.png" means "public/logo.png"
// Returns { width, height } or null if the image is remote, missing or unreadable.
export function getLocalImageSize(imageSource, searchFolders, projectFolder) {
    if (!imageSource || /^(https?:)?\/\//.test(imageSource) || imageSource.startsWith("data:")) {
        return null;
    }

    const cleanSource = imageSource.split("?")[0].split("#")[0];

    for (const searchFolder of searchFolders) {
        // "/logo.png" is relative to the search folder, not to the root of the computer
        const imagePath = path.resolve(searchFolder, cleanSource.replace(/^\/+/, ""));

        // Never read files outside the project
        if (!imagePath.startsWith(path.resolve(projectFolder) + path.sep)) {
            continue;
        }

        if (!fs.existsSync(imagePath)) {
            continue;
        }

        try {
            const dimensions = imageSize(fs.readFileSync(imagePath));
            return { width: dimensions.width, height: dimensions.height };
        } catch (error) {
            console.error("Could not read image size", { imagePath, reason: error.message });
            return null;
        }
    }

    return null;
}
