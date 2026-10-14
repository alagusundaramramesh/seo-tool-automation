// Review one fix: every change and diff, then Apply / Undo / Download / Audit this folder

const fixId = getPageParam("id");
const fixSummary = document.getElementById("fix-summary");
const fixFiles = document.getElementById("fix-files");

const STATUS_TEXT = {
    planned: "Ready to apply. Nothing has been changed yet.",
    applied: "Applied.",
    undone: "Undone. Your original files are back."
};

// Colours a unified diff: green for added lines, red for removed lines
function diffHtml(diffText) {
    const diffLines = diffText.split("\n").slice(2);

    const lineHtml = diffLines.map(diffLine => {
        let lineClass = "";
        if (diffLine.startsWith("+")) {
            lineClass = "added";
        } else if (diffLine.startsWith("-")) {
            lineClass = "removed";
        } else if (diffLine.startsWith("@@")) {
            lineClass = "hunk";
        }
        return `<div class="${lineClass}">${escapeHtml(diffLine) || " "}</div>`;
    });

    return `<div class="diff">${lineHtml.join("")}</div>`;
}

function fileHtml(fixFile) {
    const changeItems = fixFile.changes.map(change => {
        const tag = change.needsReview ? `<span class="tag review">review</span>` : `<span class="tag auto">auto</span>`;
        return `<li>${tag}${escapeHtml(change.message)}</li>`;
    });

    return `
        <div class="file">
            <div class="file-name">${escapeHtml(fixFile.relativePath)}</div>
            <ul class="change-list">${changeItems.join("")}</ul>
            ${fixFile.isChanged ? diffHtml(fixFile.diffText) : ""}
        </div>`;
}

function actionsHtml(fixRecord) {
    const actionButtons = [];

    if (fixRecord.status === "planned" && fixRecord.changedFileCount > 0) {
        actionButtons.push(`<button id="apply-button">Apply ${fixRecord.changedFileCount} file change(s)</button>`);
    }
    if (fixRecord.sourceType === "zip" && fixRecord.status === "applied") {
        actionButtons.push(`<a class="button" href="/api/fixes/${encodeURIComponent(fixRecord.fixId)}/download">Download fixed project (.zip)</a>`);
    }
    if (fixRecord.sourceType === "folder" && fixRecord.status === "applied") {
        actionButtons.push(`<button class="secondary" id="undo-button">Undo</button>`);
    }
    if (fixRecord.sourceType === "folder" && fixRecord.projectType === "html") {
        actionButtons.push(`<button class="secondary" id="audit-folder-button">Audit this folder now</button>`);
    }

    return `<div class="actions">${actionButtons.join("")}</div>`;
}

function summaryHtml(fixRecord) {
    const projectName = fixRecord.sourceType === "folder" ? `📁 ${fixRecord.folderPath}` : `🗜️ ${fixRecord.zipName}`;
    const nothingToApply = fixRecord.changedFileCount === 0
        ? `<p class="message">Nothing to change automatically. ${fixRecord.reviewCount > 0 ? "Check the review items below." : "🎉"}</p>`
        : "";

    return `
        <h1 style="word-break: break-all">${escapeHtml(projectName)}</h1>
        <p><span class="badge ${fixRecord.status}">${fixRecord.status}</span>
           <span class="muted">${STATUS_TEXT[fixRecord.status] || ""}</span></p>
        <div class="stats">
            <div class="stat"><b>${escapeHtml(fixRecord.projectType)}</b><span>Project type</span></div>
            <div class="stat"><b>${fixRecord.scannedFileCount}</b><span>Files checked</span></div>
            <div class="stat"><b>${fixRecord.changedFileCount}</b><span>Files to change</span></div>
            <div class="stat"><b>${fixRecord.autoCount}</b><span>Automatic fixes</span></div>
            <div class="stat"><b>${fixRecord.reviewCount}</b><span>Please review</span></div>
        </div>
        <p class="muted"><span class="tag review">review</span> means Yngo guessed text (like alt text from a file name)
           or something must be done by hand. Read these before publishing.</p>
        ${nothingToApply}
        ${actionsHtml(fixRecord)}
        <p id="action-message" class="message"></p>`;
}

async function runAction(button, apiPath, successText) {
    const actionMessage = document.getElementById("action-message");
    button.disabled = true;

    try {
        const apiResult = await postJson(apiPath, {});
        showFix(apiResult.fix);
        showMessage(document.getElementById("action-message"), successText, "success");
    } catch (error) {
        showMessage(actionMessage, error.message, "error");
        button.disabled = false;
    }
}

function connectButtons(fixRecord) {
    const fixPath = `/api/fixes/${encodeURIComponent(fixRecord.fixId)}`;

    const applyButton = document.getElementById("apply-button");
    if (applyButton) {
        const doneText = fixRecord.sourceType === "zip" ? "Done. Download your fixed project above." : "Done. Your files are fixed and a backup was saved.";
        applyButton.addEventListener("click", () => runAction(applyButton, `${fixPath}/apply`, doneText));
    }

    const undoButton = document.getElementById("undo-button");
    if (undoButton) {
        undoButton.addEventListener("click", () => {
            if (window.confirm("Put the original files back?")) {
                runAction(undoButton, `${fixPath}/undo`, "Your original files are back.");
            }
        });
    }

    const auditFolderButton = document.getElementById("audit-folder-button");
    if (auditFolderButton) {
        auditFolderButton.addEventListener("click", async () => {
            auditFolderButton.disabled = true;
            try {
                const apiResult = await postJson("/api/audits/folder", { folderPath: fixRecord.folderPath });
                window.location.href = `audit.html?id=${encodeURIComponent(apiResult.audit.auditId)}`;
            } catch (error) {
                showMessage(document.getElementById("action-message"), error.message, "error");
                auditFolderButton.disabled = false;
            }
        });
    }
}

function showFix(fixRecord) {
    fixSummary.innerHTML = summaryHtml(fixRecord);
    fixFiles.innerHTML = fixRecord.files.map(fileHtml).join("");
    connectButtons(fixRecord);
}

async function startFixResultPage() {
    await startPage("fixes");

    if (!fixId) {
        fixSummary.innerHTML = `<p class="message error">No fix selected. <a href="/fix.html">Go back</a></p>`;
        return;
    }

    try {
        const apiResult = await callApi(`/api/fixes/${encodeURIComponent(fixId)}`);
        showFix(apiResult.fix);
    } catch (error) {
        fixSummary.innerHTML = `<p class="message error">${escapeHtml(error.message)}</p>`;
    }
}

startFixResultPage();
