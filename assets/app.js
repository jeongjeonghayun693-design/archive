import { createZip } from "./zip.js";
import * as drive from "./drive.js";

const CONFIG = window.ARCHIVE_CONFIG || {};
const SKIP = new Set(CONFIG.SKIP || []);
const $ = (sel) => document.querySelector(sel);

const state = {
  folderId: null,
  entries: [],     // {path, getFile, size}
  sourceName: "",  // 선택한 폴더 이름
  totalSize: 0,
  busy: false,
};

/* ---------- 유틸 ---------- */

function fmtBytes(n) {
  if (n == null) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = Number(n);
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function fmtDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function log(msg, kind = "info") {
  const el = $("#log");
  const line = document.createElement("div");
  line.className = `log-line log-${kind}`;
  line.textContent = `[${new Date().toLocaleTimeString("ko-KR")}] ${msg}`;
  el.prepend(line);
}

function setStatus(text, pct = null) {
  $("#status-text").textContent = text;
  const bar = $("#progress");
  if (pct == null) {
    bar.classList.add("hidden");
  } else {
    bar.classList.remove("hidden");
    $("#progress-fill").style.width = `${Math.max(0, Math.min(100, pct))}%`;
  }
}

function setBusy(v) {
  state.busy = v;
  document.querySelectorAll("button[data-guard]").forEach((b) => (b.disabled = v));
  updateButtons();
}

function updateButtons() {
  const signedIn = drive.isSignedIn();
  $("#btn-signin").classList.toggle("hidden", signedIn);
  $("#btn-signout").classList.toggle("hidden", !signedIn);
  $("#account-state").textContent = signedIn ? "드라이브 연결됨" : "연결 안 됨";
  $("#account-state").className = signedIn ? "pill pill-on" : "pill";
  if (!state.busy) {
    $("#btn-backup").disabled = !(signedIn && state.entries.length > 0);
    $("#btn-upload-zip").disabled = !signedIn;
    $("#btn-refresh").disabled = !signedIn;
  }
}

/* ---------- 폴더 선택 ---------- */

async function scanHandle(dirHandle, prefix, out) {
  for await (const [name, handle] of dirHandle.entries()) {
    if (SKIP.has(name)) continue;
    const path = prefix ? `${prefix}/${name}` : name;
    if (handle.kind === "file") {
      out.push({ path, getFile: () => handle.getFile() });
    } else {
      await scanHandle(handle, path, out);
    }
  }
}

async function pickFolderModern() {
  const dirHandle = await window.showDirectoryPicker({ mode: "read" });
  const entries = [];
  setStatus("폴더를 훑는 중…");
  await scanHandle(dirHandle, dirHandle.name, entries);
  return { name: dirHandle.name, entries };
}

function pickFolderFallback() {
  // Firefox / Safari 용. webkitdirectory 는 파일을 한 번에 전부 메모리에 올리지는 않는다.
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.webkitdirectory = true;
    input.onchange = () => {
      const files = Array.from(input.files || []);
      if (!files.length) return reject(new Error("선택된 파일이 없습니다."));
      const rootName = files[0].webkitRelativePath.split("/")[0];
      const entries = files
        .filter((f) => !f.webkitRelativePath.split("/").some((seg) => SKIP.has(seg)))
        .map((f) => ({ path: f.webkitRelativePath, getFile: async () => f }));
      resolve({ name: rootName, entries });
    };
    input.click();
  });
}

