# Property Tax Payment and Arrears Register

**SIH 2026 — Internal Practical Assessment — AIDHIH S (Reg. 411625243001), PDKVCET, AIDS, Year II**

## Problem, in two lines

Ward tax registers are paper-based, so checking whether a property has paid takes a manual page lookup, and producing a defaulters list for a ward takes days — which delays demand notices and sometimes sends them to owners who already paid. This app keeps demand and payment for every property in one place, calculates arrears automatically, and ranks a ward's defaulters by the amount and age of their arrears.

## What it is built with

- **Backend:** Node.js + Express, REST API
- **Database:** SQLite via Node's built-in `node:sqlite` module (Node ≥ 22.5) — no native compilation, no separate DB server, and no extra dependency for the DB layer itself. The file lives at `data/tax_register.db` and is created automatically on first run.
- **Frontend:** Plain HTML/CSS/JavaScript (no framework, no build step) — served as static files by the same Express server.
- No paid tools or services are used anywhere.

## How to run it

```bash
# 1. Install Node.js 22.5 or newer (node:sqlite needs this)
node --version

# 2. From the project folder, install the one dependency (Express)
npm install

# 3. Start the server
npm start
# → Property Tax Arrears Register running at http://localhost:3000

# 4. Open the app
# Visit http://localhost:3000 in a browser
```

The database is seeded automatically with ~20 sample records the first time the server runs. To wipe the data and reseed from scratch:

```bash
rm data/tax_register.db
npm run seed
```

## What every field means

| Field | Meaning | Values it may take |
|---|---|---|
| `record_id` | Internal unique ID for the row | Auto-generated, e.g. `PTR-0001` |
| `property_id` | The ward register's property number | Free text, required, e.g. `W3-00087` |
| `owner_name` | Name on the assessment | Free text, required. **Not guaranteed unique** — two different owners can share a name (see awkward cases below), so the app never uses name as a lookup key |
| `ward` | Municipal ward number | Whole number, 1–6 |
| `assessed_value` | Annual assessed value of the property (₹) | Number ≥ 0 |
| `demand_amount` | Tax demanded for the year (₹) | Number ≥ 0 |
| `paid_amount` | Total paid against the demand so far (₹) | Number ≥ 0, cannot exceed `demand_amount` |
| `arrears` | Outstanding balance (₹) | **Derived — never entered directly** |
| `last_payment_date` | Date of the most recent payment | ISO date (`YYYY-MM-DD`), or blank/`null` if the owner has never paid |

## How arrears (and the other derived values) are calculated

Nothing derived is ever typed in by a user or trusted from the browser. Every time a record is created or updated, the server recomputes, from the record's own stored fields:

- **`arrears` = `demand_amount − paid_amount`**, rounded to the nearest paisa. This is recalculated on every save, so it can never drift out of sync with the demand and payment figures.
- **`status`** — `Unpaid` if `paid_amount` is 0, `Partially Paid` if some has been paid but arrears remain, `Paid` if arrears are 0 or less.
- **`arrears_age_days`** — days between today and `last_payment_date`. If there is no payment on record (`last_payment_date` is blank), the age is shown as "No payment on record" instead of a number, and such records are still included and treated as long-overdue when ranking defaulters, rather than being dropped or crashing the sort.
- **Defaulter ordering** (the "Order defaulters by" control) — by default, records are sorted by `arrears` amount descending, with `arrears_age_days` descending as the tiebreaker, matching the brief's "amount and age of the arrears." An alternate sort leads with age instead.

You can verify this by hand: e.g. record `PTR-0004` has `demand_amount = 31000` and `paid_amount = 15000`, so `arrears = 16000` — matching what the UI and API both show.

## The three awkward cases planted in the seed data (Task 1 & 4)

1. **Missing value** — `PTR-0006` (Farida Beevi) and `PTR-0011` (Thomas Varghese) have `last_payment_date = NULL` (never paid). The UI shows "No payment on record" instead of a blank cell or a JavaScript date-parsing crash.
2. **Unusually old date** — `PTR-0009` (Mohammed Ashraf) has a `last_payment_date` of `2012-06-18`, over a decade old, to confirm the age calculation and sorting handle large values correctly.
3. **Duplicate name** — "Suresh Kumar" appears twice (`PTR-0002` in Ward 1 and `PTR-0005` in Ward 2), as two different owners. The app looks up and edits records by `record_id`/`property_id`, never by name, so this doesn't cause a mix-up.

## States handled (Task 4)

- **Loading** — a banner is shown while the register is being fetched.
- **Empty** — if a search/filter combination matches nothing, a clear message says so and suggests clearing the filters or adding a new entry (never a blank table).
- **Not found** — requesting a record that doesn't exist returns a 404 with a message; the edit form surfaces this instead of showing a blank form.
- **Save/load failure** — if the API call fails (network error, validation error, server error), the form or banner shows the specific message returned by the server, with a "Try again" action where relevant, instead of failing silently.

## What's not finished

- No authentication/login — the assessment brief describes a clerk vs. officer distinction in who *views* the register, but doesn't ask for an auth system, so both roles currently see the same read/write screen.
- No CSV/PDF export of the defaulters list — filtering and sorting cover the "show the officer the defaulters" requirement, but there's no download/print view yet.
- No pagination — fine for ~20–200 records; would need to be added before this could handle a whole city's register.

## Project structure

```
.
├── server.js          # Express app & REST routes
├── db.js              # Schema, seed data, validation, CRUD (node:sqlite)
├── package.json
├── data/               # SQLite file lives here (auto-created, gitignored)
└── public/
    ├── index.html      # Main register screen
    ├── style.css       # Styling
    └── app.js          # Fetch/render, search/filter/sort, add/edit form
```

## API reference

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/records?search=&ward=&status=&sort=` | List records, filtered/sorted |
| GET | `/api/records/:id` | Get one record |
| POST | `/api/records` | Create a record (server validates every field) |
| PUT | `/api/records/:id` | Update a record (partial updates allowed; arrears always recalculated) |
