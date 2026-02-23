/* ===== DOM ===== */
const sessionNameInput = document.getElementById("sessionNameInput");
const checkbox = document.getElementById("newWindowCheckbox");
const sessionList = document.getElementById("sessionList");
const emptyHint = document.getElementById("emptyHint");
const status = document.getElementById("status");

let draggedItem = null;

function applyI18n() {
    document.querySelectorAll("[data-i18n]").forEach(el => {
        el.textContent = chrome.i18n.getMessage(el.dataset.i18n);
    });

    document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
        el.placeholder = chrome.i18n.getMessage(
            el.dataset.i18nPlaceholder
        );
    });
}

/* ===== Init ===== */
chrome.storage.sync.get("openInNewWindow", ({ openInNewWindow }) => {
    checkbox.checked = Boolean(openInNewWindow);
});
applyI18n();
renderSessionList();

/* ===== Events ===== */
checkbox.addEventListener("change", () => {
    chrome.storage.sync.set({ openInNewWindow: checkbox.checked });
});

document.getElementById("saveBtn").addEventListener("click", onSave);

sessionNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        onSave();
    }
});

/* ===== Handlers ===== */
function onSave() {
    const name = sessionNameInput.value.trim();

    if (name.length > 20) {
        showToast(
            chrome.i18n.getMessage("nameTooLong"),
            "error"
        );
        return;
    }

    chrome.runtime.sendMessage(
        { type: "SAVE_SESSION", name },
        (res) => {
            if (!res || res.success === false) {
                showToast(
                    chrome.i18n.getMessage("noTabsToSave"),
                    "error"
                );
                return;
            }

            sessionNameInput.value = "";
            showToast(
                chrome.i18n.getMessage("savedToast", [res.count]),
                "success"
            );
            renderSessionList();
        }
    );
}

/* ===== Render ===== */
function renderSessionList(openId = null) {
    chrome.storage.sync.get("sessions", ({ sessions }) => {
        const list = Array.isArray(sessions) ? sessions : [];

        if (!list.length) {
            sessionList.innerHTML = "";
            emptyHint.classList.remove("hidden");
            return;
        }

        emptyHint.classList.add("hidden");
        sessionList.innerHTML = list.map(s => renderSessionItem(s, s.id === openId)).join("");
        bindSessionEvents();
    });
}

