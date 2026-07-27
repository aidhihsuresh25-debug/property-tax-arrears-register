// app.js — Property Tax Arrears Register (frontend)

const els = {
  search: document.getElementById("search"),
  wardFilter: document.getElementById("wardFilter"),
  statusFilter: document.getElementById("statusFilter"),
  sortBy: document.getElementById("sortBy"),
  resultCount: document.getElementById("resultCount"),
  stateBanner: document.getElementById("stateBanner"),
  tableWrap: document.querySelector(".table-wrap"),
  registerBody: document.getElementById("registerBody"),
  cardList: document.getElementById("cardList"),
  btnAdd: document.getElementById("btnAdd"),
  overlay: document.getElementById("formOverlay"),
  form: document.getElementById("recordForm"),
  formTitle: document.getElementById("formTitle"),
  formError: document.getElementById("formError"),
  btnCloseForm: document.getElementById("btnCloseForm"),
  btnCancelForm: document.getElementById("btnCancelForm"),
  btnSaveForm: document.getElementById("btnSaveForm"),
  toast: document.getElementById("toast"),
  arrearsPreview: document.getElementById("f_arrears_preview"),
};

let debounceTimer = null;

// --------------------------- money / date formatting ---------------------------
const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
function money(n) { return "₹" + inr.format(Math.round(n)); }
function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function stampClass(status) {
  if (status === "Paid") return "stamp stamp--paid";
  if (status === "Partially Paid") return "stamp stamp--partial";
  return "stamp stamp--unpaid";
}
function stampLabel(status) {
  if (status === "Paid") return "Paid";
  if (status === "Partially Paid") return "Partial";
  return "Unpaid";
}

// ------------------------------- state banner -------------------------------
function showBanner(kind, title, detail, showRetry) {
  const b = els.stateBanner;
  b.hidden = false;
  b.className = "state-banner" + (kind === "error" ? " state-banner--error" : "");
  b.innerHTML = `<strong>${title}</strong><span>${detail}</span>`;
  if (showRetry) {
    const btn = document.createElement("button");
    btn.className = "btn btn--ghost";
    btn.textContent = "Try again";
    btn.addEventListener("click", loadRecords);
    b.appendChild(btn);
  }
  els.tableWrap.hidden = true;
  els.cardList.hidden = true;
}
function hideBanner() {
  els.stateBanner.hidden = true;
  els.tableWrap.hidden = false;
  els.cardList.hidden = false;
}