async function onPickFolder() {
  try {
    setBusy(true);
    const picked = window.showDirectoryPicker ? await pickFolderModern() : await pickFolderFallback();
    if (!picked.entries.length) {
      log(`'${picked.name}' 안에 백업할 파일이 없습니다.`, "warn");
      return;
    }

    setStatus("파일 크기 계산 중…");
    let total = 0;
    for (const e of picked.entries) {
      const f = await e.getFile();
      e.size = f.size;
      total += f.size;
    }

    state.sourceName = picked.name;
    state.entries = picked.entries;
    state.totalSize = total;

    $("#source-empty").classList.add("hidden");
    $("#source-detail").classList.remove("hidden");
    $("#source-name").textContent = picked.name;
    $("#source-meta").textContent = `${picked.entries.length.toLocaleString("ko-KR")}개 파일 · ${fmtBytes(total)}`;
    $("#zip-name").value = `${picked.name}_${stamp()}.zip`;

    if (total > (CONFIG.WARN_SIZE || Infinity)) {
      log(`${fmtBytes(total)} 는 브라우저에서 압축하기엔 큽니다. backup.ps1 로 미리 ZIP 을 만든 뒤 'ZIP 파일 올리기'를 쓰세요.`, "warn");
    }
    log(`'${picked.name}' 선택됨 — ${picked.entries.length}개 파일, ${fmtBytes(total)}`);
    setStatus("대기 중");
  } catch (err) {
    if (err?.name !== "AbortError") log(err.message, "error");
    setStatus("대기 중");
  } finally {
    setBusy(false);
  }
}

/* ---------- 백업 실행 ---------- */

async function onBackup() {
  if (!state.entries.length) return;
  try {
    setBusy(true);
    const name = ($("#zip-name").value || `${state.sourceName}_${stamp()}.zip`).trim();
    const note = $("#zip-note").value.trim();

    const zip = await createZip(state.entries, (done, total, current) => {
      const pct = (done / total) * 100;
      setStatus(`압축 중 ${done}/${total} — ${current}`, pct);
    });

    log(`압축 완료: ${fmtBytes(state.totalSize)} → ${fmtBytes(zip.size)}`);
    await uploadBlob(zip, name, note || `원본 폴더: ${state.sourceName}`);
  } catch (err) {
    log(err.message, "error");
    setStatus("실패");
  } finally {
    setBusy(false);
  }
}

async function uploadBlob(blob, name, description) {
  setStatus("업로드 준비 중…", 0);
  const meta = await drive.uploadFile({
    blob,
    name,
    folderId: state.folderId,
    description,
    onProgress: (loaded, total) => setStatus(`업로드 중 ${fmtBytes(loaded)} / ${fmtBytes(total)}`, (loaded / total) * 100),
  });
  log(`업로드 완료: ${meta.name}`, "ok");
  setStatus("완료");
  await refreshList();
}

async function onUploadZip() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".zip,.7z,.tar,.gz,.rar";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      setBusy(true);
      await uploadBlob(file, file.name, "직접 올린 파일");
    } catch (err) {
      log(err.message, "error");
      setStatus("실패");
    } finally {
      setBusy(false);
    }
  };
  input.click();
}

/* ---------- 백업 목록 ---------- */

