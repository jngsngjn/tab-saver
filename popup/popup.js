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
chrome.storage.local.get("openInNewWindow", ({ openInNewWindow }) => {
    checkbox.checked = Boolean(openInNewWindow);
});
applyI18n();
renderSessionList();

/* ===== Events ===== */
checkbox.addEventListener("change", () => {
    chrome.storage.local.set({ openInNewWindow: checkbox.checked });
});

document.getElementById("saveBtn").addEventListener("click", onSave);

/* ===== Handlers ===== */
function onSave() {
    const name = sessionNameInput.value.trim();

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
function renderSessionList() {
    chrome.storage.local.get("sessions", ({ sessions }) => {
        const list = Array.isArray(sessions) ? sessions : [];

        if (!list.length) {
            sessionList.innerHTML = "";
            emptyHint.classList.remove("hidden");
            return;
        }

        emptyHint.classList.add("hidden");
        sessionList.innerHTML = list.map(renderSessionItem).join("");
        bindSessionEvents();
    });
}

function renderSessionItem(session) {
    const name = escapeHtml(session.name || "Untitled");
    const urls = Array.isArray(session.urls) ? session.urls : [];
    const domainMap = countDomains(urls);

    const domains = Object.entries(domainMap)
        .map(([domain, count]) => `
            <li class="domainItem"
                data-session-id="${session.id}"
                data-domain="${domain}">
                ${domain} (${count})
            </li>
        `)
        .join("");

    return `
<li class="sessionItem"
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

    <ul class="domainList hidden">${domains}</ul>
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

    sessionList.querySelectorAll(".domainItem")
        .forEach(el => el.addEventListener("click", onDomainClick));

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
    const currentList = currentItem.querySelector(".domainList");

    // 🔒 다른 열려있는 세션 전부 닫기
    document.querySelectorAll(".sessionItem.open").forEach(item => {
        if (item !== currentItem) {
            item.classList.remove("open");
            item.querySelector(".domainList")?.classList.add("hidden");
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
        renderSessionList
    );
}

function onDomainClick(e) {
    e.stopPropagation();
    restoreDomain(
        e.currentTarget.dataset.sessionId,
        e.currentTarget.dataset.domain
    );
}

/* ===== Restore ===== */
function restoreSession(sessionId) {
    chrome.storage.local.get("openInNewWindow", ({ openInNewWindow }) => {
        chrome.runtime.sendMessage({
            type: "RESTORE_SESSION",
            sessionId,
            openInNewWindow: Boolean(openInNewWindow)
        });
    });
}

function restoreDomain(sessionId, domain) {
    chrome.storage.local.get("openInNewWindow", ({ openInNewWindow }) => {
        chrome.runtime.sendMessage({
            type: "RESTORE_DOMAIN",
            sessionId,
            domain,
            openInNewWindow: Boolean(openInNewWindow)
        });
    });
}

/* ===== Utils ===== */
function countDomains(urls) {
    return urls.reduce((map, url) => {
        try {
            const domain = new URL(url).hostname;
            map[domain] = (map[domain] || 0) + 1;
        } catch {}
        return map;
    }, {});
}

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
    draggedItem.querySelector(".domainList")?.classList.add("hidden");

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

    chrome.storage.local.get("sessions", ({ sessions }) => {
        if (!Array.isArray(sessions)) return;

        const map = Object.fromEntries(
            sessions.map(s => [s.id, s])
        );

        const reordered = orderedIds
            .map(id => map[id])
            .filter(Boolean);

        chrome.storage.local.set({ sessions: reordered });
    });
}
