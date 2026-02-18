    // -----------------------------
    // EmailJS Setup (Fill your keys)
    // -----------------------------
    const PUBLIC_KEY = "YOUR_PUBLIC_KEY";
    const SERVICE_ID = "YOUR_SERVICE_ID";
    const TEMPLATE_ID = "YOUR_TEMPLATE_ID";

    emailjs.init(PUBLIC_KEY);

    // -----------------------------
    // Firestore Products + Shop Logic
    // -----------------------------

    // Firestore products (from firebase.js)
    // Expecting: window.productsCol = db.collection("products")
    if (!window.productsCol) {
      console.error("productsCol is not defined. Check ../js/firebase.js");
    }

    let products = [];          // loaded from Firestore
    let cart = [];              // cart in memory
    const ITEMS_PER_PAGE = 100;
    let currentPage = 1;

    // Load products once (or you can enable realtime listener below)
    async function loadProductsFromFirestore() {
      const container = document.getElementById("products");
      container.innerHTML = `<p style="text-align:center; width:100%;">Loading products...</p>`;

      try {
        const snap = await productsCol.orderBy("createdAt", "desc").get();

        products = snap.docs.map(doc => ({
          id: doc.id,     // Firestore doc id (string)
          ...doc.data()
        }));

        renderProducts();
      } catch (err) {
        console.error(err);
        container.innerHTML = `<p style="text-align:center; width:100%; color:red;">Failed to load products</p>`;
      }
    }

    // (Optional) Realtime updates
    // function listenProductsRealtime() {
    //   const container = document.getElementById("products");
    //   container.innerHTML = `<p style="text-align:center; width:100%;">Loading products...</p>`;

    //   productsCol.orderBy("createdAt", "desc").onSnapshot((snap) => {
    //     products = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    //     renderProducts();
    //   }, (err) => {
    //     console.error(err);
    //     container.innerHTML = `<p style="text-align:center; width:100%; color:red;">Failed to load products</p>`;
    //   });
    // }

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

      // Pagination
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
  // optional nice feedback:
  // Swal.fire({ icon:"success", title:"Added to cart", timer:900, showConfirmButton:false });
}

    function renderCart() {
      let total = 0;
      const container = document.getElementById("cartItems");

      if (cart.length === 0) {
        container.innerHTML = `<p style="color:var(--gray); text-align:center; padding:20px;">Cart is empty</p>`;
        document.getElementById("total").innerText = "0";
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

      document.getElementById("total").innerText = total;
    }

    function updateCartQty(id, change) {
  const item = cart.find(i => i.id === id);
  const product = products.find(p => p.id === id);
  if (!item || !product) return;

  const stockQty = Number(product.qty ?? 0);
  const newQty = item.qty + change;

  if (newQty <= 0) {
    removeFromCart(id);
    return;
  }

  if (newQty > stockQty) {
    toastWarn("Max stock reached!");
    return;
  }

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


async function sendOrder() {
  if (cart.length === 0) {
    alert("Cart is empty!");
    return;
  }

  const name = document.getElementById("customerName").value.trim();
  const phone = document.getElementById("customerPhone").value.trim();
  const email = document.getElementById("customerEmail").value.trim();
  const note = document.getElementById("customerNote").value.trim();
  const deliveryType = document.querySelector('input[name="deliveryType"]:checked').value;

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

  const total = items.reduce((sum, i) => sum + i.price * i.qty, 0);

  try {

    showLoading("Saving order...");

    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const dateKey = `${yyyy}${mm}${dd}`; // 20260217

    // Counter doc per day (so it resets daily)
    const counterRef = db.collection("counters").doc(`orders_${dateKey}`);

    const readableId = await db.runTransaction(async (tx) => {
      const counterSnap = await tx.get(counterRef);

      let next = 1;
      if (!counterSnap.exists) {
        tx.set(counterRef, { current: 1, dateKey });
      } else {
        const current = Number(counterSnap.data().current ?? 0);
        next = current + 1;
        tx.update(counterRef, { current: next });
      }

      const orderNo = String(next).padStart(3, "0"); // 001, 002...
      const newReadableId = `R-${dateKey}-${orderNo}`; // R-20260217-001

      // Save order using readable id as document id
      const orderRef = ordersCol.doc(newReadableId);

      tx.set(orderRef, {
        readableId: newReadableId,
        customer: { name, phone, email },
        deliveryType,
        note,
        status: "Pending",
        total,
        items,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        paidAt: null
      });
      return newReadableId;
    });

        // OPTIONAL: send EmailJS (if you want)
//     /*
//     const orderDetails = items.map(i => `${i.name} x ${i.qty}`).join("\n");
//     const templateParams = {
//       customer_name: name,
//       customer_phone: phone,
//       customer_email: email,
//       delivery_type: deliveryType,
//       customer_note: note,
//       order_details: orderDetails,
//       order_total: total,
//       order_id: orderDoc.id
//     };

//     await emailjs.send(SERVICE_ID, TEMPLATE_ID, templateParams);
//     */


    hideLoading();

    await Swal.fire({
      icon: "success",
      title: "Order Saved!",
      html: `Your Order ID: <b>${readableId}</b>`,
      confirmButtonText: "OK"
    });

    cart = [];
    renderCart();



  } catch (e) {
    console.error(e);
    toastError("Failed to save order. Check console.");
  }
}

    function escapeHtml(str) {
      return String(str).replace(/[&<>"']/g, s => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      }[s]));
    }

    // Start
    loadProductsFromFirestore();
    renderCart();

    // Burger Menu Logic
    const burger = document.querySelector('.burger');
    const nav = document.querySelector('.nav-links');

    if (burger) {
      burger.addEventListener('click', () => {
        nav.classList.toggle('nav-active');
        burger.classList.toggle('toggle');
      });
    }


    function toastSuccess(msg) {
  return Swal.fire({
    icon: "success",
    title: msg,
    timer: 1600,
    showConfirmButton: false
  });
}

function toastError(msg) {
  return Swal.fire({
    icon: "error",
    title: "Oops!",
    text: msg,
    timer: 2000,
    showConfirmButton: false
  });
}

function toastWarn(msg) {
  return Swal.fire({
    icon: "warning",
    title: "Attention",
    text: msg,
    timer: 2000,
    showConfirmButton: false
  });
}

function showLoading(title = "Processing...") {
  return Swal.fire({
    title,
    allowOutsideClick: false,
    allowEscapeKey: false,
    didOpen: () => Swal.showLoading()
  });
}

function hideLoading() {
  Swal.close();
}