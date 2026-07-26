// db.js
// Data layer for the Property Tax Arrears Register.
// Uses Node's built-in node:sqlite module (no native build, no npm install needed for the DB itself).

const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const DB_PATH = path.join(__dirname, "data", "tax_register.db");

const db = new DatabaseSync(DB_PATH);

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------
// arrears is NOT stored as a trusted client value — it is always recalculated
// server-side as demand_amount - paid_amount before it is saved or returned.
// This is what Task 3 asks for: derived values must come from the record
// itself, never be typed in by hand.

db.exec(`
  CREATE TABLE IF NOT EXISTS records (
    record_id         TEXT PRIMARY KEY,
    property_id       TEXT NOT NULL,
    owner_name        TEXT NOT NULL,
    ward              INTEGER NOT NULL,
    assessed_value    REAL NOT NULL,
    demand_amount     REAL NOT NULL,
    paid_amount       REAL NOT NULL,
    arrears           REAL NOT NULL,
    last_payment_date TEXT,           -- ISO date 'YYYY-MM-DD', or NULL if never paid
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  )
`);

// ---------------------------------------------------------------------------
// Field meaning / allowed values (also echoed in README.md)
// ---------------------------------------------------------------------------
//   record_id          e.g. "PTR-0001"     — internal unique id for the row
//   property_id        e.g. "W3-00087"     — the ward register's property number
//   owner_name          free text          — name on the assessment. NOT unique
//                                             (two owners can share a name — see
//                                             duplicate-name awkward case below)
//   ward                integer 1–6         — municipal ward number
//   assessed_value      rupees, >= 0        — annual assessed value of the property
//   demand_amount       rupees, >= 0        — tax demanded for the year
//   paid_amount         rupees, >= 0        — total paid against the demand so far
//   arrears             rupees              — DERIVED = demand_amount - paid_amount,
//                                             never entered directly, floored at 0
//                                             for display purposes but stored as-is
//   last_payment_date   ISO date or NULL    — NULL means "no payment on record"

function computeDerived(rec) {
  const arrears = Math.round((rec.demand_amount - rec.paid_amount) * 100) / 100;
  let status;
  if (rec.paid_amount <= 0) status = "Unpaid";
  else if (arrears > 0) status = "Partially Paid";
  else status = "Paid";

  let arrears_age_days = null;
  if (rec.last_payment_date) {
    const days = Math.floor((Date.now() - new Date(rec.last_payment_date + "T00:00:00").getTime()) / 86400000);
    arrears_age_days = days >= 0 ? days : 0;
  }

  return { arrears, status, arrears_age_days };
}

function serialize(row) {
  const derived = computeDerived(row);
  return {
    ...row,
    arrears: derived.arrears,
    status: derived.status,
    arrears_age_days: derived.arrears_age_days,
    never_paid: row.last_payment_date === null,
  };
}