async function refreshList() {
  if (!drive.isSignedIn() || !state.folderId) return;
  const tbody = $("#backup-rows");
  tbody.innerHTML = `<tr><td colspan="4" class="muted">불러오는 중…</td></tr>`;
  try {
    const files = await drive.listBackups(state.folderId);
    $("#backup-count").textContent = `${files.length}개`;
    if (!files.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="muted">아직 백업이 없습니다.</td></tr>`;
      return;
    }
    tbody.innerHTML = "";
    let sum = 0;
    for (const f of files) {
      sum += Number(f.size || 0);
      const tr = document.createElement("tr");

      const nameCell = document.createElement("td");
      nameCell.innerHTML = `<div class="fname"></div><div class="muted small"></div>`;
      nameCell.querySelector(".fname").textContent = f.name;
      nameCell.querySelector(".small").textContent = f.description || "";
      tr.appendChild(nameCell);

      const sizeCell = document.createElement("td");
      sizeCell.textContent = fmtBytes(f.size);
      tr.appendChild(sizeCell);

      const dateCell = document.createElement("td");
      dateCell.textContent = fmtDate(f.createdTime);
      tr.appendChild(dateCell);

      const actions = document.createElement("td");
      actions.className = "actions";

      const dl = document.createElement("button");
      dl.className = "mini";
      dl.textContent = "다운로드";
      dl.onclick = async () => {
        dl.disabled = true;
        dl.textContent = "받는 중…";
        try {
          await drive.downloadFile(f.id, f.name);
          log(`다운로드: ${f.name}`, "ok");
        } catch (err) {
          log(err.message, "error");
        } finally {
          dl.disabled = false;
          dl.textContent = "다운로드";
        }
      };
      actions.appendChild(dl);

      if (f.webViewLink) {
        const open = document.createElement("a");
        open.className = "mini";
        open.href = f.webViewLink;
        open.target = "_blank";
        open.rel = "noopener";
        open.textContent = "드라이브";
        actions.appendChild(open);
      }

      const del = document.createElement("button");
      del.className = "mini danger";
      del.textContent = "휴지통";
      del.onclick = async () => {
        if (!confirm(`'${f.name}' 을(를) 드라이브 휴지통으로 옮깁니다.\n(30일 안에는 드라이브에서 복구할 수 있습니다)`)) return;
        try {
          await drive.trashFile(f.id);
          log(`휴지통으로 이동: ${f.name}`, "warn");
          await refreshList();
        } catch (err) {
          log(err.message, "error");
        }
      };
      actions.appendChild(del);

      tr.appendChild(actions);
      tbody.appendChild(tr);
    }
    $("#backup-total").textContent = fmtBytes(sum);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" class="muted"></td></tr>`;
    tbody.querySelector("td").textContent = err.message;
    log(err.message, "error");
  }
}

/* ---------- 로그인 ---------- */

async function onSignIn() {
  try {
    setBusy(true);
    setStatus("Google 로그인 중…");
    drive.initTokenClient(CONFIG.CLIENT_ID);
    await drive.requestToken();
    state.folderId = await drive.ensureFolder(CONFIG.DRIVE_FOLDER || "ARCHIVE-Backups");
    log(`드라이브 연결됨 — 폴더 '${CONFIG.DRIVE_FOLDER}'`, "ok");
    setStatus("대기 중");
    await refreshList();
  } catch (err) {
    log(err.message, "error");
    setStatus("로그인 실패");
  } finally {
    setBusy(false);
  }
}

function onSignOut() {
  drive.signOut();
  state.folderId = null;
  $("#backup-rows").innerHTML = `<tr><td colspan="4" class="muted">로그인하면 백업 목록이 표시됩니다.</td></tr>`;
  $("#backup-count").textContent = "-";
  $("#backup-total").textContent = "-";
  log("연결을 끊었습니다.");
  updateButtons();
}

/* ---------- 시작 ---------- */

function boot() {
  const configured = CONFIG.CLIENT_ID && !CONFIG.CLIENT_ID.startsWith("여기에");
  if (!configured) {
    $("#setup-banner").classList.remove("hidden");
    $("#btn-signin").disabled = true;
  }
  $("#folder-label").textContent = CONFIG.DRIVE_FOLDER || "ARCHIVE-Backups";
  if (!window.showDirectoryPicker) {
    log("이 브라우저는 폴더 선택 API 를 완전히 지원하지 않습니다. Chrome/Edge 를 권장합니다.", "warn");
  }
  if (typeof CompressionStream === "undefined") {
    log("브라우저에 압축 기능이 없어 ZIP 이 무압축으로 만들어집니다.", "warn");
  }

  $("#btn-signin").onclick = onSignIn;
  $("#btn-signout").onclick = onSignOut;
  $("#btn-pick").onclick = onPickFolder;
  $("#btn-backup").onclick = onBackup;
  $("#btn-upload-zip").onclick = onUploadZip;
  $("#btn-refresh").onclick = refreshList;
  updateButtons();
}

boot();
