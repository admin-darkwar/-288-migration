/**
 * SERVER 288 — MIGRATION REGISTRATION
 * Google Apps Script backend.
 *
 * SETUP
 * 1. Create a new Google Sheet. Note its ID (the long string in its URL).
 * 2. Extensions → Apps Script. Delete the default code and paste this file in.
 * 3. Also add index.html's config: Project Settings → Script Properties, add:
 *      SHEET_ID          = <your sheet id>
 *      ADMIN_PASSWORD    = <a password you choose>
 *      ADMIN_EMAILS      = comma-separated list of allowed admin Google accounts
 * 4. Run `setup` once from the editor (select it in the function dropdown, click Run)
 *    to create the "Registrations" sheet with headers. Grant permissions when asked.
 * 5. Deploy → New deployment → type "Web app".
 *      Execute as: Me
 *      Who has access: Anyone
 *    Copy the deployment URL into CONFIG.API_URL in app.js and admin.js.
 *
 * SECURITY NOTE: the admin password lives in Script Properties, never in the
 * frontend code, so it is not exposed even though the frontend is public.
 */

const SHEET_NAME = "Registrations";
const HEADERS = [
  "Reference", "Status", "UpdateId", "SourceServer", "AllianceName", "PlayerName",
  "MigrationId", "MigrationScore", "MigrationType", "GroupSize", "TargetAlliance",
  "Apc1Faction", "Apc1Power", "Apc1PowerM", "Apc2Faction", "Apc2Power", "Apc2PowerM",
  "Apc3Faction", "Apc3Power", "Apc3PowerM", "Apc4Faction", "Apc4Power", "Apc4PowerM",
  "Season", "Bgb", "Lang", "CreatedAt", "UpdatedAt",
];

function setup() {
  const sheet = getSheet_();
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }
}

function getSheet_() {
  const id = PropertiesService.getScriptProperties().getProperty("SHEET_ID");
  const ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut_({ ok: false, error: "bad_request" });
  }

  const action = body.action;
  try {
    switch (action) {
      case "submit": return jsonOut_(handleSubmit_(body));
      case "update": return jsonOut_(handleUpdate_(body));
      case "getForUpdate": return jsonOut_(handleGetForUpdate_(body));
      case "adminRequestOtp": return jsonOut_(handleAdminRequestOtp_(body));
      case "adminVerifyOtp": return jsonOut_(handleAdminVerifyOtp_(body));
      case "adminList": return jsonOut_(handleAdminList_(body));
      case "adminSetStatus": return jsonOut_(handleAdminSetStatus_(body));
      default: return jsonOut_({ ok: false, error: "unknown_action" });
    }
  } catch (err) {
    return jsonOut_({ ok: false, error: "server_error", detail: String(err) });
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------------------
// Power parsing: "125.5" + unit "M"/"G" -> value in M
// ---------------------------------------------------------------------
function toPowerM_(value, unit) {
  const n = parseFloat(value);
  if (isNaN(n)) return "";
  return unit === "G" ? n * 1000 : n;
}

function rowFromPayload_(p, reference, updateId, status, createdAt) {
  const apc = p.apc || [{}, {}, {}, {}];
  const now = new Date();
  return [
    reference, status, updateId, p.sourceServer, p.allianceName, p.playerName,
    p.migrationId, p.migrationScore, p.migrationType, p.groupSize || "", p.targetAlliance,
    apc[0].faction || "", apc[0].power || "", toPowerM_(apc[0].power, apc[0].unit),
    apc[1].faction || "", apc[1].power || "", toPowerM_(apc[1].power, apc[1].unit),
    apc[2].faction || "", apc[2].power || "", toPowerM_(apc[2].power, apc[2].unit),
    apc[3].faction || "", apc[3].power || "", (apc[3].power ? toPowerM_(apc[3].power, apc[3].unit) : ""),
    p.season, p.bgb, p.lang || "en", createdAt || now, now,
  ];
}

// ---------------------------------------------------------------------
// SUBMIT (with a script lock so two simultaneous submissions of the same
// Migration ID cannot both pass the duplicate check — see spec §10).
// ---------------------------------------------------------------------
function handleSubmit_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_();
    const data = sheet.getDataRange().getValues();
    const idCol = HEADERS.indexOf("MigrationId");
    for (let r = 1; r < data.length; r++) {
      if (String(data[r][idCol]).trim() === String(p.migrationId).trim()) {
        return { ok: false, error: "duplicate" };
      }
    }
    const reference = generateReference_(sheet);
    const updateId = Utilities.getUuid();
    sheet.appendRow(rowFromPayload_(p, reference, updateId, "Unlocked", new Date()));
    return { ok: true, reference: reference, updateId: updateId };
  } finally {
    lock.releaseLock();
  }
}

