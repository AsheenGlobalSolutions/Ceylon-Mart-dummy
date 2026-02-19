// sales-dashboard.js (ADMIN REALTIME + AUTO APPLY STOCK)

// --------------------
// Safety check
// --------------------
if (!window.db || !window.ordersCol || !window.productsCol || !firebase?.auth) {
  console.error("db/ordersCol/productsCol/auth not defined. Check firebase-shop.js");
}

// --------------------
// Globals
// --------------------
let orders = [];
let products = [];

const ITEMS_PER_PAGE = 20;
let currentPage = 1;

let unsubscribeOrders = null;
let unsubscribeProducts = null;

// Charts
let dailyChart, weeklyChart, monthlyChart, topItemsChart;

// Auto-apply guards
let __autoApplying = false;
const __autoAppliedThisSession = new Set();

// --------------------
// Realtime: Orders
// --------------------
function startRealtimeOrders() {
  const tbody = document.getElementById("ordersTableBody");
  if (unsubscribeOrders) unsubscribeOrders();

  showLoading("Listening to orders...");

  unsubscribeOrders = ordersCol
    .orderBy("createdAt", "desc")
    .limit(500)
    .onSnapshot(
      async (snap) => {
        orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

        // ✅ auto-apply stock when admin is online
        autoApplyStockForNewReservedOrders();

        renderOrders();
        updateStatsSummary();
        await generateChartsFromFirestore();

        closeLoading();
      },
      async (error) => {
        console.error("Realtime orders listener error:", error);
        closeLoading();

        if (tbody) {
          tbody.innerHTML =
            "<tr><td colspan='6' style='text-align:center;color:red;'>Realtime listener failed</td></tr>";
        }

        await Swal.fire({
          icon: "error",
          title: "Realtime failed",
          text: error.message || "Could not listen to orders changes",
          confirmButtonText: "OK",
        });
      }
    );
}

