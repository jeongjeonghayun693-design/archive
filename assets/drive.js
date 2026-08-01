/**
 * Google Drive REST v3 래퍼.
 * 스코프는 drive.file — 이 앱이 직접 만든 파일만 보이고 건드릴 수 있다.
 * (드라이브의 나머지 파일은 앱에서 접근 불가 = 안전)
 */
const SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_MIME = "application/vnd.google-apps.folder";

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;
let pending = null; // 진행 중인 로그인 요청의 resolve/reject

export function isSignedIn() {
  return !!accessToken && Date.now() < tokenExpiresAt;
}

export function initTokenClient(clientId) {
  if (tokenClient) return;
  if (!window.google?.accounts?.oauth2) {
    throw new Error("Google Identity 스크립트를 아직 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
  if (!clientId || clientId.startsWith("여기에")) {
    throw new Error("config.js 의 CLIENT_ID 가 아직 설정되지 않았습니다.");
  }
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPE,
    callback: (res) => {
      const p = pending;
      pending = null;
      if (!p) return;
      if (res.error) return p.reject(new Error(res.error_description || res.error));
      accessToken = res.access_token;
      tokenExpiresAt = Date.now() + (Number(res.expires_in) - 60) * 1000;
      p.resolve(accessToken);
    },
    error_callback: (err) => {
      const p = pending;
      pending = null;
      p?.reject(new Error(err?.message || "로그인 창이 닫혔습니다."));
    },
  });
}

/** @param {{prompt?: '' | 'consent' | 'select_account'}} opts */
export function requestToken({ prompt = "" } = {}) {
  return new Promise((resolve, reject) => {
    if (!tokenClient) return reject(new Error("토큰 클라이언트가 초기화되지 않았습니다."));
    if (pending) return reject(new Error("이미 로그인 창이 열려 있습니다."));
    pending = { resolve, reject };
    tokenClient.requestAccessToken({ prompt });
  });
}

export function signOut() {
  if (accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  tokenExpiresAt = 0;
}

async function api(path, options = {}) {
  if (!isSignedIn()) throw new Error("Google 로그인이 필요합니다.");
  const res = await fetch(`https://www.googleapis.com/drive/v3/${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) },
  });
  if (!res.ok) {
    if (res.status === 401) {
      accessToken = null;
      tokenExpiresAt = 0;
      throw new Error("로그인 세션이 만료됐습니다. 'Google 로그인' 을 다시 눌러 주세요.");
    }
    const text = await res.text();
    throw new Error(`Drive API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res;
}

/** 백업 폴더를 찾고, 없으면 만든다. */
export async function ensureFolder(name) {
  const q = encodeURIComponent(
    `mimeType='${FOLDER_MIME}' and name='${name.replace(/'/g, "\\'")}' and trashed=false`
  );
  const res = await api(`files?q=${q}&fields=files(id,name)&pageSize=1`);
  const { files } = await res.json();
  if (files?.length) return files[0].id;

  const created = await api("files?fields=id", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: FOLDER_MIME }),
  });
  return (await created.json()).id;
}

export async function listBackups(folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const fields = encodeURIComponent("files(id,name,size,createdTime,description,webViewLink)");
  const res = await api(`files?q=${q}&fields=${fields}&orderBy=createdTime desc&pageSize=200`);
  return (await res.json()).files || [];
}

/**
 * 재개 가능(resumable) 업로드. 진행률을 받기 위해 XHR 을 쓴다.
 * @returns {Promise<object>} 생성된 파일 메타데이터
 */
export async function uploadFile({ blob, name, folderId, description, onProgress }) {
  if (!isSignedIn()) throw new Error("Google 로그인이 필요합니다.");

  const start = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,createdTime,webViewLink",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": blob.type || "application/zip",
        "X-Upload-Content-Length": String(blob.size),
      },
      body: JSON.stringify({ name, parents: [folderId], description }),
    }
  );
  if (!start.ok) throw new Error(`업로드 세션 생성 실패 ${start.status}: ${(await start.text()).slice(0, 300)}`);

  const sessionUrl = start.headers.get("Location");
  if (!sessionUrl) throw new Error("업로드 세션 URL 을 받지 못했습니다.");

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", sessionUrl, true);
    xhr.setRequestHeader("Content-Type", blob.type || "application/zip");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded, e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          resolve({ name });
        }
      } else {
        reject(new Error(`업로드 실패 ${xhr.status}: ${xhr.responseText.slice(0, 300)}`));
      }
    };
    xhr.onerror = () => reject(new Error("네트워크 오류로 업로드가 중단되었습니다."));
    xhr.send(blob);
  });
}

export async function downloadFile(fileId, fileName) {
  const res = await api(`files/${fileId}?alt=media`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** 영구 삭제가 아니라 드라이브 휴지통으로 이동 (30일 내 복구 가능). */
export async function trashFile(fileId) {
  await api(`files/${fileId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
}