function generateReference_(sheet) {
  const lastRow = sheet.getLastRow(); // header counts as row 1
  const n = lastRow; // next sequential number regardless of header offset
  return "REF-288-" + String(n).padStart(6, "0");
}

// ---------------------------------------------------------------------
// UPDATE (only if Unlocked)
// ---------------------------------------------------------------------
function handleUpdate_(p) {
  const sheet = getSheet_();
  const data = sheet.getDataRange().getValues();
  const updateIdCol = HEADERS.indexOf("UpdateId");
  const statusCol = HEADERS.indexOf("Status");
  const idCol = HEADERS.indexOf("MigrationId");
  const refCol = HEADERS.indexOf("Reference");

  for (let r = 1; r < data.length; r++) {
    if (String(data[r][updateIdCol]) === String(p.updateId)) {
      if (data[r][statusCol] === "Locked") return { ok: false, error: "locked" };

      // Duplicate check against OTHER rows only.
      for (let k = 1; k < data.length; k++) {
        if (k !== r && String(data[k][idCol]).trim() === String(p.migrationId).trim()) {
          return { ok: false, error: "duplicate" };
        }
      }

      const newRow = rowFromPayload_(p, data[r][refCol], p.updateId, data[r][statusCol], data[r][HEADERS.indexOf("CreatedAt")]);
      sheet.getRange(r + 1, 1, 1, HEADERS.length).setValues([newRow]);
      return { ok: true };
    }
  }
  return { ok: false, error: "not_found" };
}

// ---------------------------------------------------------------------
// GET FOR UPDATE (player loading their own record via the private link)
// ---------------------------------------------------------------------
function handleGetForUpdate_(p) {
  const sheet = getSheet_();
  const data = sheet.getDataRange().getValues();
  const updateIdCol = HEADERS.indexOf("UpdateId");
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][updateIdCol]) === String(p.updateId)) {
      return { ok: true, status: data[r][HEADERS.indexOf("Status")], record: rowToRecord_(data[r]) };
    }
  }
  return { ok: false, error: "not_found" };
}

function rowToRecord_(row) {
  const g = (name) => row[HEADERS.indexOf(name)];
  return {
    sourceServer: String(g("SourceServer")),
    allianceName: g("AllianceName"),
    playerName: g("PlayerName"),
    migrationId: g("MigrationId"),
    migrationScore: String(g("MigrationScore")),
    migrationType: g("MigrationType"),
    groupSize: g("GroupSize"),
    targetAlliance: g("TargetAlliance"),
    apc: [
      { faction: g("Apc1Faction"), power: String(g("Apc1Power")), unit: "M" },
      { faction: g("Apc2Faction"), power: String(g("Apc2Power")), unit: "M" },
      { faction: g("Apc3Faction"), power: String(g("Apc3Power")), unit: "M" },
      { faction: g("Apc4Faction"), power: String(g("Apc4Power")), unit: "M" },
    ],
    season: g("Season"),
    bgb: g("Bgb"),
  };
}

