// product-page.js (SHOP)

// --------------------
// EmailJS Setup
// --------------------
const PUBLIC_KEY = "YOUR_PUBLIC_KEY";
const SERVICE_ID = "YOUR_SERVICE_ID";
const TEMPLATE_ID = "YOUR_TEMPLATE_ID";
emailjs.init(PUBLIC_KEY);

// --------------------
// Firestore refs
// --------------------
if (!window.db || !window.productsCol || !window.ordersCol) {
console.log("db/productsCol/ordersCol not defined. Check firebase-shop.js");
}

// --------------------
// Delivery charge config
// --------------------
const DELIVERY_CHARGE = 450; // <-- sample fixed price (change this anytime)

let products = [];
let cart = [];
const ITEMS_PER_PAGE = 100;
let currentPage = 1;

let unsubscribeShopProducts = null;

// --------------------
// Delivery radio UI
// --------------------
document.addEventListener("DOMContentLoaded", () => {
  const deliveryRadios = document.querySelectorAll('input[name="deliveryType"]');
  const addressField = document.getElementById("addressField");

   function toggleAddress() {
    const selected = document.querySelector('input[name="deliveryType"]:checked')?.value;
    addressField.style.display = (selected === "Delivery") ? "block" : "none";

    if (selected !== "Delivery") {
      const addr = document.getElementById("customerAddress");
      if (addr) addr.value = "";
    }

    // recalc totals when switching pickup/delivery
    renderCart();
  }

  deliveryRadios.forEach(r => r.addEventListener("change", toggleAddress));
  toggleAddress();
});

