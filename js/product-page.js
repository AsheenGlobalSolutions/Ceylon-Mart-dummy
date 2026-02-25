let isAdminView = false;

// EmailJS (optional)
const PUBLIC_KEY = "YOUR_PUBLIC_KEY";
if (window.emailjs && PUBLIC_KEY !== "YOUR_PUBLIC_KEY") emailjs.init(PUBLIC_KEY);

// Firestore refs check
if (!window.db || !window.productsCol) {
  console.log("some refs are missing");
}

const DELIVERY_CHARGE = 450;

let products = [];
let filteredProducts = [];
let cart = [];

const ITEMS_PER_PAGE = 18;
let currentPage = 1;

let selectedCategory = "";
let selectedBrand = "";

let unsubscribeShopProducts = null;

document.addEventListener("DOMContentLoaded", () => {
  // Delivery toggle
  const deliveryRadios = document.querySelectorAll('input[name="deliveryType"]');
  const addressField = document.getElementById("addressField");

  function toggleAddress() {
    const selected = document.querySelector('input[name="deliveryType"]:checked')?.value || "Pickup";
    if (addressField) addressField.style.display = (selected === "Delivery") ? "block" : "none";
    if (selected !== "Delivery") {
      const addr = document.getElementById("customerAddress");
      if (addr) addr.value = "";
    }
    renderCart();
  }

  deliveryRadios.forEach(r => r.addEventListener("change", toggleAddress));
  toggleAddress();

  // Dropdown changes => apply
  document.getElementById("filterCategory")?.addEventListener("change", () => applyFilters());
  document.getElementById("filterBrand")?.addEventListener("change", () => applyFilters());

  // Burger menu
  const burger = document.querySelector(".burger");
  const nav = document.querySelector(".nav-links");
  if (burger && nav) {
    burger.addEventListener("click", () => {
      nav.classList.toggle("nav-active");
      burger.classList.toggle("toggle");
    });
  }

  if(window.auth){
    console.log("window.auth is present");
  }else{
    console.log("window.auth is missing");
  }

 const authRef = window.auth; // ✅
  if (!authRef) {
    console.error("window.auth is missing. Check firebase-auth script + firebase.js load order.");
    isAdminView = false;
    listenProductsRealtime(); // fallback as public
  } else {
    authRef.onAuthStateChanged((user) => {
      isAdminView = !!user;
      listenProductsRealtime();
    });
  }  renderCart();
  initHowToPopup();
});

window.addEventListener("beforeunload", () => {
  if (unsubscribeShopProducts) unsubscribeShopProducts();
});

// --------------------
// Realtime products
// --------------------
function listenProductsRealtime() {
  console.log("isAdminView:", isAdminView); // true if logged in
  const container = document.getElementById("products");
  if (container) {
    container.innerHTML = `<p style="text-align:center; width:100%;">Loading products...</p>`;
  }

  if (unsubscribeShopProducts) unsubscribeShopProducts();

  // 🔥 IMPORTANT PART
  const queryRef = isAdminView
    ? productsCol                // Admin sees all
    : productsCol.where("qty", ">", 0);  // Public sees only available

  unsubscribeShopProducts = queryRef.onSnapshot(
    (snap) => {
      products = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      products.sort((a, b) =>
        (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)
      );

      populateFilterOptions(products);

      filteredProducts = sortForGrouping([...products]);

      currentPage = 1;
      renderProducts();
      syncCartWithLatestStock();
      updateFilterSummaryUI();
    },
    (err) => console.error(err)
  );
}

// --------------------
// Grouping
// --------------------
function getGroupKey(p) {
  if (!selectedCategory && !selectedBrand) return (p.category || "Other").trim();
  if (selectedCategory && !selectedBrand) return selectedCategory;
  if (!selectedCategory && selectedBrand) return selectedBrand;
  return `${selectedCategory} · ${selectedBrand}`;
}

function sortForGrouping(list) {
  return [...list].sort((a, b) => {
    const ga = getGroupKey(a).toLowerCase();
    const gb = getGroupKey(b).toLowerCase();
    if (ga < gb) return -1;
    if (ga > gb) return 1;
    return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
  });
}

