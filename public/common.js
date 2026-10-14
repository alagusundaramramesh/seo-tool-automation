// Small helpers shared by all dashboard pages

function escapeHtml(text) {
    return String(text === null || text === undefined ? "" : text)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// Same grades as the report: 90+ good, 50-89 needs work, below 50 poor
function getGradeName(score) {
    if (score === null || score === undefined) {
        return "none";
    }
    if (score >= 90) {
        return "good";
    }
    if (score >= 50) {
        return "needs-work";
    }
    return "poor";
}

function scoreHtml(score) {
    if (score === null || score === undefined) {
        return `<span class="muted">–</span>`;
    }
    return `<span class="score ${getGradeName(score)}">${score}</span>`;
}

// Round score gauge. size: "small", "" (normal) or "large"
function scoreRingHtml(score, size) {
    const hasScore = score !== null && score !== undefined;
    const circleLength = 2 * Math.PI * 40;
    const filledLength = hasScore ? (circleLength * score) / 100 : 0;

    return `
        <div class="ring ${size || ""} ${getGradeName(score)}">
            <svg viewBox="0 0 100 100" aria-hidden="true">
                <circle class="ring-track" cx="50" cy="50" r="40"></circle>
                <circle class="ring-value" cx="50" cy="50" r="40"
                    stroke-dasharray="${circleLength}" stroke-dashoffset="${circleLength - filledLength}"></circle>
            </svg>
            <div class="ring-number">${hasScore ? score : "–"}</div>
        </div>`;
}

// Escapes the text, then turns https:// links into clickable links (Lighthouse texts contain "Learn more" links)
function linkifyText(text) {
    return escapeHtml(text).replace(/https?:\/\/[^\s<)"]+[^\s<)".,]/g, (linkUrl) => {
        return `<a href="${linkUrl}" target="_blank" rel="noopener">${linkUrl}</a>`;
    });
}

function formatDate(isoDate) {
    if (!isoDate) {
        return "";
    }
    return new Date(isoDate).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function getPageParam(paramName) {
    return new URLSearchParams(window.location.search).get(paramName);
}

// Calls our API and returns the JSON body.
// Throws an Error with the API message when status is false. Sends the user to the login page when the login expired.
async function callApi(apiPath, requestOptions) {
    const apiResponse = await fetch(apiPath, requestOptions);
    const responseBody = await apiResponse.json();

    if (apiResponse.status === 401 && responseBody.code === "LOGIN_REQUIRED") {
        window.location.href = "/login.html";
        // The browser is leaving this page, so we return a promise that never finishes
        // instead of throwing an error that would show up in the console.
        return new Promise(() => {});
    }

    if (!responseBody.status) {
        throw new Error(responseBody.message || `Request failed (${apiResponse.status})`);
    }

    return responseBody;
}

function postJson(apiPath, requestBody) {
    return callApi(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody || {})
    });
}

function showMessage(element, text, kind) {
    element.className = `message ${kind || ""}`;
    element.textContent = text;
}

// Every page calls this first. It checks the login, draws the top bar,
// and returns { user, settings } from the server.
async function startPage(activePage) {
    const meResult = await callApi("/api/auth/me");
    const user = meResult.user;

    const pageLinks = [
        { page: "audits", href: "/", label: "Audits" },
        { page: "fixes", href: "/fix.html", label: "Auto-fix" }
    ];

    const userName = user.isGuest ? "Guest" : user.email;
    const userButton = user.isGuest
        ? `<a class="button secondary" href="/login.html?mode=register">Create free account</a>`
        : `<button class="ghost" id="logout-button">Log out</button>`;

    const guestBanner = user.isGuest
        ? `<div class="guest-banner"><div class="header-inner">
               <span>👋 You are auditing as a guest. Guest audits stay in this browser for 7 days.</span>
               <a href="/login.html?mode=register">Create a free account to keep them</a>
           </div></div>`
        : "";

    document.getElementById("app-header").innerHTML = `
        <div class="header-inner">
            <a class="logo" href="/"><span class="logo-mark">Y</span>Yngo</a>
            <nav class="main-nav">
                ${pageLinks.map(link => `<a href="${link.href}" class="${link.page === activePage ? "active" : ""}">${link.label}</a>`).join("")}
            </nav>
            <div class="user-box">
                <span class="avatar">${escapeHtml(userName.charAt(0).toUpperCase())}</span>
                <span class="user-email">${escapeHtml(userName)}</span>
                ${userButton}
            </div>
        </div>
        ${guestBanner}`;

    const logoutButton = document.getElementById("logout-button");
    if (logoutButton) {
        logoutButton.addEventListener("click", async () => {
            await postJson("/api/auth/logout");
            window.location.href = "/login.html";
        });
    }

    return meResult;
}

