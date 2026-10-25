const $ = (id) => document.getElementById(id);
const boot = $("boot-screen"), loginView = $("login-view"), dashboard = $("dashboard-view");
let allFiles = [];
let toastTimer;

function showToast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2800);
}
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024, i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${units[i]}`;
}
function dateLabel(value) {
  try { return new Date(value).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }); }
  catch { return value; }
}
function showView(view) {
  boot.classList.add("hidden");
  loginView.classList.toggle("hidden", view !== "login");
  dashboard.classList.toggle("hidden", view !== "dashboard");
}
async function api(url, options = {}) {
  const response = await fetch(url, { credentials: "same-origin", ...options });
  const type = response.headers.get("content-type") || "";
  const data = type.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    if (response.status === 401 && url !== "/api/login") showView("login");
    throw new Error(data?.error || "Request failed. Please try again.");
  }
  return data;
}
async function init() {
  try {
    const state = await api("/api/session");
    if (state.authenticated) {
      showView("dashboard");
      await loadFiles();
    } else showView("login");
  } catch {
    showView("login");
  }
}
$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  const key = $("access-key").value;
  $("login-error").textContent = "";
  if (button) button.disabled = true;
  try {
    await api("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
    $("access-key").value = "";
    showView("dashboard");
    await loadFiles();
    showToast("Welcome to FIXA.");
  } catch (error) {
    $("login-error").textContent = error.message;
  } finally {
    if (button) button.disabled = false;
  }
});
$("logout-btn").addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST" }); }
  catch {}
  allFiles = [];
  showView("login");
  showToast("You have signed out.");
});
async function loadFiles() {
  try {
    const data = await api("/api/files");
    allFiles = data.files || [];
    renderFiles();
  } catch (error) { showToast(error.message); }
}
function fileKind(name) {
  const ext = (name.split(".").pop() || "FILE").toUpperCase();
  return ext.length > 5 ? "FILE" : ext;
}
function renderFiles() {
  const query = $("search-input").value.trim().toLowerCase();
  const filtered = allFiles.filter(f => f.original_name.toLowerCase().includes(query));
  $("total-files").textContent = allFiles.length;
  $("file-count").textContent = allFiles.length;
  $("total-size").textContent = formatBytes(allFiles.reduce((sum, f) => sum + f.size_bytes, 0));
  $("files-list").replaceChildren();
  $("empty-state").classList.toggle("hidden", filtered.length !== 0);
  if (!filtered.length && query) {
    $("empty-state").querySelector("strong").textContent = "No matching files";
    $("empty-state").querySelector("p").textContent = "Try a different search term.";
  } else {
    $("empty-state").querySelector("strong").textContent = "Your vault is empty";
    $("empty-state").querySelector("p").textContent = "Upload your first file to get started.";
  }
  for (const file of filtered) {
    const row = document.createElement("article"); row.className = "file-row";
    const icon = document.createElement("div"); icon.className = "file-icon"; icon.textContent = fileKind(file.original_name);
    const info = document.createElement("div"); info.className = "file-info";
    const name = document.createElement("div"); name.className = "file-name"; name.textContent = file.original_name;
    const meta = document.createElement("div"); meta.className = "file-meta"; meta.textContent = `${file.size_label || formatBytes(file.size_bytes)} · ${dateLabel(file.uploaded_at)}`;
    info.append(name, meta);
    const actions = document.createElement("div"); actions.className = "file-actions";
    const download = document.createElement("button"); download.className = "icon-btn"; download.textContent = "↓ Save"; download.setAttribute("aria-label", `Download ${file.original_name}`);
    download.addEventListener("click", () => downloadFile(file));
    const del = document.createElement("button"); del.className = "icon-btn delete-btn"; del.textContent = "Delete"; del.setAttribute("aria-label", `Delete ${file.original_name}`);
    del.addEventListener("click", () => deleteFile(file));
    actions.append(download, del); row.append(icon, info, actions); $("files-list").append(row);
  }
}
async function downloadFile(file) {
  try {
    const response = await fetch(`/api/files/${encodeURIComponent(file.id)}/download`, { credentials: "same-origin" });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Download failed.");
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = file.original_name;
    document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  } catch (error) { showToast(error.message); }
}
async function deleteFile(file) {
  if (!window.confirm(`Delete "${file.original_name}" permanently?`)) return;
  try {
    await api(`/api/files/${encodeURIComponent(file.id)}`, { method: "DELETE" });
    allFiles = allFiles.filter(f => f.id !== file.id);
    renderFiles(); showToast("File deleted.");
  } catch (error) { showToast(error.message); }
}
$("file-input").addEventListener("change", () => {
  const file = $("file-input").files[0];
  $("selected-file").textContent = file ? `${file.name} · ${formatBytes(file.size)}` : "No file selected";
});
$("upload-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = $("file-input").files[0];
  if (!file) return;
  const button = $("upload-btn");
  button.disabled = true; button.textContent = "UPLOADING...";
  $("upload-status").textContent = "Uploading securely. Keep this page open.";
  const form = new FormData(); form.append("file", file);
  try {
    await api("/api/files", { method: "POST", body: form });
    $("file-input").value = ""; $("selected-file").textContent = "No file selected";
    $("upload-status").textContent = "";
    await loadFiles(); showToast("File uploaded successfully.");
  } catch (error) {
    $("upload-status").textContent = error.message;
    showToast(error.message);
  } finally {
    button.disabled = false; button.innerHTML = 'UPLOAD TO VAULT <span>↑</span>';
  }
});
$("search-input").addEventListener("input", renderFiles);
$("refresh-btn").addEventListener("click", loadFiles);
const dropZone = document.querySelector(".drop-zone");
["dragenter", "dragover"].forEach(name => dropZone.addEventListener(name, e => { e.preventDefault(); dropZone.classList.add("dragover"); }));
["dragleave", "drop"].forEach(name => dropZone.addEventListener(name, e => { e.preventDefault(); dropZone.classList.remove("dragover"); }));
dropZone.addEventListener("drop", e => {
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const transfer = new DataTransfer(); transfer.items.add(file); $("file-input").files = transfer.files;
  $("selected-file").textContent = `${file.name} · ${formatBytes(file.size)}`;
});
setTimeout(init, 900);