// --------------------
// Filters
// --------------------
function populateFilterOptions(list) {
  const catSelect = document.getElementById("filterCategory");
  const brandSelect = document.getElementById("filterBrand");
  if (!catSelect || !brandSelect) return;

  const categories = [...new Set(list.map(p => (p.category || "Other").trim()))].sort();
  const brands = [...new Set(list.map(p => (p.brand || "No Brand").trim()))].sort();

  const keepCat = catSelect.value || selectedCategory || "";
  const keepBrand = brandSelect.value || selectedBrand || "";

  catSelect.innerHTML =
    `<option value="">All Categories</option>` +
    categories.map(c => `<option value="${escapeHtmlAttrValue(c)}">${escapeHtml(c)}</option>`).join("");

  brandSelect.innerHTML =
    `<option value="">All Brands</option>` +
    brands.map(b => `<option value="${escapeHtmlAttrValue(b)}">${escapeHtml(b)}</option>`).join("");

  catSelect.value = keepCat;
  brandSelect.value = keepBrand;

  selectedCategory = keepCat;
  selectedBrand = keepBrand;
}

function applyFilters(isSilent = false) {
  const catSelect = document.getElementById("filterCategory");
  const brandSelect = document.getElementById("filterBrand");

  selectedCategory = catSelect?.value || "";
  selectedBrand = brandSelect?.value || "";

  filteredProducts = products.filter(p => {
    const pCat = (p.category || "Other").trim();
    const pBrand = (p.brand || "No Brand").trim();
    const okCat = !selectedCategory || pCat === selectedCategory;
    const okBrand = !selectedBrand || pBrand === selectedBrand;
    return okCat && okBrand;
  });

  filteredProducts = sortForGrouping(filteredProducts);

  currentPage = 1;
  renderProducts();
  updateFilterSummaryUI();

  if (!isSilent) window.scrollTo({ top: 0, behavior: "smooth" });
}

