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
        (res) => {
            if (!res || res.success === false) {
                showToast("저장할 수 있는 탭이 없어요", true);
                return;
            }

            sessionNameInput.value = "";
            showToast(`탭 ${res.count}개 저장됨`);
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

        sessionList.innerHTML = sessions.map(renderSessionItem).join("");
        bindSessionEvents();
    });
}

function renderSessionItem(s) {
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
      <div class="sessionHeader">
        <div class="sessionName">
          <span>${safeName}</span>
          <span class="sessionMeta">(${count})</span>
        </div>

        <div class="actions">
          <button class="openBtn" data-id="${s.id}">열기</button>
          <button class="deleteBtn" data-id="${s.id}" data-name="${safeName}">
            삭제
          </button>
        </div>
      </div>

      <ul class="domainList hidden">
        ${domainListHtml}
      </ul>
    </li>
  `;
}

/* 이벤트 바인딩 */
function bindSessionEvents() {
    sessionList.querySelectorAll(".openBtn")
        .forEach(btn => btn.addEventListener("click", onOpen));

    sessionList.querySelectorAll(".deleteBtn")
        .forEach(btn => btn.addEventListener("click", onDelete));

    sessionList.querySelectorAll(".sessionHeader")
        .forEach(header => header.addEventListener("click", onToggle));

    sessionList.querySelectorAll(".domainItem")
        .forEach(item => item.addEventListener("click", onDomainClick));
}

/* 토글 */
function onToggle(e) {
    if (e.target.closest("button")) return;
    const item = e.currentTarget.closest(".sessionItem");
    item.querySelector(".domainList").classList.toggle("hidden");
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

    chrome.runtime.sendMessage(
        { type: "DELETE_SESSION", sessionId },
        renderSessionList
    );
}

/* 도메인 */
function onDomainClick(e) {
    e.stopPropagation();
    const { sessionId, domain } = e.currentTarget.dataset;

    chrome.storage.local.get("openInNewWindow", (data) => {
        chrome.runtime.sendMessage({
            type: "RESTORE_DOMAIN",
            sessionId,
            domain,
            openInNewWindow: Boolean(data.openInNewWindow)
        });
    });
}

/* Utils */
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

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

const status = document.getElementById("status");

function showToast(message, type = "success") {
    status.textContent = message;

    status.classList.remove("success", "error");
    status.classList.add(type, "show");

    clearTimeout(status._timer);
    status._timer = setTimeout(() => {
        status.classList.remove("show");
    }, 1500);
}