// ---------------------------------------------------------------------------
// Validation — mirrors what Task 3 asks for: reject bad data with a clear
// message before it ever reaches the table. Runs on the server regardless
// of what the browser already checked.
// ---------------------------------------------------------------------------
function validateRecord(data, { partial = false } = {}) {
  const errors = [];
  const req = (field) => !partial && (data[field] === undefined || data[field] === null || data[field] === "");

  if (req("property_id") || (data.property_id !== undefined && String(data.property_id).trim() === "")) {
    errors.push("property_id is required.");
  }
  if (req("owner_name") || (data.owner_name !== undefined && String(data.owner_name).trim() === "")) {
    errors.push("owner_name is required.");
  }
  if (data.ward !== undefined) {
    const w = Number(data.ward);
    if (!Number.isInteger(w) || w < 1 || w > 6) errors.push("ward must be a whole number between 1 and 6.");
  } else if (req("ward")) {
    errors.push("ward is required.");
  }
  for (const field of ["assessed_value", "demand_amount", "paid_amount"]) {
    if (data[field] !== undefined) {
      const v = Number(data[field]);
      if (Number.isNaN(v) || v < 0) errors.push(`${field} must be a number of 0 or more.`);
    } else if (req(field)) {
      errors.push(`${field} is required.`);
    }
  }
  if (
    data.paid_amount !== undefined &&
    data.demand_amount !== undefined &&
    Number(data.paid_amount) > Number(data.demand_amount) * 1.000001
  ) {
    errors.push("paid_amount cannot exceed demand_amount.");
  }
  if (data.last_payment_date !== undefined && data.last_payment_date !== null && data.last_payment_date !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.last_payment_date)) {
      errors.push("last_payment_date must be in YYYY-MM-DD format.");
    } else if (new Date(data.last_payment_date) > new Date()) {
      errors.push("last_payment_date cannot be in the future.");
    }
  }
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------
function listRecords({ search = "", ward = "", status = "", sort = "arrears_desc" } = {}) {
  let rows = db.prepare(`SELECT * FROM records`).all();
  rows = rows.map(serialize);

  if (ward) rows = rows.filter((r) => String(r.ward) === String(ward));

  if (status) rows = rows.filter((r) => r.status.toLowerCase() === status.toLowerCase());

  if (search) {
    const q = search.trim().toLowerCase();
    rows = rows.filter(
      (r) =>
        r.owner_name.toLowerCase().includes(q) ||
        r.property_id.toLowerCase().includes(q) ||
        r.record_id.toLowerCase().includes(q)
    );
  }

  switch (sort) {
    case "arrears_desc":
      // Defaulters ordered by amount of arrears, then age of arrears (oldest first)
      rows.sort((a, b) => b.arrears - a.arrears || (b.arrears_age_days ?? 999999) - (a.arrears_age_days ?? 999999));
      break;
    case "age_desc":
      rows.sort((a, b) => (b.arrears_age_days ?? 999999) - (a.arrears_age_days ?? 999999) || b.arrears - a.arrears);
      break;
    case "owner_asc":
      rows.sort((a, b) => a.owner_name.localeCompare(b.owner_name));
      break;
    case "ward_asc":
      rows.sort((a, b) => a.ward - b.ward || b.arrears - a.arrears);
      break;
    default:
      break;
  }

  return rows;
}

function getRecord(record_id) {
  const row = db.prepare(`SELECT * FROM records WHERE record_id = ?`).get(record_id);
  return row ? serialize(row) : null;
}

function nextRecordId() {
  const row = db.prepare(`SELECT record_id FROM records ORDER BY record_id DESC LIMIT 1`).get();
  if (!row) return "PTR-0001";
  const n = parseInt(row.record_id.split("-")[1], 10) + 1;
  return "PTR-" + String(n).padStart(4, "0");
}