// --------------------
// Realtime: Products (optional)
// --------------------
function startRealtimeProducts() {
  if (unsubscribeProducts) unsubscribeProducts();

  unsubscribeProducts = productsCol.onSnapshot(
    (snap) => {
      products = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    (error) => console.error("Realtime products listener error:", error)
  );
}

// --------------------
// Auto apply stock for Reserved orders
// --------------------
async function autoApplyStockForNewReservedOrders() {
  if (__autoApplying) return;
  __autoApplying = true;

  try {
    const targets = orders
      .filter(
        (o) =>
          (o.status === "Reserved" || o.status === "Pending") &&
          o.stockApplied !== true &&
          o.status !== "Cancelled" &&
          o.status !== "Paid"
      )
      .sort((a, b) => {
        const da = a.createdAt?.toDate ? a.createdAt.toDate() : new Date(0);
        const db = b.createdAt?.toDate ? b.createdAt.toDate() : new Date(0);
        return da - db;
      });

    for (const o of targets) {
      if (__autoAppliedThisSession.has(o.id)) continue;
      __autoAppliedThisSession.add(o.id);

      try {
        await applyStockOnce(o.id, true); // silent
      } catch (e) {
        console.error("Auto apply stock failed:", o.id, e);
      }
    }
  } finally {
    __autoApplying = false;
  }
}

// --------------------
// Table Rendering + Pagination
// --------------------
function renderOrders() {
  const tbody = document.getElementById("ordersTableBody");
  const paginationContainer = document.getElementById("orderPagination");
  if (!tbody || !paginationContainer) return;

  tbody.innerHTML = "";

  if (orders.length === 0) {
    tbody.innerHTML =
      "<tr><td colspan='6' style='text-align:center;'>No orders found.</td></tr>";
    paginationContainer.innerHTML = "";
    updateStatsSummary();
    return;
  }

  const totalItems = orders.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

  if (currentPage > totalPages) currentPage = totalPages || 1;
  if (currentPage < 1) currentPage = 1;

  const start = (currentPage - 1) * ITEMS_PER_PAGE;
  const end = start + ITEMS_PER_PAGE;
  const displayed = orders.slice(start, end);

  displayed.forEach((order) => {
    const status = order.status || "Pending";
    const statusColor =
      status === "Paid" ? "green" : status === "Cancelled" ? "#999" : "orange";

    const customerName = order.customer?.name || "Unknown";
    const itemsText =
      (order.items || [])
        .slice(0, 3)
        .map((i) => `${i.name} (${i.qty})`)
        .join(", ") + ((order.items || []).length > 3 ? "..." : "");

    const total = Number(order.total ?? 0);

    let actionBtn = "-";

    if (status === "Paid") {
      actionBtn = '<span style="color: green; font-weight: bold;">✓ Paid</span>';
    } else if (status === "Cancelled") {
      actionBtn = '<span style="color: #999; font-weight: bold;">✕ Cancelled</span>';
    } else if (status === "Reserved" || status === "Pending") {
      if (order.stockApplied === true) {
        actionBtn = `
          <div style="display:flex; flex-direction:column; gap:8px;">
          <button class="btn btn-sm" onclick="markAsPaid('${order.id}')">Mark Paid</button>
          <button class="btn btn-sm" style="margin-left:6px;background:#999;" onclick="cancelAndRestore('${order.id}')">Cancel</button>
          </div>
        `;
      } else {
        // auto applies, but keep button as fallback
        actionBtn = `
          <div style="display:flex; flex-direction:column; gap:8px;">
          <button class="btn btn-sm" onclick="applyStockOnce('${order.id}')">Apply Stock</button>
          <button class="btn btn-sm" style="margin-left:6px;background:#999;" onclick="cancelAndRestore('${order.id}')">Cancel</button>
          </div>
        `;
      }
    }

    tbody.innerHTML += `
      <tr>
        <td>#${order.readableId || order.id}</td>
        <td>${escapeHtml(customerName)}</td>
        <td>${escapeHtml(itemsText)}</td>
        <td>C$ ${Math.round(total)}</td>
        <td><span style="color:${statusColor}; font-weight:bold;">${status}</span></td>
        <td>${actionBtn}</td>
      </tr>
    `;
  });

  let paginationHTML = "";
  if (totalPages > 1) {
    paginationHTML += `<button class="page-btn" onclick="changeOrderPage(${currentPage - 1})" ${
      currentPage === 1 ? "disabled" : ""
    }>Prev</button>`;

    for (let i = 1; i <= totalPages; i++) {
      paginationHTML += `<button class="page-btn ${
        i === currentPage ? "active" : ""
      }" onclick="changeOrderPage(${i})">${i}</button>`;
    }

    paginationHTML += `<button class="page-btn" onclick="changeOrderPage(${currentPage + 1})" ${
      currentPage === totalPages ? "disabled" : ""
    }>Next</button>`;
  }
  paginationContainer.innerHTML = paginationHTML;
}

function changeOrderPage(page) {
  const totalPages = Math.ceil(orders.length / ITEMS_PER_PAGE);
  if (page < 1 || page > totalPages) return;
  currentPage = page;
  renderOrders();
}

// --------------------
// Apply Stock ONCE (transaction)
// --------------------
async function applyStockOnce(orderId, silent = false) {
  try {
    if (!silent) showLoading("Applying stock...");

    const orderRef = ordersCol.doc(orderId);

    await db.runTransaction(async (tx) => {
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) throw new Error("Order not found");

      const order = orderSnap.data();

      if (order.stockApplied === true) return;

      const status = order.status || "Reserved";
      if (status !== "Reserved" && status !== "Pending") {
        throw new Error(`Cannot apply stock. Status: ${status}`);
      }

      const items = Array.isArray(order.items) ? order.items : [];
      if (items.length === 0) throw new Error("No items");

      const needByProductId = new Map();
      for (const it of items) {
        const pid = it.productId;
        const qty = Number(it.qty ?? 0);
        if (!pid || !Number.isFinite(qty) || qty <= 0) continue;
        needByProductId.set(pid, (needByProductId.get(pid) || 0) + qty);
      }
      if (needByProductId.size === 0) throw new Error("Invalid items");

      const productRefs = [...needByProductId.keys()].map((id) =>
        productsCol.doc(id)
      );

      const snaps = [];
      for (const ref of productRefs) snaps.push(await tx.get(ref));

      for (let i = 0; i < productRefs.length; i++) {
        const ref = productRefs[i];
        const snap = snaps[i];
        if (!snap.exists) throw new Error(`Product not found: ${ref.id}`);

        const currentQty = Number(snap.data().qty ?? 0);
        const needQty = needByProductId.get(ref.id);

        if (currentQty < needQty) {
          throw new Error(
            `Not enough stock for ${snap.data().name || ref.id}`
          );
        }

        tx.update(ref, { qty: currentQty - needQty });
      }

      tx.update(orderRef, {
        stockApplied: true,
        stockAppliedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });

    if (!silent) {
      closeLoading();
      toastSuccess("Stock applied ✅");
    }
  } catch (e) {
    console.error(e);
    if (!silent) {
      closeLoading();
      Swal.fire({
        icon: "error",
        title: "Apply stock failed",
        text: e.message || "Failed",
      });
    }
    throw e;
  }
}

// --------------------
// Mark as Paid (NO stock changes)
// --------------------
async function markAsPaid(orderId) {
  try {
    const res = await Swal.fire({
      title: "Mark as Paid?",
      text: "This will mark the order as Paid (no stock changes).",
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Yes",
    });
    if (!res.isConfirmed) return;

    showLoading("Marking paid...");

    const orderRef = ordersCol.doc(orderId);

    await db.runTransaction(async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists) throw new Error("Order not found");

      const order = snap.data();
      if (order.status === "Paid") return;

      if (order.stockApplied !== true) {
        throw new Error("Stock not applied yet.");
      }

      tx.update(orderRef, {
        status: "Paid",
        paidAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });

    closeLoading();
    toastSuccess("Marked Paid ✅");
  } catch (e) {
    console.error(e);
    closeLoading();
    Swal.fire({ icon: "error", title: "Failed", text: e.message || "Failed" });
  }
}

// --------------------
// Cancel & Restore (restore only if applied)
// --------------------
async function cancelAndRestore(orderId) {
  try {
    const res = await Swal.fire({
      title: "Cancel this order?",
      text: "If stock was applied, it will be restored.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Yes, cancel",
    });
    if (!res.isConfirmed) return;

    showLoading("Cancelling...");

    const orderRef = ordersCol.doc(orderId);

    await db.runTransaction(async (tx) => {
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) throw new Error("Order not found");

      const order = orderSnap.data();

      if (order.status === "Paid") throw new Error("Paid order cannot be cancelled.");
      if (order.status === "Cancelled") return;

      // If stock never applied -> just cancel + mark restored true
      if (order.stockApplied !== true) {
        tx.update(orderRef, {
          status: "Cancelled",
          stockRestored: true,
          stockRestoredAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
        return;
      }

      // Already restored -> ensure cancelled
      if (order.stockRestored === true) {
        tx.update(orderRef, { status: "Cancelled" });
        return;
      }

      const items = Array.isArray(order.items) ? order.items : [];
      const addByProductId = new Map();

      for (const it of items) {
        const pid = it.productId;
        const qty = Number(it.qty ?? 0);
        if (!pid || !Number.isFinite(qty) || qty <= 0) continue;
        addByProductId.set(pid, (addByProductId.get(pid) || 0) + qty);
      }

      const productRefs = [...addByProductId.keys()].map((id) =>
        productsCol.doc(id)
      );

      const snaps = [];
      for (const ref of productRefs) snaps.push(await tx.get(ref));

      for (let i = 0; i < productRefs.length; i++) {
        const ref = productRefs[i];
        const snap = snaps[i];
        if (!snap.exists) continue;

        const currentQty = Number(snap.data().qty ?? 0);
        const addQty = addByProductId.get(ref.id);
        tx.update(ref, { qty: currentQty + addQty });
      }

      tx.update(orderRef, {
        status: "Cancelled",
        stockRestored: true,
        stockRestoredAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    });

    closeLoading();
    toastSuccess("Cancelled ✅");
  } catch (e) {
    console.error(e);
    closeLoading();
    Swal.fire({ icon: "error", title: "Cancel failed", text: e.message || "Failed" });
  }
}

// --------------------
// Stats summary
// --------------------
function updateStatsSummary() {
  const paidOrders = orders.filter((o) => (o.status || "Pending") === "Paid");

  const revenue = paidOrders.reduce((sum, o) => sum + Number(o.total ?? 0), 0);
  const totalOrders = orders.length;
  const productsSold = paidOrders.reduce((sum, o) => {
    const items = o.items || [];
    return sum + items.reduce((s, it) => s + Number(it.qty ?? 0), 0);
  }, 0);

  const revEl = document.getElementById("statRevenue");
  const ordEl = document.getElementById("statOrders");
  const soldEl = document.getElementById("statProductsSold");

  if (revEl) revEl.innerText = `C$ ${Math.round(revenue)}`;
  if (ordEl) ordEl.innerText = `${totalOrders}`;
  if (soldEl) soldEl.innerText = `${productsSold}`;
}

// --------------------
// Charts
// --------------------
async function generateChartsFromFirestore() {
  const paid = orders.filter((o) => (o.status || "Pending") === "Paid");

  const dailyCanvas = document.getElementById("dailySalesChart");
  const weeklyCanvas = document.getElementById("weeklySalesChart");
  const monthlyCanvas = document.getElementById("monthlySalesChart");
  const topCanvas = document.getElementById("topItemsChart");
  if (!dailyCanvas || !weeklyCanvas || !monthlyCanvas || !topCanvas) return;

  const toDate = (ts) => (ts?.toDate ? ts.toDate() : null);

  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const dailyRevenue = [0, 0, 0, 0, 0, 0, 0];

  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(now.getDate() - 6);

  paid.forEach((o) => {
    const d = toDate(o.paidAt) || toDate(o.createdAt);
    if (!d || d < sevenDaysAgo) return;
    const idx = (d.getDay() + 6) % 7;
    dailyRevenue[idx] += Number(o.total ?? 0);
  });

  const weeklyLabels = ["Week 1", "Week 2", "Week 3", "Week 4"];
  const weeklyRevenue = [0, 0, 0, 0];
  const fourWeeksAgo = new Date(now);
  fourWeeksAgo.setDate(now.getDate() - 27);

  paid.forEach((o) => {
    const d = toDate(o.paidAt) || toDate(o.createdAt);
    if (!d || d < fourWeeksAgo) return;
    const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    const bucket = Math.min(3, Math.floor(diffDays / 7));
    const idx = 3 - bucket;
    weeklyRevenue[idx] += Number(o.total ?? 0);
  });

  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthlyRevenueMap = new Map();
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(now.getMonth() - 5);

  paid.forEach((o) => {
    const d = toDate(o.paidAt) || toDate(o.createdAt);
    if (!d || d < sixMonthsAgo) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthlyRevenueMap.set(key, (monthlyRevenueMap.get(key) || 0) + Number(o.total ?? 0));
  });

  const monthlyLabels = [];
  const monthlyRevenue = [];
  for (let i = 5; i >= 0; i--) {
    const dt = new Date(now);
    dt.setMonth(now.getMonth() - i);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    monthlyLabels.push(monthNames[dt.getMonth()]);
    monthlyRevenue.push(monthlyRevenueMap.get(key) || 0);
  }

  const itemQty = new Map();
  paid.forEach((o) => {
    (o.items || []).forEach((it) => {
      const name = it.name || "Unknown";
      const qty = Number(it.qty ?? 0);
      itemQty.set(name, (itemQty.get(name) || 0) + qty);
    });
  });

  const top = [...itemQty.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const topLabels = top.map((x) => x[0]);
  const topData = top.map((x) => x[1]);

  if (dailyChart) dailyChart.destroy();
  if (weeklyChart) weeklyChart.destroy();
  if (monthlyChart) monthlyChart.destroy();
  if (topItemsChart) topItemsChart.destroy();

  dailyChart = new Chart(dailyCanvas, {
    type: "bar",
    data: { labels: days, datasets: [{ label: "Revenue (CAD)", data: dailyRevenue }] },
  });

  weeklyChart = new Chart(weeklyCanvas, {
    type: "line",
    data: { labels: weeklyLabels, datasets: [{ label: "Revenue (CAD)", data: weeklyRevenue, tension: 0.1 }] },
  });

  monthlyChart = new Chart(monthlyCanvas, {
    type: "bar",
    data: { labels: monthlyLabels, datasets: [{ label: "Revenue (CAD)", data: monthlyRevenue }] },
  });

  topItemsChart = new Chart(topCanvas, {
    type: "doughnut",
    data: { labels: topLabels, datasets: [{ data: topData }] },
  });
}

// --------------------
// Helpers
// --------------------
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (s) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[s]));
}

// --------------------
// Auth Gate + Start Realtime
// --------------------
firebase.auth().onAuthStateChanged(async (user) => {
  if (!user) {
    await Swal.fire({
      icon: "info",
      title: "Login required",
      text: "Please login to access the Sales Dashboard.",
      confirmButtonText: "Go to Login",
    });
    window.location.href = "admin.html";
    return;
  }

  toastSuccess("Welcome back!");
  startRealtimeProducts();
  startRealtimeOrders();
  startAutoCancelTimer();  
});

// --------------------
// SweetAlert helpers
// --------------------
const Toast = Swal.mixin({
  toast: true,
  position: "top-end",
  showConfirmButton: false,
  timer: 2500,
  timerProgressBar: true,
  didOpen: (toast) => {
    toast.addEventListener("mouseenter", Swal.stopTimer);
    toast.addEventListener("mouseleave", Swal.resumeTimer);
  },
});

function toastSuccess(msg) { Toast.fire({ icon: "success", title: msg }); }
function toastError(msg) { Toast.fire({ icon: "error", title: msg }); }
function toastInfo(msg) { Toast.fire({ icon: "info", title: msg }); }

function showLoading(title = "Loading...") {
  Swal.fire({
    title,
    allowOutsideClick: false,
    allowEscapeKey: false,
    didOpen: () => Swal.showLoading(),
  });
}
function closeLoading() { Swal.close(); }

// Burger menu
document.addEventListener("DOMContentLoaded", () => {
  const burger = document.querySelector(".burger");
  const nav = document.querySelector(".nav-links");
  if (burger && nav) {
    burger.addEventListener("click", () => {
      nav.classList.toggle("nav-active");
      burger.classList.toggle("toggle");
    });
  }
});

// Cleanup
window.addEventListener("beforeunload", () => {
  if (unsubscribeOrders) unsubscribeOrders();
  if (unsubscribeProducts) unsubscribeProducts();
});

function startAutoCancelTimer() {
  // run every 1 minute
  setInterval(() => {
    checkAndAutoCancelExpiredOrders().catch(console.error);
  }, 60 * 1000);
}

async function checkAndAutoCancelExpiredOrders() {
  const now = Date.now();
  const cutoffMs = 24 * 60 * 60 * 1000; // 24 hours

  for (const o of orders) {
    if (!o) continue;

    const status = o.status || "Reserved";

    // only Reserved orders
    if (status !== "Reserved") continue;
    if (o.autoCancelled === true) continue;

    const reservedAt = o.reservedAt?.toDate
      ? o.reservedAt.toDate().getTime()
      : null;

    if (!reservedAt) continue;

    if (now - reservedAt > cutoffMs) {
      console.log("Auto cancelling order:", o.id);
      await autoCancelAndRestoreSilently(o.id);
    }
  }
}