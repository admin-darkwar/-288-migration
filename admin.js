/* ==========================================================================
   SERVER 288 — MIGRATION REGISTRATION
   Admin dashboard logic.
   ========================================================================== */

const CONFIG = {
  API_URL: "https://script.google.com/u/0/home/projects/1kDp4qM-X1aGTkXO_YXTiwUiIuVPPaizGMipfWzLzX_Jz3N5wV1npIZ5B/edit",
  // Fill in with the same Sheet ID used in the Apps Script Script Properties,
  // so "Open Sheet" can jump admins straight to File → Download → Excel.
  SHEET_URL: "https://docs.google.com/spreadsheets/d/1pf2Uu_rZndv7NsUkkWIgFWC3xQZR3Zvim1o5_FVVws0/edit?pli=1&gid=1636155214#gid=1636155214",
};

let sessionToken = null;
let allRecords = [];
let pendingEmail = null; // email currently awaiting OTP verification
const lang = detectLanguage();

document.addEventListener("DOMContentLoaded", () => {
  buildLangSelect();
  document.getElementById("openSheetBtn").href = CONFIG.SHEET_URL;
  document.getElementById("requestOtpBtn").addEventListener("click", requestOtp);
  document.getElementById("verifyOtpBtn").addEventListener("click", verifyOtp);
  document.getElementById("backToLoginBtn").addEventListener("click", backToLogin);
  document.getElementById("resendOtpBtn").addEventListener("click", (e) => { e.preventDefault(); requestOtp(); });
  document.getElementById("adminPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") requestOtp(); });
  document.getElementById("otpCode").addEventListener("keydown", (e) => { if (e.key === "Enter") verifyOtp(); });
  document.getElementById("searchBox").addEventListener("input", renderTable);
  ["filterServer", "filterTarget", "filterType", "filterStatus"].forEach((id) =>
    document.getElementById(id).addEventListener("change", renderTable)
  );
  document.getElementById("exportCsvBtn").addEventListener("click", exportCsv);
  document.getElementById("refreshBtn").addEventListener("click", loadData);
});

function buildLangSelect() {
  const sel = document.getElementById("langSelect");
  Object.keys(LANG_META).forEach((code) => {
    const opt = document.createElement("option");
    opt.value = code; opt.textContent = LANG_META[code].label;
    sel.appendChild(opt);
  });
  sel.value = lang;
  document.documentElement.dir = LANG_META[lang].dir;
}