// --------------------
// Realtime products listener (customer sees live stock)
// --------------------
function listenProductsRealtime() {
  const container = document.getElementById("products");
  container.innerHTML = `<p style="text-align:center; width:100%;">Loading products...</p>`;

  if (unsubscribeShopProducts) unsubscribeShopProducts();

  unsubscribeShopProducts = productsCol.onSnapshot(
  (snap) => {
    products = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    // optional sort in JS (if you want newest first)
    products.sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
    renderProducts();
    syncCartWithLatestStock();
  },
  (err) => {
    console.error(err);
  }
);
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
// UI rendering
// --------------------
function renderProducts() {
  const container = document.getElementById("products");
  const paginationContainer = document.getElementById("pagination");

  const totalItems = products.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

  if (currentPage > totalPages) currentPage = totalPages || 1;
  if (currentPage < 1) currentPage = 1;

  const start = (currentPage - 1) * ITEMS_PER_PAGE;
  const end = start + ITEMS_PER_PAGE;
  const displayedProducts = products.slice(start, end);

  if (displayedProducts.length === 0) {
    container.innerHTML = `<p style="text-align:center; width:100%;">No products found.</p>`;
  } else {
    container.innerHTML = displayedProducts.map(p => {
      const stockQty = Number(p.qty ?? 0);
      const price = Number(p.price ?? 0);

      const stockStatus = stockQty > 10 ? 'stock-ok' : (stockQty > 0 ? 'stock-low' : 'stock-out');
      const stockText = stockQty > 10 ? 'In Stock' : (stockQty > 0 ? `Low Qty: ${stockQty}` : 'Out of Stock');
      const isDisabled = stockQty === 0 ? 'disabled' : '';

      const imageSrc = p.image ? p.image : 'https://placehold.co/50x50?text=No+Img';

      return `
        <div class="product-row">
          <img src="${imageSrc}" class="product-thumb" alt="${escapeHtml(p.name || "")}">
          <div class="product-info">
            <h4>${escapeHtml(p.name || "")}</h4>
            <div class="product-meta">
              <span class="price">C$ ${price}</span>
              <span class="badget ${stockStatus}">${stockText}</span>
            </div>
          </div>
          <div class="product-action">
            <button class="btn btn-sm" onclick="addToCart('${p.id}')" ${isDisabled}>
              ${stockQty === 0 ? 'Notify' : 'Add'}
            </button>
          </div>
        </div>`;
    }).join("");
  }

  let paginationHTML = "";
  if (totalPages > 1) {
    paginationHTML += `<button class="page-btn" onclick="changePage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>Prev</button>`;
    for (let i = 1; i <= totalPages; i++) {
      paginationHTML += `<button class="page-btn ${i === currentPage ? 'active' : ''}" onclick="changePage(${i})">${i}</button>`;
    }
    paginationHTML += `<button class="page-btn" onclick="changePage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>Next</button>`;
  }
  paginationContainer.innerHTML = paginationHTML;

  renderCart();
}

function changePage(page) {
  const totalPages = Math.ceil(products.length / ITEMS_PER_PAGE);
  if (page < 1 || page > totalPages) return;
  currentPage = page;
  renderProducts();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --------------------
// Cart logic
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
  const container = document.getElementById("cartItems");

  if (cart.length === 0) {
  container.innerHTML = `<p style="color:var(--gray); text-align:center; padding:20px;">Cart is empty</p>`;

  const deliveryType =
    document.querySelector('input[name="deliveryType"]:checked')?.value || "Pickup";

  // ✅ reset totals UI properly (deliveryFee becomes 0 for Pickup)
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
        <span style="flex:1;">${escapeHtml(item.name || "")}</span>
        <div class="cart-controls">
          <button class="qty-btn" onclick="updateCartQty('${item.id}', -1)">-</button>
          <span>${item.qty}</span>
          <button class="qty-btn" onclick="updateCartQty('${item.id}', 1)">+</button>
          <button class="remove-btn" onclick="removeFromCart('${item.id}')">×</button>
        </div>
        <span style="margin-left:10px; width:80px; text-align:right;">C$ ${price * item.qty}</span>
      </div>`;
  }).join("");

    // current delivery type selection
  const deliveryType = document.querySelector('input[name="deliveryType"]:checked')?.value || "Pickup";

  // Update UI totals (includes delivery fee if needed)
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

// --------------------
// Place order (Reserved)
// --------------------
async function sendOrder() {
  syncCartWithLatestStock();

  if (cart.length === 0) {
    toastWarn("Cart is empty or items went out of stock!");
    return;
  }

  const name = document.getElementById("customerName").value.trim();
  const phone = document.getElementById("customerPhone").value.trim();
  const email = document.getElementById("customerEmail").value.trim();
  let address = "N/A";
  const deliveryType = document.querySelector('input[name="deliveryType"]:checked')?.value;

  if (deliveryType === "Delivery") {
    address = document.getElementById("customerAddress").value.trim();
    if (!address) {
      toastWarn("Please enter Address for Delivery.");
      return;
    }
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
      customer: { name, phone, email, address },
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

    <p style="margin-bottom:18px;">
      <strong>Order Reference: </strong>
      <span style="color:#2e7d32; font-size:16px;">
        <b>${readableId}</b>
      </span>
    </p>

    <p style="margin-bottom:18px;">
      Thank you for choosing <strong>Ceylon Mart</strong>.
    </p>

    <p style="margin-bottom:18px;">
      <strong>Grand Total:</strong> C$ ${grandTotal}
    </p>

    <p style="margin-bottom:18px;">
      You will receive payment instructions via email shortly.<br>
      Kindly use your <strong>Order ID as the payment reference</strong>.
    </p>

    <p style="margin-bottom:18px;">
      Your order will be confirmed once payment is received.
    </p>

    <p style="font-size:13px; color:#666; margin-top:10px;">
      Please note: Orders not paid within 24 hours will be automatically cancelled.
    </p>

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

// --------------------
// Helpers + Toasts
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

function toastSuccess(msg) {
  return Swal.fire({ icon: "success", title: msg, timer: 1600, showConfirmButton: false });
}
function toastError(msg) {
  return Swal.fire({ icon: "error", title: "Oops!", text: msg, timer: 2000, showConfirmButton: false });
}
function toastWarn(msg) {
  return Swal.fire({ icon: "warning", title: "Attention", text: msg, timer: 2000, showConfirmButton: false });
}

function showLoading(title = "Processing...") {
  return Swal.fire({
    title,
    allowOutsideClick: false,
    allowEscapeKey: false,
    didOpen: () => Swal.showLoading()
  });
}
function hideLoading() { Swal.close(); }

// Burger menu
const burger = document.querySelector('.burger');
const nav = document.querySelector('.nav-links');
if (burger) {
  burger.addEventListener('click', () => {
    nav.classList.toggle('nav-active');
    burger.classList.toggle('toggle');
  });
}

// Start
listenProductsRealtime();
renderCart();

window.addEventListener("beforeunload", () => {
  if (unsubscribeShopProducts) unsubscribeShopProducts();
});

function updateTotalsUI(itemsTotal, deliveryType) {
  const isDelivery = deliveryType === "Delivery";
  const deliveryFee = isDelivery ? DELIVERY_CHARGE : 0;
  const grandTotal = itemsTotal + deliveryFee;

  // Show base total
  document.getElementById("total").innerText = itemsTotal;

  // Show/hide delivery fee row
  const feeRow = document.getElementById("deliveryFeeRow");
  const feeEl = document.getElementById("deliveryFee");
  if (feeRow && feeEl) {
    feeRow.style.display = isDelivery ? "block" : "none";
    feeEl.innerText = deliveryFee;
  }

  // Show grand total
  const grandEl = document.getElementById("grandTotal");
  if (grandEl) grandEl.innerText = grandTotal;

  return { deliveryFee, grandTotal };
}

function clearFields() {
  document.getElementById("customerName").value = "";
  document.getElementById("customerPhone").value = "";
  document.getElementById("customerEmail").value = "";
  document.getElementById("customerAddress").value = "";
}



// pop-up window (How to Order)
document.addEventListener("DOMContentLoaded", function () {
  const popup = document.getElementById("howToOrderPopup");
  const closeBtn = document.getElementById("howtoCloseBtn");
  const startBtn = document.getElementById("startShoppingBtn");
  const dontShowBtn = document.getElementById("dontShowHowToBtn");

  if (!popup) return;

  const KEY = "how_to_seen";

  function openPopup() {
    popup.classList.add("show");
    popup.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function closePopup(setSeen = true) {
    popup.classList.remove("show");
    popup.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";

    // Save seen only when we want
    if (setSeen) localStorage.setItem(KEY, "1");
  }

  // ✅ Show only first time
  if (!localStorage.getItem(KEY)) {
    openPopup();
  }

  // ✅ Close (X)
  closeBtn?.addEventListener("click", () => closePopup(true));

  // ✅ Start Shopping (close popup, and allow link to work)
  startBtn?.addEventListener("click", () => closePopup(true));

  // ✅ Don’t show again
  dontShowBtn?.addEventListener("click", () => closePopup(true));

  // ✅ Click outside the popup-card closes it
  popup.addEventListener("click", (e) => {
    // only close if clicking on the overlay, not inside the card
    if (e.target === popup) closePopup(true);
  });

  // ✅ ESC key closes
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && popup.classList.contains("show")) {
      closePopup(true);
    }
  });
});