// ---------------------------------------------------------------------
// ADMIN — dual auth: admin password + a one-time code emailed to an
// allow-listed address. Step 1 (handleAdminRequestOtp_) checks the
// password and the email allow-list, then emails a 6-digit code that is
// cached (keyed by email) for 5 minutes — never sent back to the browser.
// Step 2 (handleAdminVerifyOtp_) checks the submitted code against the
// cache and, on success, issues a short-lived opaque session token.
// A per-email request counter throttles repeated code requests.
// ---------------------------------------------------------------------
function handleAdminRequestOtp_(p) {
  const props = PropertiesService.getScriptProperties();
  const adminPassword = props.getProperty("ADMIN_PASSWORD");
  const allowedEmails = (props.getProperty("ADMIN_EMAILS") || "")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

  if (!p.password || p.password !== adminPassword) {
    return { ok: false, error: "invalid_password" };
  }

  const email = String(p.email || "").trim().toLowerCase();
  if (!email || allowedEmails.indexOf(email) === -1) {
    return { ok: false, error: "not_authorized" };
  }

  const cache = CacheService.getScriptCache();

  // Basic throttle: max 5 code requests per email per 10 minutes.
  const throttleKey = "otp_count_" + email;
  const count = Number(cache.get(throttleKey) || 0);
  if (count >= 5) {
    return { ok: false, error: "rate_limited" };
  }
  cache.put(throttleKey, String(count + 1), 600);

  const code = String(Math.floor(100000 + Math.random() * 900000));
  cache.put("otp_" + email, code, 300); // 5 minutes

  MailApp.sendEmail({
    to: email,
    subject: "Your Server 288 admin sign-in code",
    body:
      "Your one-time code is: " + code + "\n\n" +
      "It expires in 5 minutes. If you did not request this, you can ignore this email.",
  });

  return { ok: true };
}

function handleAdminVerifyOtp_(p) {
  const email = String(p.email || "").trim().toLowerCase();
  const cache = CacheService.getScriptCache();
  const cached = cache.get("otp_" + email);

  if (!cached) {
    return { ok: false, error: "expired" };
  }
  if (String(p.code || "").trim() !== cached) {
    return { ok: false, error: "invalid_code" };
  }

  cache.remove("otp_" + email);
  const token = Utilities.getUuid();
  cache.put("admin_session_" + token, email, 21600); // 6 hour session
  return { ok: true, token: token, email: email };
}

function requireAdmin_(token) {
  const cache = CacheService.getScriptCache();
  const email = cache.get("admin_session_" + token);
  if (!email) throw new Error("not_authorized");
  return email;
}

function handleAdminList_(p) {
  requireAdmin_(p.token);
  const sheet = getSheet_();
  const data = sheet.getDataRange().getValues();
  const records = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    const rec = { reference: row[HEADERS.indexOf("Reference")], status: row[HEADERS.indexOf("Status")] };
    HEADERS.forEach((h, i) => (rec[h] = row[i]));
    records.push(rec);
  }
  return { ok: true, records: records };
}

function handleAdminSetStatus_(p) {
  requireAdmin_(p.token);
  if (["Unlocked", "Locked", "Cancelled"].indexOf(p.status) === -1) {
    return { ok: false, error: "invalid_status" };
  }
  const sheet = getSheet_();
  const data = sheet.getDataRange().getValues();
  const refCol = HEADERS.indexOf("Reference");
  const statusCol = HEADERS.indexOf("Status");
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][refCol]) === String(p.reference)) {
      sheet.getRange(r + 1, statusCol + 1).setValue(p.status);
      sheet.getRange(r + 1, HEADERS.indexOf("UpdatedAt") + 1).setValue(new Date());
      return { ok: true };
    }
  }
  return { ok: false, error: "not_found" };
}

// Simple GET so you can sanity-check the deployment URL in a browser.
function doGet(e) {
  return ContentService.createTextOutput("Server 288 Migration Registration API is running.");
}
