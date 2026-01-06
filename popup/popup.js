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
                const domainMap = countDomains(s.urls);

                const domainListHtml = Object.entries(domainMap)
                    .map(
                        ([domain, count]) =>
                            `<li class="domainItem">${domain} (${count})</li>`
                    )
                    .join("");

                return `
          <li class="sessionItem">
            <div class="sessionHeader" data-id="${s.id}">
              <div class="sessionName">
                ${escapeHtml(s.name)}
                <span class="sessionMeta">(${s.urls.length})</span>
              </div>
              <div class="actions">
                <button class="iconBtn openBtn" data-id="${s.id}">▶</button>
                <button class="iconBtn deleteBtn" data-id="${s.id}" data-name="${escapeHtml(
                    s.name
                )}">🗑</button>
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