function createRecord(data) {
  const now = new Date().toISOString();
  const record_id = nextRecordId();
  const demand_amount = Number(data.demand_amount);
  const paid_amount = Number(data.paid_amount);
  const arrears = Math.round((demand_amount - paid_amount) * 100) / 100;

  db.prepare(
    `INSERT INTO records
      (record_id, property_id, owner_name, ward, assessed_value, demand_amount, paid_amount, arrears, last_payment_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record_id,
    String(data.property_id).trim(),
    String(data.owner_name).trim(),
    Number(data.ward),
    Number(data.assessed_value),
    demand_amount,
    paid_amount,
    arrears,
    data.last_payment_date || null,
    now,
    now
  );

  return getRecord(record_id);
}

function updateRecord(record_id, data) {
  const existing = db.prepare(`SELECT * FROM records WHERE record_id = ?`).get(record_id);
  if (!existing) return null;

  const merged = {
    property_id: data.property_id !== undefined ? String(data.property_id).trim() : existing.property_id,
    owner_name: data.owner_name !== undefined ? String(data.owner_name).trim() : existing.owner_name,
    ward: data.ward !== undefined ? Number(data.ward) : existing.ward,
    assessed_value: data.assessed_value !== undefined ? Number(data.assessed_value) : existing.assessed_value,
    demand_amount: data.demand_amount !== undefined ? Number(data.demand_amount) : existing.demand_amount,
    paid_amount: data.paid_amount !== undefined ? Number(data.paid_amount) : existing.paid_amount,
    last_payment_date:
      data.last_payment_date !== undefined ? data.last_payment_date || null : existing.last_payment_date,
  };
  const arrears = Math.round((merged.demand_amount - merged.paid_amount) * 100) / 100;
  const now = new Date().toISOString();

  db.prepare(
    `UPDATE records SET
       property_id = ?, owner_name = ?, ward = ?, assessed_value = ?,
       demand_amount = ?, paid_amount = ?, arrears = ?, last_payment_date = ?, updated_at = ?
     WHERE record_id = ?`
  ).run(
    merged.property_id,
    merged.owner_name,
    merged.ward,
    merged.assessed_value,
    merged.demand_amount,
    merged.paid_amount,
    arrears,
    merged.last_payment_date,
    now,
    record_id
  );

  return getRecord(record_id);
}

// ---------------------------------------------------------------------------
// Seed data — ~20 realistic records across 6 wards, with three awkward
// cases planted on purpose (called out in comments) so Task 4's error /
// empty / loading states have real edge cases to prove themselves against.
// ---------------------------------------------------------------------------
function seed() {
  const count = db.prepare(`SELECT COUNT(*) AS c FROM records`).get().c;
  if (count > 0) return;

  const now = new Date().toISOString();
  const rows = [
    ["PTR-0001", "W1-00021", "Rajeshwari Nair",   1, 1850000, 18500, 18500, "2026-04-12"],
    ["PTR-0002", "W1-00034", "Suresh Kumar",      1, 2200000, 22000, 0,     "2019-01-05"],
    ["PTR-0003", "W1-00045", "Anitha Mathew",     1, 1450000, 14500, 14500, "2026-05-30"],
    ["PTR-0004", "W1-00058", "Bijoy Thomas",      1, 3100000, 31000, 15000, "2025-08-19"],
    ["PTR-0005", "W2-00012", "Suresh Kumar",      2, 1975000, 19750, 19750, "2026-03-02"],
    // Awkward case 1: missing value — never paid, last_payment_date is NULL
    ["PTR-0006", "W2-00027", "Farida Beevi",      2, 2650000, 26500, 0,     null],
    ["PTR-0007", "W2-00033", "K. Venkatesan",     2, 900000,  9000,  9000,  "2026-06-14"],
    ["PTR-0008", "W2-00041", "Priya Raghunathan", 2, 4200000, 42000, 20000, "2025-11-03"],
    // Awkward case 2: unusually old date — arrears sitting since 2012
    ["PTR-0009", "W3-00009", "Mohammed Ashraf",   3, 1650000, 16500, 4000,  "2012-06-18"],
    ["PTR-0010", "W3-00015", "Lakshmi Priya",     3, 1200000, 12000, 12000, "2026-02-11"],
    ["PTR-0011", "W3-00022", "Thomas Varghese",   3, 2750000, 27500, 0,     null],
    ["PTR-0012", "W3-00030", "Nandini Krishnan",  3, 1980000, 19800, 9800,  "2025-06-25"],
    ["PTR-0013", "W3-00044", "Abdul Kareem",      3, 3400000, 34000, 34000, "2026-07-01"],
    ["PTR-0014", "W4-00006", "Geetha Pillai",     4, 1550000, 15500, 7500,  "2025-12-14"],
    ["PTR-0015", "W4-00019", "Ramesh Chandran",   4, 2100000, 21000, 21000, "2026-05-08"],
    ["PTR-0016", "W4-00028", "Divya Sasidharan",  4, 1750000, 17500, 5000,  "2024-09-30"],
    ["PTR-0017", "W5-00011", "Joseph Kutty",      5, 2900000, 29000, 29000, "2026-06-22"],
    ["PTR-0018", "W5-00023", "Haseena Mumtaz",    5, 1350000, 13500, 0,     "2020-04-17"],
    ["PTR-0019", "W6-00004", "Vishnu Prasad",     6, 2450000, 24500, 12250, "2025-10-05"],
    ["PTR-0020", "W6-00018", "Meenakshi Iyer",    6, 3050000, 30500, 30500, "2026-07-15"],
  ];

  const insert = db.prepare(
    `INSERT INTO records
      (record_id, property_id, owner_name, ward, assessed_value, demand_amount, paid_amount, arrears, last_payment_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  for (const r of rows) {
    const [record_id, property_id, owner_name, ward, assessed_value, demand_amount, paid_amount, last_payment_date] = r;
    const arrears = Math.round((demand_amount - paid_amount) * 100) / 100;
    insert.run(record_id, property_id, owner_name, ward, assessed_value, demand_amount, paid_amount, arrears, last_payment_date, now, now);
  }
}

seed();

// Allow `node db.js --reseed` to wipe and reseed from the command line.
if (require.main === module && process.argv.includes("--reseed")) {
  db.exec("DELETE FROM records");
  seed();
  console.log("Reseeded", db.prepare(`SELECT COUNT(*) AS c FROM records`).get().c, "records.");
}

module.exports = { listRecords, getRecord, createRecord, updateRecord, validateRecord, computeDerived };