function clearFilters() {
  const catSelect = document.getElementById("filterCategory");
  const brandSelect = document.getElementById("filterBrand");

  if (catSelect) catSelect.value = "";
  if (brandSelect) brandSelect.value = "";

  selectedCategory = "";
  selectedBrand = "";

  filteredProducts = sortForGrouping([...products]);
  currentPage = 1;

  renderProducts();
  updateFilterSummaryUI();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function updateFilterSummaryUI() {
  const summary = document.getElementById("filterSummary");
  if (!summary) return;

  const cat = selectedCategory || "";
  const brand = selectedBrand || "";

  if (!cat && !brand) {
    summary.style.display = "none";
    summary.innerHTML = "";
    return;
  }

  summary.style.display = "block";
  summary.innerHTML = `Showing: ${cat ? `<b>${escapeHtml(cat)}</b>` : "All Categories"}${brand ? ` • <b>${escapeHtml(brand)}</b>` : ""}`;
}

// --------------------
// Render products + pagination
// --------------------
function renderProducts() {
  const container = document.getElementById("products");
  const paginationContainer = document.getElementById("pagination");
  if (!container || !paginationContainer) return;

  const list = filteredProducts;
  const totalItems = list.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

  if (currentPage > totalPages) currentPage = totalPages || 1;
  if (currentPage < 1) currentPage = 1;

  const sorted = sortForGrouping(list);
  const start = (currentPage - 1) * ITEMS_PER_PAGE;
  const end = start + ITEMS_PER_PAGE;
  const displayed = sorted.slice(start, end);

  if (displayed.length === 0) {
    container.innerHTML = `<p style="text-align:center; width:100%;">No products found.</p>`;
  } else {
    let html = "";
    let lastGroup = null;

    const pageGroupCounts = {};
    displayed.forEach(p => {
      const g = getGroupKey(p);
      pageGroupCounts[g] = (pageGroupCounts[g] || 0) + 1;
    });

    displayed.forEach(p => {
      const group = getGroupKey(p);

      if (group !== lastGroup) {
        html += `
          <div class="group-head">
            <span>${escapeHtml(group)}</span>
            <small>${pageGroupCounts[group]} item(s)</small>
          </div>
        `;
        lastGroup = group;
      }

      const stockQty = Number(p.qty ?? 0);
      const price = Number(p.price ?? 0);

      const stockStatus = stockQty > 10 ? "stock-ok" : (stockQty > 0 ? "stock-low" : "stock-out");
      const stockText = stockQty > 10 ? "In Stock" : (stockQty > 0 ? `Low Qty: ${stockQty}` : "Out of Stock");
      const isDisabled = stockQty === 0 ? "disabled" : "";

      const imageSrc = p.image ? p.image : "https://placehold.co/70x70?text=No+Img";

      html += `
        <div class="product-row">
          <img src="${imageSrc}" class="product-thumb" alt="${escapeHtmlAttr(p.name || "")}">
          <div class="product-info">
            <h4 title="${escapeHtmlAttr(p.name || "")}">${escapeHtml(p.name || "")}</h4>

            <div class="product-meta">
              <span class="price">C$ ${price}</span>
              <span class="badget ${stockStatus}">${stockText}</span>
            </div>

            <div class="product-meta">
              <span class="badget">${escapeHtml(p.category || "Other")}</span>
              <span class="badget">${escapeHtml(p.brand || "No Brand")}</span>
              <span class="badget">${escapeHtml(p.weight || "0")}</span>
            </div>
          </div>

          <div class="product-action">
            <button class="btn btn-sm" onclick="addToCart('${p.id}')" ${isDisabled}>
              ${stockQty === 0 ? "Notify" : "Add"}
            </button>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  let pag = "";
  if (totalPages > 1) {
    pag += `<button class="page-btn" onclick="changePage(${currentPage - 1})" ${currentPage === 1 ? "disabled" : ""}>Prev</button>`;
    for (let i = 1; i <= totalPages; i++) {
      pag += `<button class="page-btn ${i === currentPage ? "active" : ""}" onclick="changePage(${i})">${i}</button>`;
    }
    pag += `<button class="page-btn" onclick="changePage(${currentPage + 1})" ${currentPage === totalPages ? "disabled" : ""}>Next</button>`;
  }
  paginationContainer.innerHTML = pag;

  renderCart();
}

function changePage(page) {
  const totalPages = Math.ceil(filteredProducts.length / ITEMS_PER_PAGE);
  if (page < 1 || page > totalPages) return;
  currentPage = page;
  renderProducts();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// --------------------
// Cart
// --------------------
function addToCart(id) {
  const product = products.find(p => p.id === id);
  if (!product) return;

  const stockQty = Number(product.qty ?? 0);
  if (stockQty === 0) return;

  const existing = cart.find(i => i.id === id);
  const currentQtyInCart = existing ? existing.qty : 0;

  if (currentQtyInCart + 1 > stockQty) {
    toastWarn("Sorry, we don't have enough stock!");
    return;
  }

  if (existing) existing.qty++;
  else cart.push({ ...product, qty: 1 });

  renderCart();
}

function renderCart() {
  let total = 0;

  // Navbar badge count
  const navCount = document.getElementById("navCartCount");
  if (navCount) {
    const count = cart.reduce((sum, i) => sum + Number(i.qty || 0), 0);
    navCount.textContent = count;
    navCount.style.display = count > 0 ? "inline-flex" : "none";
  }
  
  const container = document.getElementById("cartItems");
  if (!container) return;

  if (cart.length === 0) {
    container.innerHTML = `<p class="empty">Cart is empty</p>`;
    const deliveryType = document.querySelector('input[name="deliveryType"]:checked')?.value || "Pickup";
    updateTotalsUI(0, deliveryType);
    return;
  }

  container.innerHTML = `
    <div style="text-align:right; margin-bottom:10px;">
      <button class="btn-clear-cart" onclick="clearCart()">Clear Cart</button>
    </div>
  ` + cart.map(item => {
    const price = Number(item.price ?? 0);
    total += price * item.qty;

    return `
      <div class="cart-item">
        <span style="flex:1; font-weight:800;">${escapeHtml(item.name || "")}</span>

        <div class="cart-controls">
          <button class="qty-btn" onclick="updateCartQty('${item.id}', -1)">-</button>
          <span style="min-width:22px; text-align:center; font-weight:900;">${item.qty}</span>
          <button class="qty-btn" onclick="updateCartQty('${item.id}', 1)">+</button>
          <button class="remove-btn" onclick="removeFromCart('${item.id}')">×</button>
        </div>

        <span style="margin-left:10px; width:80px; text-align:right; font-weight:900;">C$ ${price * item.qty}</span>
      </div>
    `;
  }).join("");

  const deliveryType = document.querySelector('input[name="deliveryType"]:checked')?.value || "Pickup";
  updateTotalsUI(total, deliveryType);
}

function updateCartQty(id, change) {
  const item = cart.find(i => i.id === id);
  const product = products.find(p => p.id === id);
  if (!item || !product) return;

  const stockQty = Number(product.qty ?? 0);
  const newQty = item.qty + change;

  if (newQty <= 0) { removeFromCart(id); return; }
  if (newQty > stockQty) { toastWarn("Max stock reached!"); return; }

  item.qty = newQty;
  renderCart();
}

function removeFromCart(id) {
  cart = cart.filter(i => i.id !== id);
  renderCart();
}

async function clearCart() {
  const res = await Swal.fire({
    icon: "warning",
    title: "Clear cart?",
    text: "All items will be removed.",
    showCancelButton: true,
    confirmButtonText: "Yes, clear",
    cancelButtonText: "Cancel"
  });

  if (res.isConfirmed) {
    cart = [];
    renderCart();
    toastSuccess("Cart cleared");
  }
}

function syncCartWithLatestStock() {
  let changed = false;

  cart = cart.map(item => {
    const p = products.find(x => x.id === item.id);
    if (!p) return item;

    const stockQty = Number(p.qty ?? 0);
    if (item.qty > stockQty) {
      item.qty = stockQty;
      changed = true;
    }
    return item;
  }).filter(item => item.qty > 0);

  if (changed) {
    toastWarn("Stock updated: your cart quantities were adjusted.");
    renderCart();
  }
}

// --------------------
// Totals
// --------------------
function updateTotalsUI(itemsTotal, deliveryType) {
  const isDelivery = deliveryType === "Delivery";
  const deliveryFee = isDelivery ? DELIVERY_CHARGE : 0;
  const grandTotal = itemsTotal + deliveryFee;

  document.getElementById("total").innerText = itemsTotal;

  const feeRow = document.getElementById("deliveryFeeRow");
  const feeEl = document.getElementById("deliveryFee");
  feeRow.style.display = isDelivery ? "block" : "none";
  feeEl.innerText = deliveryFee;

  document.getElementById("grandTotal").innerText = grandTotal;

  return { deliveryFee, grandTotal };
}

// --------------------
// Place order
// --------------------
async function sendOrder() {
  syncCartWithLatestStock();

  if (cart.length === 0) {
    toastWarn("Cart is empty or items went out of stock!");
    return;
  }

  const name = document.getElementById("customerName")?.value.trim();
  const phone = document.getElementById("customerPhone")?.value.trim();
  const email = document.getElementById("customerEmail")?.value.trim();
  const note = document.getElementById("customerNote")?.value.trim() || "";

  let address = "N/A";
  const deliveryType = document.querySelector('input[name="deliveryType"]:checked')?.value || "Pickup";

  if (deliveryType === "Delivery") {
    address = document.getElementById("customerAddress")?.value.trim();
    if (!address) { toastWarn("Please enter Address for Delivery."); return; }
  }

  if (!name || !phone || !email) {
    toastWarn("Please enter Name, Phone, Email.");
    return;
  }

  const items = cart.map(i => ({
    productId: i.id,
    name: i.name || "",
    price: Number(i.price ?? 0),
    qty: Number(i.qty ?? 0),
  }));

  const itemsTotal = items.reduce((sum, i) => sum + (i.price * i.qty), 0);
  const deliveryFee = (deliveryType === "Delivery") ? DELIVERY_CHARGE : 0;
  const grandTotal = itemsTotal + deliveryFee;

  try {
    showLoading("Saving order...");

    const orderRef = ordersCol.doc();
    const readableId = "R-" + orderRef.id.slice(-6).toUpperCase();

    await orderRef.set({
      readableId,
      customer: { name, phone, email, address, note },
      deliveryType,

      status: "Reserved",
      stockApplied: false,
      stockRestored: false,
      reservedAt: firebase.firestore.FieldValue.serverTimestamp(),

      itemsTotal,
      deliveryFee,
      grandTotal,
      items,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });

    hideLoading();
    clearFields();

    await Swal.fire({
      icon: "success",
      title: "Order Successfully Placed",
      html: `
        <div style="line-height:1.8; text-align:left;">
          <p style="margin-bottom:12px;"><strong>Order Reference:</strong> <b style="color:#2e7d32">${readableId}</b></p>
          <p style="margin-bottom:12px;"><strong>Grand Total:</strong> C$ ${grandTotal}</p>
          <p style="color:#666; font-size:13px;">Orders not paid within 24 hours will be automatically cancelled.</p>
        </div>
      `,
      confirmButtonText: "Continue"
    });

    cart = [];
    renderCart();
  } catch (e) {
    hideLoading();
    console.error(e);
    toastError("Failed to save order.");
  }
}

function clearFields() {
  ["customerName","customerPhone","customerEmail","customerAddress","customerNote"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
}

// --------------------
// How-to popup
// --------------------
function initHowToPopup() {
  const popup = document.getElementById("howToOrderPopup");
  const closeBtn = document.getElementById("howtoCloseBtn");
  const startBtn = document.getElementById("startShoppingBtn");
  const dontShowBtn = document.getElementById("dontShowHowToBtn");
  if (!popup) return;

  const KEY = "how_to_seen";

  function openPopup() {
    popup.classList.add("show");
    popup.setAttribute("aria-hidden","false");
    document.body.style.overflow = "hidden";
  }
  function closePopup(setSeen=true) {
    popup.classList.remove("show");
    popup.setAttribute("aria-hidden","true");
    document.body.style.overflow = "";
    if (setSeen) localStorage.setItem(KEY, "1");
  }

  if (!localStorage.getItem(KEY)) openPopup();

  closeBtn?.addEventListener("click", () => closePopup(true));
  startBtn?.addEventListener("click", () => closePopup(true));
  dontShowBtn?.addEventListener("click", () => closePopup(true));

  popup.addEventListener("click", (e) => { if (e.target === popup) closePopup(true); });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && popup.classList.contains("show")) closePopup(true);
  });
}

// --------------------
// Filter Drawer open/close
// --------------------
function openFilterDrawer(){
  const overlay = document.getElementById("filterDrawerOverlay");
  if (!overlay) return;
  overlay.classList.add("show");
  overlay.setAttribute("aria-hidden","false");
  document.body.style.overflow = "hidden";
}

function closeFilterDrawer(){
  const overlay = document.getElementById("filterDrawerOverlay");
  if (!overlay) return;
  overlay.classList.remove("show");
  overlay.setAttribute("aria-hidden","true");
  document.body.style.overflow = "";
}

// Click outside closes drawer
document.addEventListener("click", (e) => {
  const overlay = document.getElementById("filterDrawerOverlay");
  if (!overlay) return;
  if (overlay.classList.contains("show") && e.target === overlay) closeFilterDrawer();
});

// ESC closes drawer
document.addEventListener("keydown", (e) => {
  const overlay = document.getElementById("filterDrawerOverlay");
  if (e.key === "Escape" && overlay?.classList.contains("show")) closeFilterDrawer();
});

// --------------------
// Helpers + toasts
// --------------------
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[s]));
}
function escapeHtmlAttr(str){ return escapeHtml(str).replace(/`/g,"&#096;"); }
function escapeHtmlAttrValue(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/"/g, "&quot;")
    .replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function toastSuccess(msg) { return Swal.fire({ icon:"success", title: msg, timer:1600, showConfirmButton:false }); }
function toastError(msg) { return Swal.fire({ icon:"error", title:"Oops!", text: msg, timer:2000, showConfirmButton:false }); }
function toastWarn(msg) { return Swal.fire({ icon:"warning", title:"Attention", text: msg, timer:2000, showConfirmButton:false }); }

function showLoading(title="Processing...") {
  return Swal.fire({ title, allowOutsideClick:false, allowEscapeKey:false, didOpen: () => Swal.showLoading() });
}
function hideLoading(){ Swal.close(); }


function scrollToCart() {
  const cartEl = document.getElementById("cartSection");
  if (!cartEl) return;

  // close burger menu if open (mobile)
  const nav = document.querySelector(".nav-links");
  const burger = document.querySelector(".burger");
  if (nav?.classList.contains("nav-active")) nav.classList.remove("nav-active");
  if (burger?.classList.contains("toggle")) burger.classList.remove("toggle");

  cartEl.scrollIntoView({ behavior: "smooth", block: "start" });

  // optional: small highlight effect
  cartEl.classList.add("cart-highlight");
  setTimeout(() => cartEl.classList.remove("cart-highlight"), 900);
}

window.scrollToCart = scrollToCart;

// Expose functions for inline onclick
window.openFilterDrawer = openFilterDrawer;
window.closeFilterDrawer = closeFilterDrawer;
window.applyFilters = applyFilters;
window.clearFilters = clearFilters;
window.changePage = changePage;
window.addToCart = addToCart;
window.updateCartQty = updateCartQty;
window.removeFromCart = removeFromCart;
window.clearCart = clearCart;
window.sendOrder = sendOrder;