function renderSessionItem(session, isOpen = false) {
    const name = escapeHtml(session.name || "Untitled");
    const urls = Array.isArray(session.urls) ? session.urls : [];

    const urlItems = urls
        .map((url, index) => {
            const favicon = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`;

            const displayUrl = escapeHtml(url);              // 화면 표시용
            const dataUrl = encodeURIComponent(url);         // data attribute 용(안전)

            return `
            <li class="urlItem"
                data-session-id="${session.id}"
                data-url="${dataUrl}"
                data-index="${index}">
                <img src="${favicon}" class="urlFavicon" alt="" />
                <span class="urlText">${displayUrl}</span>
                <button class="urlDeleteBtn" 
                        data-session-id="${session.id}" 
                        data-url="${dataUrl}"
                        data-index="${index}"
                        title="${chrome.i18n.getMessage("delete")}">×</button>
            </li>
        `;
        })
        .join("");

    return `
<li class="sessionItem ${isOpen ? "open" : ""}"
    data-id="${session.id}"
    draggable="true">

    <div class="sessionHeader">
        <div class="sessionName">
            <span class="arrow">▶</span>
            <span>${name}</span>
            <span class="sessionMeta">(${urls.length})</span>
        </div>

        <div class="actions">
            <button class="openBtn" data-id="${session.id}">${chrome.i18n.getMessage("open")}</button>
            <button class="deleteBtn" data-id="${session.id}">${chrome.i18n.getMessage("delete")}</button>
        </div>
    </div>

    <ul class="urlList ${isOpen ? "" : "hidden"}">${urlItems}</ul>
</li>
`;
}

/* ===== Binding ===== */
function bindSessionEvents() {
    sessionList.querySelectorAll(".openBtn")
        .forEach(btn => btn.addEventListener("click", onOpen));

    sessionList.querySelectorAll(".deleteBtn")
        .forEach(btn => btn.addEventListener("click", onDelete));

    sessionList.querySelectorAll(".sessionHeader")
        .forEach(el => el.addEventListener("click", onToggle));

    sessionList.querySelectorAll(".urlDeleteBtn")
        .forEach(btn => btn.addEventListener("click", onUrlDelete));

    sessionList.querySelectorAll(".urlItem")
        .forEach(el => el.addEventListener("click", onUrlClick));

    // ✅ Drag & Drop
    sessionList.querySelectorAll(".sessionItem")
        .forEach(el => {
            el.addEventListener("dragstart", onDragStart);
            el.addEventListener("dragover", onDragOver);
            el.addEventListener("drop", onDrop);
            el.addEventListener("dragend", onDragEnd);
        });
}

/* ===== Actions ===== */
function onToggle(e) {
    if (e.target.closest("button")) return;

    const currentItem = e.currentTarget.closest(".sessionItem");
    const currentList = currentItem.querySelector(".urlList");

    // 🔒 다른 열려있는 세션 전부 닫기
    document.querySelectorAll(".sessionItem.open").forEach(item => {
        if (item !== currentItem) {
            item.classList.remove("open");
            item.querySelector(".urlList")?.classList.add("hidden");
        }
    });

    // 🔁 현재 세션 토글
    const isOpen = currentItem.classList.contains("open");

    currentItem.classList.toggle("open", !isOpen);
    currentList.classList.toggle("hidden", isOpen);
}

function onOpen(e) {
    e.stopPropagation();
    restoreSession(e.currentTarget.dataset.id);
}

function onDelete(e) {
    e.stopPropagation();
    chrome.runtime.sendMessage(
        { type: "DELETE_SESSION", sessionId: e.currentTarget.dataset.id },
        () => renderSessionList()
    );
}

function onUrlClick(e) {
    if (e.target.closest(".urlDeleteBtn")) return;
    e.stopPropagation();
    const decodedUrl = decodeURIComponent(e.currentTarget.dataset.url);
    restoreUrl(decodedUrl);
}

function onUrlDelete(e) {
    e.preventDefault();
    e.stopImmediatePropagation();
    const sessionId = e.currentTarget.dataset.sessionId;
    const index = Number(e.currentTarget.dataset.index);
    const url = decodeURIComponent(e.currentTarget.dataset.url);

    chrome.runtime.sendMessage(
        { type: "DELETE_URL", sessionId, url, index },
        (response) => {
            if (chrome.runtime.lastError || !response || response.success === false) {
                deleteUrlInStorage(sessionId, index, url, () => {
                    renderSessionList(sessionId);
                });
                return;
            }

            renderSessionList(sessionId);
        }
    );
}

function deleteUrlInStorage(sessionId, index, url, done) {
    chrome.storage.sync.get("sessions", ({ sessions }) => {
        const list = Array.isArray(sessions) ? sessions : [];
        const target = list.find(s => s.id === sessionId);

        if (target) {
            if (Number.isFinite(index) && index >= 0 && index < target.urls.length) {
                target.urls.splice(index, 1);
            } else {
                target.urls = target.urls.filter(u => u !== url);
            }

            const nextSessions = target.urls.length === 0
                ? list.filter(s => s.id !== sessionId)
                : list;

            chrome.storage.sync.set({ sessions: nextSessions }, () => {
                done?.();
            });
            return;
        }

        done?.();
    });
}

/* ===== Restore ===== */
function restoreSession(sessionId) {
    chrome.storage.sync.get("openInNewWindow", ({ openInNewWindow }) => {
        chrome.runtime.sendMessage({
            type: "RESTORE_SESSION",
            sessionId,
            openInNewWindow: Boolean(openInNewWindow)
        });
    });
}

function restoreUrl(url) {
    chrome.runtime.sendMessage({
        type: "RESTORE_URL",
        url
    });
}

/* ===== Utils ===== */
function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function showToast(message, type = "success") {
    status.textContent = message;
    status.className = `toast ${type} show`;

    clearTimeout(status._timer);
    status._timer = setTimeout(() => {
        status.classList.remove("show");
    }, 1500);
}
function onDragStart(e) {
    draggedItem = e.currentTarget;
    draggedItem.classList.add("dragging");

    // 아코디언 열려 있으면 닫기
    draggedItem.classList.remove("open");
    draggedItem.querySelector(".urlList")?.classList.add("hidden");

    e.dataTransfer.effectAllowed = "move";
}

function onDragOver(e) {
    e.preventDefault();

    const target = e.currentTarget;
    if (target === draggedItem) return;

    target.classList.add("dragOver");

    const rect = target.getBoundingClientRect();
    const isAfter = e.clientY > rect.top + rect.height / 2;

    const referenceNode = isAfter ? target.nextSibling : target;
    if (referenceNode !== draggedItem) {
        sessionList.insertBefore(draggedItem, referenceNode);
    }
}

function onDrop(e) {
    e.preventDefault();
    e.currentTarget.classList.remove("dragOver");
    saveNewOrder();
}

function onDragEnd() {
    document.querySelectorAll(".sessionItem")
        .forEach(el => {
            el.classList.remove("dragging");
            el.classList.remove("dragOver");
        });

    draggedItem = null;
}
function saveNewOrder() {
    const orderedIds = [...sessionList.querySelectorAll(".sessionItem")]
        .map(el => el.dataset.id);

    chrome.storage.sync.get("sessions", ({ sessions }) => {
        if (!Array.isArray(sessions)) return;

        const map = Object.fromEntries(
            sessions.map(s => [s.id, s])
        );

        const reordered = orderedIds
            .map(id => map[id])
            .filter(Boolean);

        chrome.storage.sync.set({ sessions: reordered });
    });
}