// ---------- Folder picker ----------
// Opens a dialog to click through folders on the computer running Yngo.
// Returns a promise with { folderPath, project } when the user chooses a folder, or null when they cancel.
// project is { projectType, canAudit, auditFolder, reason } or null when the folder has no index.html / package.json.

const PROJECT_TYPE_NAMES = { html: "HTML website", react: "React app", nextjs: "Next.js app" };

function openFolderPicker(startPath) {
    let pickerDialog = document.getElementById("folder-picker");

    if (!pickerDialog) {
        pickerDialog = document.createElement("dialog");
        pickerDialog.id = "folder-picker";
        pickerDialog.className = "folder-picker";
        pickerDialog.innerHTML = `
            <div class="picker-layout">
                <div class="picker-head">
                    <h2>Choose your project folder</h2>
                    <p class="muted">Open the folder that has your <code>index.html</code> or <code>package.json</code>.</p>
                    <form class="picker-path" id="picker-path-form">
                        <input name="typedPath" placeholder="Or paste a path, for example D:\\projects\\my-shop">
                        <button type="submit" class="secondary">Go</button>
                    </form>
                </div>
                <div class="picker-list" id="picker-list"></div>
                <p class="picker-project" id="picker-project" hidden></p>
                <p class="message" id="picker-message" style="margin: 0 20px"></p>
                <div class="picker-foot">
                    <span class="muted" id="picker-current"></span>
                    <div class="actions">
                        <button type="button" class="secondary" id="picker-cancel">Cancel</button>
                        <button type="button" id="picker-choose" disabled>Choose this folder</button>
                    </div>
                </div>
            </div>`;
        document.body.appendChild(pickerDialog);
    }

    const pickerList = document.getElementById("picker-list");
    const pickerProject = document.getElementById("picker-project");
    const pickerMessage = document.getElementById("picker-message");
    const pickerCurrent = document.getElementById("picker-current");
    const chooseButton = document.getElementById("picker-choose");
    const pathForm = document.getElementById("picker-path-form");

    let currentFolder = null;

    async function showFolder(folderPath) {
        showMessage(pickerMessage, "");

        let folderListing;
        try {
            folderListing = await callApi(`/api/folders?path=${encodeURIComponent(folderPath || "")}`);
        } catch (error) {
            showMessage(pickerMessage, error.message, "error");
            return;
        }

        currentFolder = folderListing;
        pathForm.typedPath.value = folderListing.currentPath;
        pickerCurrent.textContent = folderListing.currentPath || "Choose a drive";
        chooseButton.disabled = !folderListing.currentPath;

        const folderRows = [];
        if (folderListing.parentPath !== null) {
            folderRows.push(`<button type="button" class="picker-row" data-path="${escapeHtml(folderListing.parentPath)}">⬆️ <span class="row-name">Up one level</span></button>`);
        }
        for (const childFolder of folderListing.folders) {
            folderRows.push(`<button type="button" class="picker-row" data-path="${escapeHtml(childFolder.path)}">📁 <span class="row-name">${escapeHtml(childFolder.name)}</span></button>`);
        }
        if (folderListing.folders.length === 0) {
            folderRows.push(`<p class="muted" style="padding: 10px 12px">No folders inside.</p>`);
        }
        pickerList.innerHTML = folderRows.join("");
        pickerList.scrollTop = 0;

        const project = folderListing.project;
        if (!project) {
            pickerProject.hidden = true;
            return;
        }

        const typeName = PROJECT_TYPE_NAMES[project.projectType] || "Project";
        pickerProject.hidden = false;
        if (project.canAudit) {
            pickerProject.className = "picker-project ok";
            pickerProject.textContent = project.auditFolder
                ? `✓ ${typeName} found. Yngo will audit its "${project.auditFolder}" build folder.`
                : `✓ ${typeName} found. Ready to audit.`;
        } else {
            pickerProject.className = "picker-project not-ok";
            pickerProject.textContent = `${typeName} found. ${project.reason}`;
        }
    }

    return new Promise((resolve) => {
        function finish(chosenFolder) {
            pickerList.onclick = null;
            pathForm.onsubmit = null;
            chooseButton.onclick = null;
            document.getElementById("picker-cancel").onclick = null;
            pickerDialog.onclose = null;
            pickerDialog.close();
            resolve(chosenFolder);
        }

        pickerList.onclick = (event) => {
            const folderRow = event.target.closest(".picker-row");
            if (folderRow) {
                showFolder(folderRow.dataset.path);
            }
        };

        pathForm.onsubmit = (event) => {
            event.preventDefault();
            showFolder(pathForm.typedPath.value.trim());
        };

        chooseButton.onclick = () => {
            finish({ folderPath: currentFolder.currentPath, project: currentFolder.project });
        };

        document.getElementById("picker-cancel").onclick = () => finish(null);
        // Escape key closes the dialog
        pickerDialog.onclose = () => resolve(null);

        pickerDialog.showModal();
        showFolder(startPath || "");
    });
}
