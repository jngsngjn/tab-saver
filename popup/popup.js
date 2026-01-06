/**
 * 저장 결과 메시지
 */
const status = document.getElementById("status");

/**
 * 세션 이름 입력
 */
const sessionNameInput = document.getElementById("sessionNameInput");

/**
 * "새 창에서 복원" 옵션 체크박스
 */
const checkbox = document.getElementById("newWindowCheckbox");

/**
 * 세션 목록 UI
 */
const sessionList = document.getElementById("sessionList");
const emptyHint = document.getElementById("emptyHint");

/**
 * popup 로드 시 초기화
 */
chrome.storage.local.get("openInNewWindow", (data) => {
    checkbox.checked = Boolean(data.openInNewWindow);
});
renderSessionList();

/**
 * 체크박스 상태 저장
 */
checkbox.addEventListener("change", () => {
    chrome.storage.local.set({
        openInNewWindow: checkbox.checked
    });
});

/**
 * [현재 탭 저장] 클릭
 * - 입력한 이름을 함께 전달
 */
document.getElementById("saveBtn").addEventListener("click", () => {
    const rawName = sessionNameInput.value.trim();

    chrome.runtime.sendMessage(
        {
            type: "SAVE_SESSION",
            name: rawName
        },
        (response) => {
            if (!response) return;

            status.textContent = `탭 ${response.count}개 저장됨`;
            status.classList.remove("hidden");

            setTimeout(() => {
                status.classList.add("hidden");
            }, 2000);

            // 입력값 초기화
            sessionNameInput.value = "";

            renderSessionList();
        }
    );
});

/**
 * 세션 목록 렌더링
 */
function renderSessionList() {
    chrome.storage.local.get("sessions", (data) => {
        const sessions = Array.isArray(data.sessions) ? data.sessions : [];

        if (sessions.length === 0) {
            sessionList.innerHTML = "";
            emptyHint.classList.remove("hidden");
            return;
        }

        emptyHint.classList.add("hidden");

        sessionList.innerHTML = sessions
            .map((s) => {
                const count = Array.isArray(s.urls) ? s.urls.length : 0;
                const safeName = escapeHtml(s.name || "Untitled");
                const safeId = escapeHtml(s.id);

                return `
          <li>
            <div class="sessionName">
              ${safeName}
              <span class="sessionMeta">(${count})</span>
            </div>
            <button class="openBtn" data-session-id="${safeId}">
              열기
            </button>
          </li>
        `;
            })
            .join("");

        sessionList.querySelectorAll(".openBtn").forEach((btn) => {
            btn.addEventListener("click", onClickOpenSession);
        });
    });
}

/**
 * [열기] 클릭 → 세션 복원
 */
function onClickOpenSession(e) {
    const sessionId = e.currentTarget.dataset.sessionId;

    chrome.storage.local.get("openInNewWindow", (data) => {
        chrome.runtime.sendMessage({
            type: "RESTORE_SESSION",
            sessionId,
            openInNewWindow: Boolean(data.openInNewWindow)
        });
    });
}

/**
 * HTML escape
 */
function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
