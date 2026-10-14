// Audits page: start an audit (website or project folder) and list your audits

const websiteForm = document.getElementById("website-form");
const folderForm = document.getElementById("folder-form");
const auditTabs = document.getElementById("audit-tabs");
const formMessage = document.getElementById("form-message");
const auditList = document.getElementById("audit-list");
const auditCount = document.getElementById("audit-count");
const pickedFolder = document.getElementById("picked-folder");
const pickedFolderPath = document.getElementById("picked-folder-path");
const pickedFolderInfo = document.getElementById("picked-folder-info");
const folderSubmit = document.getElementById("folder-submit");

let refreshTimer = null;
let chosenFolderPath = "";

function auditItemHtml(audit) {
    const scores = audit.siteScores || {};
    const target = audit.siteUrl || audit.folderPath;
    const targetIcon = audit.siteUrl ? "🌐" : "📁";
    const isActive = audit.status === "running" || audit.status === "queued";

    const metaParts = [`<span class="badge ${audit.status}">${audit.status}</span>`];
    if (audit.status === "completed") {
        metaParts.push(`<span>${audit.pageCount} page(s)</span>`, `<span>${audit.issueCount} issue(s)</span>`);
    }
    metaParts.push(`<span>${formatDate(audit.createdAt)}</span>`);

    let extraHtml = "";
    if (isActive) {
        extraHtml = `<div class="muted" style="margin-top: 4px">${escapeHtml(audit.progress)}</div><div class="progress"><span></span></div>`;
    }
    if (audit.status === "failed") {
        extraHtml = `<div class="muted" style="margin-top: 4px; color: var(--bad)">${escapeHtml(audit.error)}</div>`;
    }

    return `
        <a class="audit-item" href="audit.html?id=${encodeURIComponent(audit.auditId)}">
            ${scoreRingHtml(scores.overall, "small")}
            <div class="audit-main">
                <div class="audit-title">${targetIcon} ${escapeHtml(target)}</div>
                <div class="audit-meta">${metaParts.join("")}</div>
                ${extraHtml}
            </div>
            <span class="chevron">›</span>
        </a>`;
}

async function loadAudits() {
    try {
        const apiResult = await callApi("/api/audits");
        auditCount.textContent = apiResult.audits.length > 0 ? `${apiResult.audits.length} audit(s)` : "";

        if (apiResult.audits.length === 0) {
            auditList.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🔍</div>
                    <b>No audits yet</b>
                    <p>Paste a website address above, or choose a project folder, and start your first audit.</p>
                </div>`;
            return;
        }

        auditList.innerHTML = apiResult.audits.map(auditItemHtml).join("");

        // Keep refreshing while something is still running
        const hasActiveAudit = apiResult.audits.some(audit => audit.status === "queued" || audit.status === "running");
        clearTimeout(refreshTimer);
        if (hasActiveAudit) {
            refreshTimer = setTimeout(loadAudits, 3000);
        }
    } catch (error) {
        auditList.innerHTML = `<p class="message error">${escapeHtml(error.message)}</p>`;
    }
}

// Starts the audit and opens its page, so the user sees the progress and then the report
async function submitAudit(form, apiPath, requestBody) {
    const submitButton = form.querySelector("button[type=submit]");
    submitButton.disabled = true;
    showMessage(formMessage, "");

    try {
        const apiResult = await postJson(apiPath, requestBody);
        window.location.href = `audit.html?id=${encodeURIComponent(apiResult.audit.auditId)}`;
    } catch (error) {
        showMessage(formMessage, error.message, "error");
        submitButton.disabled = false;
    }
}

// People often paste "example.com" without https://, so we add it for them
function normalizeSiteUrl(typedUrl) {
    const trimmedUrl = typedUrl.trim();
    if (trimmedUrl && !/^https?:\/\//i.test(trimmedUrl)) {
        return `https://${trimmedUrl}`;
    }
    return trimmedUrl;
}

websiteForm.addEventListener("submit", (event) => {
    event.preventDefault();
    submitAudit(websiteForm, "/api/audits", {
        siteUrl: normalizeSiteUrl(websiteForm.siteUrl.value),
        maxPages: Number(websiteForm.maxPages.value)
    });
});

folderForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!chosenFolderPath) {
        showMessage(formMessage, "Please choose a project folder first", "error");
        return;
    }
    submitAudit(folderForm, "/api/audits/folder", { folderPath: chosenFolderPath });
});

async function chooseFolder() {
    const chosenFolder = await openFolderPicker(chosenFolderPath);
    if (!chosenFolder) {
        return;
    }

    chosenFolderPath = chosenFolder.folderPath;
    pickedFolderPath.textContent = chosenFolder.folderPath;
    pickedFolderPath.classList.remove("placeholder");
    showMessage(formMessage, "");

    const project = chosenFolder.project;
    if (!project) {
        pickedFolderInfo.textContent = "No index.html or package.json in this folder. Choose your project's main folder.";
        folderSubmit.disabled = true;
        return;
    }

    const typeName = PROJECT_TYPE_NAMES[project.projectType] || "Project";
    if (project.canAudit) {
        pickedFolderInfo.textContent = project.auditFolder ? `${typeName}, audits the "${project.auditFolder}" build folder` : `${typeName}, ready to audit`;
        folderSubmit.disabled = false;
    } else {
        pickedFolderInfo.textContent = `${typeName}. ${project.reason}`;
        folderSubmit.disabled = true;
    }
}

pickedFolder.addEventListener("click", chooseFolder);
pickedFolder.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        chooseFolder();
    }
});

auditTabs.addEventListener("click", (event) => {
    const tabButton = event.target.closest("button");
    if (!tabButton) {
        return;
    }

    const selectedTab = tabButton.dataset.tab;
    for (const button of auditTabs.querySelectorAll("button")) {
        button.className = button.dataset.tab === selectedTab ? "active" : "";
    }
    websiteForm.hidden = selectedTab !== "website";
    folderForm.hidden = selectedTab !== "folder";
    showMessage(formMessage, "");
});

async function startAuditsPage() {
    const { settings } = await startPage("audits");

    // "1 page" ... up to the server's limit, with 5 pages chosen when allowed
    for (let pageCount = 1; pageCount <= settings.maxPages; pageCount++) {
        const pageOption = document.createElement("option");
        pageOption.value = pageCount;
        pageOption.textContent = pageCount === 1 ? "1 page" : `${pageCount} pages`;
        websiteForm.maxPages.appendChild(pageOption);
    }
    websiteForm.maxPages.value = String(Math.min(5, settings.maxPages));

    // Folder audits only make sense when Yngo runs on your own computer
    auditTabs.querySelector('[data-tab="folder"]').hidden = !settings.allowLocalFolders;
    if (!settings.allowLocalFolders) {
        auditTabs.hidden = true;
    }

    await loadAudits();
}

startAuditsPage();
