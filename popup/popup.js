const status = document.getElementById("status");
const sessionNameInput = document.getElementById("sessionNameInput");
const checkbox = document.getElementById("newWindowCheckbox");

const sessionList = document.getElementById("sessionList");
const emptyHint = document.getElementById("emptyHint");

/* 초기 로드 */
chrome.storage.local.get("openInNewWindow", (data) => {
    checkbox.checked = Boolean(data.openInNewWindow);
});
renderSessionList();

/* 체크박스 상태 저장 */
checkbox.addEventListener("change", () => {
    chrome.storage.local.set({
        openInNewWindow: checkbox.checked
    });
});

/* 세션 저장 */
document.getElementById("saveBtn").addEventListener("click", () => {
    const name = sessionNameInput.value.trim();

    chrome.runtime.sendMessage(
        { type: "SAVE_SESSION", name },
        (response) => {
            if (!response) return;

            status.textContent = `탭 ${response.count}개 저장됨`;
            status.classList.remove("hidden");

            setTimeout(() => status.classList.add("hidden"), 2000);
            sessionNameInput.value = "";
            renderSessionList();
        }
    );
});

/* 세션 목록 렌더링 */
function renderSessionList() {
    chrome.storage.local.get("sessions", (data) => {
        const sessions = Array.isArray(data.sessions) ? data.sessions : [];

        if (!sessions.length) {
            sessionList.innerHTML = "";
            emptyHint.classList.remove("hidden");
            return;
        }

        emptyHint.classList.add("hidden");

        sessionList.innerHTML = sessions
            .map((s) => {
                const safeName = escapeHtml(s.name || "Untitled");
                const urls = Array.isArray(s.urls) ? s.urls : [];
                const count = urls.length;

                const domainMap = countDomains(urls);
                const domainListHtml = Object.entries(domainMap)
                    .map(
                        ([domain, domainCount]) =>
                            `<li class="domainItem"
                   data-session-id="${s.id}"
                   data-domain="${domain}">
                   ${domain} (${domainCount})
               </li>`
                    )
                    .join("");

                return `
          <li class="sessionItem">
            <div class="sessionHeader" data-id="${s.id}">
              <div class="sessionName">
                <span class="nameText">${safeName}</span>
                <span class="sessionMeta">(${count})</span>
              </div>

              <div class="actions">
                <button class="openBtn">열기</button>
                <button class="iconBtn editBtn" data-id="${s.id}">✏️</button>
                <button class="iconBtn deleteBtn"
                        data-id="${s.id}"
                        data-name="${safeName}">🗑</button>
              </div>
            </div>

            <ul class="domainList hidden">
              ${domainListHtml}
            </ul>
          </li>
        `;
            })
            .join("");

        bindSessionEvents();
    });
}

/* 이벤트 바인딩 */
function bindSessionEvents() {
    sessionList.querySelectorAll(".openBtn").forEach(btn =>
        btn.addEventListener("click", onOpen)
    );
    sessionList.querySelectorAll(".deleteBtn").forEach(btn =>
        btn.addEventListener("click", onDelete)
    );
    sessionList.querySelectorAll(".sessionHeader").forEach(header =>
        header.addEventListener("click", onToggle)
    );
    sessionList.querySelectorAll(".domainItem").forEach(item =>
        item.addEventListener("click", onDomainClick)
    );
    sessionList.querySelectorAll(".editBtn").forEach(btn =>
        btn.addEventListener("click", onEdit)
    );
}

/* 토글 */
function onToggle(e) {
    // 버튼 클릭은 토글 제외
    if (e.target.closest("button")) return;

    const item = e.currentTarget.closest(".sessionItem");
    const domainList = item.querySelector(".domainList");

    domainList.classList.toggle("hidden");
}

/* 열기 */
열기 안 됨
function onOpen(e) {
    e.stopPropagation();
    const sessionId = e.currentTarget.dataset.id;

    chrome.storage.local.get("openInNewWindow", (data) => {
        chrome.runtime.sendMessage({
            type: "RESTORE_SESSION",
            sessionId,
            openInNewWindow: Boolean(data.openInNewWindow)
        });
    });
}

/* 삭제 */
function onDelete(e) {
    e.stopPropagation();
    const sessionId = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name;

    if (!confirm(`"${name}" 탭 꾸러미를 삭제할까요?`)) return;

    chrome.runtime.sendMessage(
        { type: "DELETE_SESSION", sessionId },
        () => renderSessionList()
    );
}

/* 도메인 개수 계산 */
function countDomains(urls) {
    const map = {};
    urls.forEach((url) => {
        try {
            const domain = new URL(url).hostname;
            map[domain] = (map[domain] || 0) + 1;
        } catch {}
    });
    return map;
}

/* HTML escape */
function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function onDomainClick(e) {
    e.stopPropagation(); // 토글 방지

    const sessionId = e.currentTarget.dataset.sessionId;
    const domain = e.currentTarget.dataset.domain;

    chrome.storage.local.get("openInNewWindow", (data) => {
        chrome.runtime.sendMessage({
            type: "RESTORE_DOMAIN",
            sessionId,
            domain,
            openInNewWindow: Boolean(data.openInNewWindow)
        });
    });
}

function onEdit(e) {
    e.stopPropagation();

    const sessionId = e.currentTarget.dataset.id;
    const nameContainer = e.currentTarget
        .closest("li")
        .querySelector(".sessionName");

    const textEl = nameContainer.querySelector(".nameText");
    const oldName = textEl.textContent;

    const input = document.createElement("input");
    input.type = "text";
    input.value = oldName;
    input.className = "editInput";

    nameContainer.replaceChild(input, textEl);
    input.focus();
    input.select();

    const commit = () => {
        const newName = input.value.trim();
        if (!newName || newName === oldName) {
            cancel();
            return;
        }

        chrome.runtime.sendMessage(
            { type: "RENAME_SESSION", sessionId, name: newName },
            () => renderSessionList()
        );
    };

    const cancel = () => {
        nameContainer.replaceChild(textEl, input);
    };

    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") cancel();
    });

    input.addEventListener("blur", commit);
}
