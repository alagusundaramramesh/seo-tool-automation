// Auto-fix page: pick a project (folder or .zip), check it, then go to the result page

const fixForm = document.getElementById("fix-form");
const sourceTabs = document.getElementById("source-tabs");
const folderInput = document.getElementById("folder-input");
const zipInput = document.getElementById("zip-input");
const fixMessage = document.getElementById("fix-message");
const fixRows = document.getElementById("fix-rows");
const pickedFolder = document.getElementById("picked-folder");
const pickedFolderPath = document.getElementById("picked-folder-path");
const pickedFolderInfo = document.getElementById("picked-folder-info");

let selectedSource = "folder";
let chosenFolderPath = "";

async function chooseFolder() {
    const chosenFolder = await openFolderPicker(chosenFolderPath);
    if (!chosenFolder) {
        return;
    }

    chosenFolderPath = chosenFolder.folderPath;
    pickedFolderPath.textContent = chosenFolder.folderPath;
    pickedFolderPath.classList.remove("placeholder");
    showMessage(fixMessage, "");

    const project = chosenFolder.project;
    pickedFolderInfo.textContent = project
        ? `${PROJECT_TYPE_NAMES[project.projectType] || "Project"} found`
        : "No index.html or package.json here. Make sure this is your project's main folder.";
}

pickedFolder.addEventListener("click", chooseFolder);
pickedFolder.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        chooseFolder();
    }
});

function selectSource(sourceName) {
    selectedSource = sourceName;
    for (const tabButton of sourceTabs.querySelectorAll("button[data-tab]")) {
        tabButton.className = tabButton.dataset.tab === sourceName ? "active" : "";
    }
    folderInput.hidden = sourceName !== "folder";
    zipInput.hidden = sourceName !== "zip";
    showMessage(fixMessage, "");
}

sourceTabs.addEventListener("click", (event) => {
    const tabButton = event.target.closest("button");
    if (tabButton && tabButton.dataset.tab) {
        selectSource(tabButton.dataset.tab);
    }
});

function fixRowHtml(fixRecord) {
    const projectName = fixRecord.sourceType === "folder" ? `📁 ${fixRecord.folderPath}` : `🗜️ ${fixRecord.zipName}`;

    return `
        <tr>
            <td><a href="fix-result.html?id=${encodeURIComponent(fixRecord.fixId)}">${escapeHtml(projectName)}</a>
                <div class="muted">${escapeHtml(fixRecord.projectType)}</div></td>
            <td><span class="badge ${fixRecord.status}">${fixRecord.status}</span></td>
            <td>${fixRecord.changedFileCount}</td>
            <td>${fixRecord.reviewCount}</td>
            <td class="muted">${formatDate(fixRecord.createdAt)}</td>
        </tr>`;
}

async function loadFixes() {
    try {
        const apiResult = await callApi("/api/fixes");
        fixRows.innerHTML = apiResult.fixes.length === 0
            ? `<tr><td colspan="5" class="muted">No fixes yet. Choose a project above and click "Check my project".</td></tr>`
            : apiResult.fixes.map(fixRowHtml).join("");
    } catch (error) {
        fixRows.innerHTML = `<tr><td colspan="5" class="message error">${escapeHtml(error.message)}</td></tr>`;
    }
}

// Fills the "only fix problems from this audit" list with the user's completed audits
async function loadAuditChoices() {
    const apiResult = await callApi("/api/audits");
    const completedAudits = apiResult.audits.filter(audit => audit.status === "completed");

    for (const audit of completedAudits) {
        const auditOption = document.createElement("option");
        auditOption.value = audit.auditId;
        auditOption.textContent = `${audit.siteUrl || audit.folderPath} (${formatDate(audit.createdAt)})`;
        fixForm.auditId.appendChild(auditOption);
    }

    // Coming from an audit page: pre-select that audit
    const auditIdFromPage = getPageParam("auditId");
    if (auditIdFromPage) {
        fixForm.auditId.value = auditIdFromPage;
    }
}

fixForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const submitButton = fixForm.querySelector("button[type=submit]");
    submitButton.disabled = true;
    showMessage(fixMessage, "Checking your project...");

    try {
        let apiResult;

        if (selectedSource === "folder") {
            if (!chosenFolderPath) {
                throw new Error("Please choose your project folder");
            }
            apiResult = await postJson("/api/fixes/folder", {
                folderPath: chosenFolderPath,
                auditId: fixForm.auditId.value,
                siteUrl: fixForm.siteUrl.value.trim()
            });
        } else {
            const zipFile = fixForm.projectZip.files[0];
            if (!zipFile) {
                throw new Error("Please choose a .zip file of your project");
            }

            const uploadForm = new FormData();
            uploadForm.append("projectZip", zipFile);
            uploadForm.append("auditId", fixForm.auditId.value);
            uploadForm.append("siteUrl", fixForm.siteUrl.value.trim());
            apiResult = await callApi("/api/fixes/upload", { method: "POST", body: uploadForm });
        }

        window.location.href = `fix-result.html?id=${encodeURIComponent(apiResult.fix.fixId)}`;
    } catch (error) {
        showMessage(fixMessage, error.message, "error");
        submitButton.disabled = false;
    }
});

async function startFixPage() {
    const { settings } = await startPage("fixes");

    document.getElementById("zip-help").textContent =
        `Zip your project folder (without node_modules). Up to ${settings.maxUploadMb} MB.`;

    // On a public server, folders on the server cannot be used: only uploads
    if (!settings.allowLocalFolders) {
        sourceTabs.querySelector('[data-tab="folder"]').hidden = true;
        selectSource("zip");
    }

    await loadAuditChoices();
    await loadFixes();
}

startFixPage();