async function callApi(payload) {
  const res = await fetch(CONFIG.API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

function showBanner(text, kind) {
  document.getElementById("banner").innerHTML = `<div class="banner banner-${kind || "error"}">${text}</div>`;
}

async function requestOtp() {
  const email = document.getElementById("adminEmail").value.trim();
  const password = document.getElementById("adminPassword").value;
  if (!email || !password) {
    showBanner("Enter both your admin email and the admin password.");
    return;
  }
  const btn = document.getElementById("requestOtpBtn");
  btn.disabled = true;
  const original = btn.textContent;
  btn.innerHTML = `<span class="spinner"></span>Sending…`;
  try {
    const resp = await callApi({ action: "adminRequestOtp", email, password });
    if (resp.ok) {
      pendingEmail = email;
      document.getElementById("otpEmailDisplay").textContent = email;
      document.getElementById("loginPanel").style.display = "none";
      document.getElementById("otpPanel").style.display = "block";
      document.getElementById("otpCode").value = "";
      document.getElementById("otpCode").focus();
      document.getElementById("banner").innerHTML = "";
    } else if (resp.error === "invalid_password") {
      showBanner("Incorrect admin password.");
    } else if (resp.error === "not_authorized") {
      showBanner("That email is not on the admin list.");
    } else {
      showBanner("Could not send the code: " + (resp.error || "unknown error"));
    }
  } catch (e) {
    showBanner("Could not reach the server. Check API_URL in admin.js.");
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function verifyOtp() {
  const code = document.getElementById("otpCode").value.trim();
  if (!code) return;
  const btn = document.getElementById("verifyOtpBtn");
  btn.disabled = true;
  const original = btn.textContent;
  btn.innerHTML = `<span class="spinner"></span>Verifying…`;
  try {
    const resp = await callApi({ action: "adminVerifyOtp", email: pendingEmail, code });
    if (resp.ok) {
      sessionToken = resp.token;
      document.getElementById("otpPanel").style.display = "none";
      document.getElementById("dashboard").style.display = "block";
      document.getElementById("banner").innerHTML = "";
      await loadData();
    } else if (resp.error === "invalid_code") {
      showBanner("That code is incorrect.");
    } else if (resp.error === "expired") {
      showBanner("That code has expired. Request a new one.");
    } else {
      showBanner("Could not verify the code: " + (resp.error || "unknown error"));
    }
  } catch (e) {
    showBanner("Could not reach the server. Check API_URL in admin.js.");
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function backToLogin() {
  pendingEmail = null;
  document.getElementById("otpPanel").style.display = "none";
  document.getElementById("loginPanel").style.display = "block";
  document.getElementById("banner").innerHTML = "";
}

async function loadData() {
  try {
    const resp = await callApi({ action: "adminList", token: sessionToken });
    if (!resp.ok) { showBanner("Could not load data: " + resp.error); return; }
    allRecords = resp.records;
    buildFilterOptions();
    renderStats();
    renderTable();
  } catch (e) {
    showBanner("Network error loading data.");
  }
}

function buildFilterOptions() {
  const servers = [...new Set(allRecords.map((r) => r.SourceServer))].sort((a, b) => a - b);
  const sel = document.getElementById("filterServer");
  sel.innerHTML = '<option value="">Source server: all</option>' + servers.map((s) => `<option>${s}</option>`).join("");
}

function renderStats() {
  const total = allRecords.length;
  const totalScore = allRecords.reduce((sum, r) => sum + (Number(r.MigrationScore) || 0), 0);
  const groups = allRecords.filter((r) => r.MigrationType === "Group").length;
  const byTarget = {};
  allRecords.forEach((r) => (byTarget[r.TargetAlliance] = (byTarget[r.TargetAlliance] || 0) + 1));
  const factionCount = { Fighter: 0, Shooter: 0, Rider: 0 };
  allRecords.forEach((r) => {
    ["Apc1Faction", "Apc2Faction", "Apc3Faction", "Apc4Faction"].forEach((f) => {
      if (factionCount[r[f]] !== undefined) factionCount[r[f]]++;
    });
  });
  const seasonYes = allRecords.filter((r) => r.Season === "Yes").length;

  const cards = [
    ["Total Players", total],
    ["Total Migration Score", totalScore.toLocaleString("en-US")],
    ["Group Submissions", groups],
    ["Individual Submissions", total - groups],
    ["DWSS", byTarget.DWSS || 0],
    ["NMC", byTarget.NMC || 0],
    ["M4D", byTarget.M4D || 0],
    ["Not Decided", byTarget["Not decided"] || 0],
    ["Fighters", factionCount.Fighter],
    ["Shooters", factionCount.Shooter],
    ["Riders", factionCount.Rider],
    ["Season Events: Yes", seasonYes],
  ];
  document.getElementById("statGrid").innerHTML = cards
    .map(([label, num]) => `<div class="stat-card"><div class="num">${num}</div><div class="label">${label}</div></div>`)
    .join("");
}

function filteredRecords() {
  const q = document.getElementById("searchBox").value.trim().toLowerCase();
  const server = document.getElementById("filterServer").value;
  const target = document.getElementById("filterTarget").value;
  const type = document.getElementById("filterType").value;
  const status = document.getElementById("filterStatus").value;

  return allRecords.filter((r) => {
    if (server && String(r.SourceServer) !== server) return false;
    if (target && r.TargetAlliance !== target) return false;
    if (type && r.MigrationType !== type) return false;
    if (status && r.Status !== status) return false;
    if (q) {
      const hay = [r.PlayerName, r.MigrationId, r.Reference, r.AllianceName].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function apcCell(r, i) {
  const f = r["Apc" + i + "Faction"], p = r["Apc" + i + "Power"];
  return f ? `${f} ${p}M` : "—";
}

function renderTable() {
  const rows = filteredRecords();
  document.getElementById("tableBody").innerHTML = rows
    .map((r) => `
      <tr>
        <td>${r.Reference}</td>
        <td><span class="status-pill status-toggle ${r.Status === "Locked" ? "status-locked" : "status-unlocked"}" data-ref="${r.Reference}" data-status="${r.Status}">${r.Status}</span></td>
        <td>${r.SourceServer}</td>
        <td>${escapeHtml(r.AllianceName)}</td>
        <td>${escapeHtml(r.PlayerName)}</td>
        <td>${escapeHtml(r.MigrationId)}</td>
        <td>${Number(r.MigrationScore || 0).toLocaleString("en-US")}</td>
        <td>${r.MigrationType}${r.MigrationType === "Group" ? " (" + r.GroupSize + ")" : ""}</td>
        <td>${r.TargetAlliance}</td>
        <td>${apcCell(r, 1)}</td><td>${apcCell(r, 2)}</td><td>${apcCell(r, 3)}</td><td>${apcCell(r, 4)}</td>
        <td>${r.Season}</td>
        <td>${r.Bgb}</td>
        <td>${r.UpdatedAt ? new Date(r.UpdatedAt).toLocaleString() : ""}</td>
      </tr>`)
    .join("");

  document.querySelectorAll(".status-toggle").forEach((el) => {
    el.addEventListener("click", async () => {
      const ref = el.dataset.ref;
      const current = el.dataset.status;
      const next = current === "Locked" ? "Unlocked" : "Locked";
      el.textContent = "…";
      const resp = await callApi({ action: "adminSetStatus", token: sessionToken, reference: ref, status: next });
      if (resp.ok) {
        const rec = allRecords.find((r) => r.Reference === ref);
        if (rec) rec.Status = next;
        renderTable();
      } else {
        showBanner("Could not update status: " + resp.error);
      }
    });
  });
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function exportCsv() {
  const rows = filteredRecords();
  const headers = ["Reference","Status","SourceServer","AllianceName","PlayerName","MigrationId","MigrationScore","MigrationType","GroupSize","TargetAlliance","Apc1Faction","Apc1Power","Apc2Faction","Apc2Power","Apc3Faction","Apc3Power","Apc4Faction","Apc4Power","Season","Bgb","CreatedAt","UpdatedAt"];
  const csvRows = [headers.join(",")];
  rows.forEach((r) => {
    csvRows.push(headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(","));
  });
  const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "server288_migration_registrations.csv";
  a.click();
  URL.revokeObjectURL(url);
}
