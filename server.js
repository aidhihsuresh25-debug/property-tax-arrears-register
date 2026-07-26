// server.js
// Express API for the Property Tax Payment and Arrears Register.

const express = require("express");
const path = require("path");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Small helper so every route follows the same error shape.
function sendError(res, code, message) {
  res.status(code).json({ error: message });
}

// GET /api/records?search=&ward=&status=&sort=
app.get("/api/records", (req, res) => {
  try {
    const { search, ward, status, sort } = req.query;
    const rows = db.listRecords({ search, ward, status, sort });
    res.json({ data: rows, count: rows.length });
  } catch (err) {
    console.error(err);
    sendError(res, 500, "Could not load records. Please try again.");
  }
});

// GET /api/records/:id
app.get("/api/records/:id", (req, res) => {
  try {
    const row = db.getRecord(req.params.id);
    if (!row) return sendError(res, 404, `No record found with id ${req.params.id}.`);
    res.json({ data: row });
  } catch (err) {
    console.error(err);
    sendError(res, 500, "Could not load this record. Please try again.");
  }
});

// POST /api/records  — create
app.post("/api/records", (req, res) => {
  try {
    const { valid, errors } = db.validateRecord(req.body, { partial: false });
    if (!valid) return sendError(res, 400, errors.join(" "));
    const created = db.createRecord(req.body);
    res.status(201).json({ data: created });
  } catch (err) {
    console.error(err);
    sendError(res, 500, "Could not save this record. Please try again.");
  }
});

// PUT /api/records/:id — update
app.put("/api/records/:id", (req, res) => {
  try {
    const { valid, errors } = db.validateRecord(req.body, { partial: true });
    if (!valid) return sendError(res, 400, errors.join(" "));
    const updated = db.updateRecord(req.params.id, req.body);
    if (!updated) return sendError(res, 404, `No record found with id ${req.params.id}.`);
    res.json({ data: updated });
  } catch (err) {
    console.error(err);
    sendError(res, 500, "Could not update this record. Please try again.");
  }
});

// Fallback for unknown API routes
app.use("/api", (req, res) => sendError(res, 404, "Unknown API route."));

app.listen(PORT, () => {
  console.log(`Property Tax Arrears Register running at http://localhost:${PORT}`);
});