// ---------------------------------- toast ----------------------------------
let toastTimer = null;
function showToast(message, isError) {
  const t = els.toast;
  t.textContent = message;
  t.className = "toast" + (isError ? " toast--error" : "");
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

// --------------------------------- rendering ---------------------------------
function renderRows(records) {
  els.registerBody.innerHTML = "";
  els.cardList.innerHTML = "";

  for (const r of records) {
    const arrearsClass = r.arrears > 0 ? "figure arrears-due" : "figure arrears-zero";

    // Desktop table row
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="${stampClass(r.status)}">${stampLabel(r.status)}</span></td>
      <td class="owner">${escapeHtml(r.owner_name)}</td>
      <td>${escapeHtml(r.property_id)}</td>
      <td>Ward ${r.ward}</td>
      <td class="num figure">${money(r.demand_amount)}</td>
      <td class="num figure">${money(r.paid_amount)}</td>
      <td class="num ${arrearsClass}">${money(r.arrears)}</td>
      <td>${r.never_paid ? '<span class="muted">No payment on record</span>' : formatDate(r.last_payment_date) + (r.arrears_age_days !== null ? ` <span class="muted">(${r.arrears_age_days}d ago)</span>` : "")}</td>
      <td><div class="row-actions"><button class="btn btn--ghost btn--small" data-edit="${r.record_id}">Edit</button></div></td>
    `;
    els.registerBody.appendChild(tr);

    // Mobile card
    const card = document.createElement("article");
    card.className = "record-card";
    card.innerHTML = `
      <div class="record-card__top">
        <div>
          <div class="record-card__owner">${escapeHtml(r.owner_name)}</div>
          <div class="record-card__meta">${escapeHtml(r.property_id)} · Ward ${r.ward} · ${r.record_id}</div>
        </div>
        <span class="${stampClass(r.status)}">${stampLabel(r.status)}</span>
      </div>
      <dl class="record-card__grid">
        <div><dt>Demand</dt><dd>${money(r.demand_amount)}</dd></div>
        <div><dt>Paid</dt><dd>${money(r.paid_amount)}</dd></div>
        <div><dt>Arrears</dt><dd class="${arrearsClass}">${money(r.arrears)}</dd></div>
        <div><dt>Last payment</dt><dd>${r.never_paid ? "None on record" : formatDate(r.last_payment_date)}</dd></div>
      </dl>
      <button class="btn btn--ghost btn--small" data-edit="${r.record_id}">Edit</button>
    `;
    els.cardList.appendChild(card);
  }

  document.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openForm(btn.getAttribute("data-edit")));
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------------------------------- data load ----------------------------------
async function loadRecords() {
  hideBanner();
  els.tableWrap.hidden = true;
  els.cardList.hidden = true;
  showBanner("loading", "Loading records…", "Fetching the latest register data.", false);

  const params = new URLSearchParams();
  if (els.search.value.trim()) params.set("search", els.search.value.trim());
  if (els.wardFilter.value) params.set("ward", els.wardFilter.value);
  if (els.statusFilter.value) params.set("status", els.statusFilter.value);
  if (els.sortBy.value) params.set("sort", els.sortBy.value);

  try {
    const res = await fetch(`/api/records?${params.toString()}`);
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(body && body.error ? body.error : `Server returned ${res.status}.`);
    }
    const records = body.data || [];
    els.resultCount.textContent = `${records.length} record${records.length === 1 ? "" : "s"} shown`;

    if (records.length === 0) {
      showBanner(
        "empty",
        "No records match this search",
        "Try clearing the search box or filters, or add a new entry.",
        false
      );
      return;
    }
    hideBanner();
    renderRows(records);
  } catch (err) {
    showBanner("error", "Could not load the register", err.message || "Something went wrong while fetching records.", true);
  }
}

function debouncedLoad() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(loadRecords, 300);
}

els.search.addEventListener("input", debouncedLoad);
els.wardFilter.addEventListener("change", loadRecords);
els.statusFilter.addEventListener("change", loadRecords);
els.sortBy.addEventListener("change", loadRecords);

// ------------------------------------ form ------------------------------------
function updateArrearsPreview() {
  const demand = parseFloat(document.getElementById("f_demand_amount").value) || 0;
  const paid = parseFloat(document.getElementById("f_paid_amount").value) || 0;
  const arrears = demand - paid;
  els.arrearsPreview.textContent = money(arrears);
}
document.getElementById("f_demand_amount").addEventListener("input", updateArrearsPreview);
document.getElementById("f_paid_amount").addEventListener("input", updateArrearsPreview);

function openForm(recordId) {
  els.form.reset();
  els.formError.hidden = true;
  document.getElementById("f_record_id").value = "";
  updateArrearsPreview();

  if (recordId) {
    els.formTitle.textContent = "Edit Entry — " + recordId;
    els.btnSaveForm.textContent = "Save changes";
    fetch(`/api/records/${encodeURIComponent(recordId)}`)
      .then((res) => res.json())
      .then((body) => {
        if (!body.data) throw new Error(body.error || "Record not found.");
        const r = body.data;
        document.getElementById("f_record_id").value = r.record_id;
        document.getElementById("f_property_id").value = r.property_id;
        document.getElementById("f_owner_name").value = r.owner_name;
        document.getElementById("f_ward").value = r.ward;
        document.getElementById("f_assessed_value").value = r.assessed_value;
        document.getElementById("f_demand_amount").value = r.demand_amount;
        document.getElementById("f_paid_amount").value = r.paid_amount;
        document.getElementById("f_last_payment_date").value = r.last_payment_date || "";
        updateArrearsPreview();
      })
      .catch((err) => showToast(err.message, true));
  } else {
    els.formTitle.textContent = "New Entry";
    els.btnSaveForm.textContent = "Save entry";
  }

  els.overlay.hidden = false;
}
function closeForm() { els.overlay.hidden = true; }

els.btnAdd.addEventListener("click", () => openForm(null));
els.btnCloseForm.addEventListener("click", closeForm);
els.btnCancelForm.addEventListener("click", closeForm);
els.overlay.addEventListener("click", (e) => { if (e.target === els.overlay) closeForm(); });

els.form.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.formError.hidden = true;

  const recordId = document.getElementById("f_record_id").value;
  const payload = {
    property_id: document.getElementById("f_property_id").value.trim(),
    owner_name: document.getElementById("f_owner_name").value.trim(),
    ward: Number(document.getElementById("f_ward").value),
    assessed_value: Number(document.getElementById("f_assessed_value").value),
    demand_amount: Number(document.getElementById("f_demand_amount").value),
    paid_amount: Number(document.getElementById("f_paid_amount").value),
    last_payment_date: document.getElementById("f_last_payment_date").value || null,
  };

  // Basic client-side check so the person doesn't wait on a round trip for the obvious case.
  if (payload.paid_amount > payload.demand_amount) {
    els.formError.textContent = "Paid amount cannot exceed demand amount.";
    els.formError.hidden = false;
    return;
  }

  els.btnSaveForm.disabled = true;
  els.btnSaveForm.textContent = "Saving…";

  try {
    const url = recordId ? `/api/records/${encodeURIComponent(recordId)}` : "/api/records";
    const method = recordId ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(body && body.error ? body.error : "The server rejected this entry.");

    closeForm();
    showToast(recordId ? `Entry ${recordId} updated.` : `Entry ${body.data.record_id} created.`, false);
    loadRecords();
  } catch (err) {
    els.formError.textContent = err.message;
    els.formError.hidden = false;
  } finally {
    els.btnSaveForm.disabled = false;
    els.btnSaveForm.textContent = recordId ? "Save changes" : "Save entry";
  }
});

// ------------------------------------ init ------------------------------------
loadRecords();
