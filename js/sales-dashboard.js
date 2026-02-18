// sales-dashboard.js

if (!window.ordersCol || !window.productsCol) {
  console.error("ordersCol/productsCol not defined. Check firebase-shop.js");
}

let orders = [];
const ITEMS_PER_PAGE = 20;
let currentPage = 1;

// --------------------
// Load Orders (recent first)
// --------------------
async function loadOrders() {
  const tbody = document.getElementById("ordersTableBody");

  try {
    showLoading("Loading orders...");

    const snap = await ordersCol.orderBy("createdAt", "desc").limit(500).get();
    orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    renderOrders();
    await generateChartsFromFirestore();

    closeLoading();
    toastSuccess("Orders loaded");

  } catch (e) {
    console.error(e);
    closeLoading();

    if (tbody) {
      tbody.innerHTML =
        "<tr><td colspan='6' style='text-align:center;color:red;'>Failed to load orders</td></tr>";
    }

    await Swal.fire({
      icon: "error",
      title: "Failed to load orders",
      text: e.message || "Something went wrong",
      confirmButtonText: "OK"
    });
  }
}


// --------------------
// Table Rendering + Pagination
// --------------------
function renderOrders() {
  const tbody = document.getElementById("ordersTableBody");
  const paginationContainer = document.getElementById("orderPagination");
  tbody.innerHTML = "";

  if (orders.length === 0) {
    tbody.innerHTML = "<tr><td colspan='6' style='text-align:center;'>No orders found.</td></tr>";
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

  displayed.forEach(order => {
    const status = order.status || "Pending";
    const statusColor = status === "Paid" ? "green" : "orange";

    const customerName = order.customer?.name || "Unknown";
    const itemsText = (order.items || [])
      .slice(0, 3)
      .map(i => `${i.name} (${i.qty})`)
      .join(", ") + ((order.items || []).length > 3 ? "..." : "");

    const total = Number(order.total ?? 0);

    const actionBtn = status === "Pending"
      ? `<button class="btn btn-sm" onclick="markPaymentComplete('${order.id}')">Payment Completed</button>`
      : '<span style="color: green; font-weight: bold;">✓ Completed</span>';

    const row = `
      <tr>
        <td>#${order.id}</td>
        <td>${escapeHtml(customerName)}</td>
        <td>${escapeHtml(itemsText)}</td>
        <td>C$ ${total}</td>
        <td><span style="color:${statusColor}; font-weight:bold;">${status}</span></td>
        <td>${actionBtn}</td>
      </tr>
    `;
    tbody.innerHTML += row;
  });

  // Pagination buttons
  let paginationHTML = "";
  if (totalPages > 1) {
    paginationHTML += `<button class="page-btn" onclick="changeOrderPage(${currentPage - 1})" ${currentPage === 1 ? "disabled" : ""}>Prev</button>`;
    for (let i = 1; i <= totalPages; i++) {
      paginationHTML += `<button class="page-btn ${i === currentPage ? "active" : ""}" onclick="changeOrderPage(${i})">${i}</button>`;
    }
    paginationHTML += `<button class="page-btn" onclick="changeOrderPage(${currentPage + 1})" ${currentPage === totalPages ? "disabled" : ""}>Next</button>`;
  }
  paginationContainer.innerHTML = paginationHTML;

  updateStatsSummary();
}

function changeOrderPage(page) {
  const totalPages = Math.ceil(orders.length / ITEMS_PER_PAGE);
  if (page < 1 || page > totalPages) return;
  currentPage = page;
  renderOrders();
}

// --------------------
// Mark Paid + Update stock (transaction)
// --------------------
async function markPaymentComplete(orderId) {
  try {
    const confirm = await Swal.fire({
      title: "Confirm Payment?",
      text: `Mark Order #${orderId} as Paid and update stock?`,
      icon: "question",
      showCancelButton: true,
      confirmButtonText: "Yes, Confirm",
      cancelButtonText: "Cancel",
      reverseButtons: true
    });

    if (!confirm.isConfirmed) {
      toastInfo("Cancelled");
      return;
    }

    showLoading("Processing payment...");

    const orderRef = ordersCol.doc(orderId);

    await db.runTransaction(async (tx) => {

      // ---------- PHASE 1: READS ONLY ----------
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) throw new Error("Order not found");

      const order = orderSnap.data();

      if ((order.status || "Pending") === "Paid") {
        throw new Error("This order is already marked as Paid");
      }

      const items = Array.isArray(order.items) ? order.items : [];
      if (items.length === 0) throw new Error("No items in order");

      // Merge quantities by productId
      const needByProductId = new Map();
      for (const it of items) {
        const productId = it.productId;
        const qty = Number(it.qty ?? 0);
        if (!productId || !Number.isFinite(qty) || qty <= 0) continue;
        needByProductId.set(productId, (needByProductId.get(productId) || 0) + qty);
      }

      if (needByProductId.size === 0) {
        throw new Error("Order items are invalid (missing productId/qty)");
      }

      const productRefs = [...needByProductId.keys()].map(id => productsCol.doc(id));

      const productSnaps = [];
      for (const ref of productRefs) productSnaps.push(await tx.get(ref));

      const updates = []; // { ref, newQty, name }
      const lowStockAfter = []; // { name, qty }

      for (let i = 0; i < productRefs.length; i++) {
        const ref = productRefs[i];
        const snap = productSnaps[i];

        if (!snap.exists) throw new Error(`Product not found: ${ref.id}`);

        const data = snap.data();
        const name = data.name || ref.id;

        const currentQty = Number(data.qty ?? 0);
        const needQty = needByProductId.get(ref.id);

        if (currentQty < needQty) {
          throw new Error(`Not enough stock for ${name} (have ${currentQty}, need ${needQty})`);
        }

        const newQty = currentQty - needQty;
        updates.push({ ref, newQty, name });

        if (newQty <= 5) {
          lowStockAfter.push({ name, qty: newQty });
        }
      }

      // ---------- PHASE 2: WRITES ONLY ----------
      for (const u of updates) {
        tx.update(u.ref, { qty: u.newQty });
      }

      tx.update(orderRef, {
        status: "Paid",
        paidAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      // Attach lowStockAfter to transaction scope by return pattern not possible,
      // so we'll store it on window for later display after transaction:
      window.__lowStockAfter = lowStockAfter;
    });

    closeLoading();

    // Success popup + optional low stock warning
    const lowStock = window.__lowStockAfter || [];
    window.__lowStockAfter = [];

    if (lowStock.length > 0) {
      const html = lowStock
        .map(x => `<div style="text-align:left;">• ${escapeHtml(x.name)} — <b>${x.qty}</b> left</div>`)
        .join("");

      await Swal.fire({
        icon: "warning",
        title: "Payment Confirmed ✅",
        html: `<div style="margin-bottom:8px;">Order #${orderId} marked as Paid.</div>
               <div><b>Low stock alert:</b></div>${html}`,
        confirmButtonText: "OK"
      });
    } else {
      await Swal.fire({
        icon: "success",
        title: "Payment Confirmed ✅",
        text: `Order #${orderId} marked as Paid. Stock updated.`,
        confirmButtonText: "OK"
      });
    }

    await loadOrders();

  } catch (e) {
    console.error(e);
    closeLoading();

    await Swal.fire({
      icon: "error",
      title: "Payment Failed",
      text: e.message || "Failed to mark payment complete.",
      confirmButtonText: "OK"
    });
  }
}

// --------------------
// Stats summary (top cards)
// --------------------
function updateStatsSummary() {
  // If you want, you can replace your static HTML values with ids:
  // <div class="stat-value" id="statRevenue">C$ 0</div> ...
  const paidOrders = orders.filter(o => (o.status || "Pending") === "Paid");

  const revenue = paidOrders.reduce((sum, o) => sum + Number(o.total ?? 0), 0);
  const totalOrders = orders.length;
  const productsSold = paidOrders.reduce((sum, o) => {
    const items = o.items || [];
    return sum + items.reduce((s, it) => s + Number(it.qty ?? 0), 0);
  }, 0);

  // If you add these IDs in HTML, these lines work:
  const revEl = document.getElementById("statRevenue");
  const ordEl = document.getElementById("statOrders");
  const soldEl = document.getElementById("statProductsSold");

  if (revEl) revEl.innerText = `C$ ${Math.round(revenue)}`;
  if (ordEl) ordEl.innerText = `${totalOrders}`;
  if (soldEl) soldEl.innerText = `${productsSold}`;
}

// --------------------
// Charts from Firestore data
// --------------------
let dailyChart, weeklyChart, monthlyChart, topItemsChart;

async function generateChartsFromFirestore() {
  // Use only PAID orders for revenue charts
  const paid = orders.filter(o => (o.status || "Pending") === "Paid");

  // Convert Firestore timestamp -> JS Date safely
  const toDate = (ts) => ts?.toDate ? ts.toDate() : null;

  // ---- Daily (last 7 days) ----
  const days = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
  const dailyRevenue = [0,0,0,0,0,0,0];

  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(now.getDate() - 6);

  paid.forEach(o => {
    const d = toDate(o.paidAt) || toDate(o.createdAt);
    if (!d) return;
    if (d < sevenDaysAgo) return;

    // JS getDay(): Sun=0..Sat=6 -> convert to Mon=0..Sun=6
    const idx = (d.getDay() + 6) % 7;
    dailyRevenue[idx] += Number(o.total ?? 0);
  });

  // ---- Weekly (last 4 weeks) ----
  const weeklyLabels = ["Week 1","Week 2","Week 3","Week 4"];
  const weeklyRevenue = [0,0,0,0];
  const fourWeeksAgo = new Date(now);
  fourWeeksAgo.setDate(now.getDate() - 27);

  paid.forEach(o => {
    const d = toDate(o.paidAt) || toDate(o.createdAt);
    if (!d) return;
    if (d < fourWeeksAgo) return;

    const diffDays = Math.floor((now - d) / (1000 * 60 * 60 * 24));
    const bucket = Math.min(3, Math.floor(diffDays / 7)); // 0..3
    // show from oldest->newest: Week1 oldest
    const idx = 3 - bucket;
    weeklyRevenue[idx] += Number(o.total ?? 0);
  });

  // ---- Monthly (last 6 months) ----
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthlyRevenueMap = new Map(); // "YYYY-MM" -> sum
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(now.getMonth() - 5);

  paid.forEach(o => {
    const d = toDate(o.paidAt) || toDate(o.createdAt);
    if (!d) return;
    if (d < sixMonthsAgo) return;

    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
    monthlyRevenueMap.set(key, (monthlyRevenueMap.get(key) || 0) + Number(o.total ?? 0));
  });

  const monthlyLabels = [];
  const monthlyRevenue = [];
  for (let i = 5; i >= 0; i--) {
    const dt = new Date(now);
    dt.setMonth(now.getMonth() - i);
    const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}`;
    monthlyLabels.push(monthNames[dt.getMonth()]);
    monthlyRevenue.push(monthlyRevenueMap.get(key) || 0);
  }

  // ---- Top items (by qty) ----
  const itemQty = new Map(); // name -> qty
  paid.forEach(o => {
    (o.items || []).forEach(it => {
      const name = it.name || "Unknown";
      const qty = Number(it.qty ?? 0);
      itemQty.set(name, (itemQty.get(name) || 0) + qty);
    });
  });

  const top = [...itemQty.entries()]
    .sort((a,b) => b[1] - a[1])
    .slice(0, 6);

  const topLabels = top.map(x => x[0]);
  const topData = top.map(x => x[1]);

  // Render charts (destroy old first)
  if (dailyChart) dailyChart.destroy();
  if (weeklyChart) weeklyChart.destroy();
  if (monthlyChart) monthlyChart.destroy();
  if (topItemsChart) topItemsChart.destroy();

  dailyChart = new Chart(document.getElementById('dailySalesChart'), {
    type: 'bar',
    data: { labels: days, datasets: [{ label: 'Revenue (CAD)', data: dailyRevenue }] }
  });

  weeklyChart = new Chart(document.getElementById('weeklySalesChart'), {
    type: 'line',
    data: { labels: weeklyLabels, datasets: [{ label: 'Revenue (CAD)', data: weeklyRevenue, tension: 0.1 }] }
  });

  monthlyChart = new Chart(document.getElementById('monthlySalesChart'), {
    type: 'bar',
    data: { labels: monthlyLabels, datasets: [{ label: 'Revenue (CAD)', data: monthlyRevenue }] }
  });

  topItemsChart = new Chart(document.getElementById('topItemsChart'), {
    type: 'doughnut',
    data: { labels: topLabels, datasets: [{ data: topData }] }
  });
}

// --------------------
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[s]));
}

firebase.auth().onAuthStateChanged(async (user) => {
  if (!user) {
    await Swal.fire({
      icon: "info",
      title: "Login required",
      text: "Please login to access the Sales Dashboard.",
      confirmButtonText: "Go to Login"
    });
    window.location.href = "admin.html";
    return;
  }

  toastSuccess("Welcome back!");
  loadOrders();
});

// --------------------
// SweetAlert Helpers
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
  }
});

function toastSuccess(msg) {
  Toast.fire({ icon: "success", title: msg });
}

function toastError(msg) {
  Toast.fire({ icon: "error", title: msg });
}

function toastInfo(msg) {
  Toast.fire({ icon: "info", title: msg });
}

function showLoading(title = "Loading...") {
  Swal.fire({
    title,
    allowOutsideClick: false,
    allowEscapeKey: false,
    didOpen: () => Swal.showLoading()
  });
}

function closeLoading() {
  Swal.close();
}

// Burger Menu Logic (Sales Dashboard)
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