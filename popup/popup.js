/**
 * 저장/복원 결과를 사용자에게 보여주기 위한 상태 메시지 영역
 */
const status = document.getElementById("status");

/**
 * "새 창에서 복원" 옵션 체크박스
 * - popup이 열릴 때 저장된 상태를 불러와 반영한다
 */
const checkbox = document.getElementById("newWindowCheckbox");

// popup 로드 시 체크박스 상태 복원
chrome.storage.local.get("openInNewWindow", (data) => {
  checkbox.checked = Boolean(data.openInNewWindow);
});

/**
 * 체크박스 상태 변경 시
 * - 사용자의 선택을 local storage에 저장
 * - popup을 닫았다 열어도 상태가 유지되도록 함
 */
checkbox.addEventListener("change", () => {
  chrome.storage.local.set({
    openInNewWindow: checkbox.checked
  });
});

/**
 * [현재 탭 저장] 버튼 클릭 처리
 * - background로 저장 요청 전송
 * - 저장 완료 후 "탭 N개 저장됨" 메시지 표시
 */
document.getElementById("saveBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "SAVE_TABS" }, (response) => {
    if (!response) return;

    status.textContent = `탭 ${response.count}개 저장됨`;
    status.classList.remove("hidden");

    // 2초 후 메시지 자동 숨김
    setTimeout(() => {
      status.classList.add("hidden");
    }, 2000);
  });
});

/**
 * [탭 다시 열기] 버튼 클릭 처리
 * - 저장된 "새 창에서 복원" 옵션을 확인
 * - 해당 옵션과 함께 복원 요청을 background로 전달
 */
document.getElementById("restoreBtn").addEventListener("click", () => {
  chrome.storage.local.get("openInNewWindow", (data) => {
    chrome.runtime.sendMessage({
      type: "RESTORE_TABS",
      openInNewWindow: Boolean(data.openInNewWindow)
    });
  });
});
