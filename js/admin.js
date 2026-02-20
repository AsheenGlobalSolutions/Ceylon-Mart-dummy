document.addEventListener("DOMContentLoaded", () => {
  // keep everything hidden while checking
  const loading = document.getElementById("authLoading");
  const loginSection = document.getElementById("loginSection");
  const dashSection = document.getElementById("dashboardSection");

  // Safety: ensure hidden until we decide
  loginSection.style.display = "none";
  dashSection.style.display = "none";
  loading.style.display = "flex";

  auth.onAuthStateChanged((user) => {
    loading.style.display = "none";

    if (user) {
      // already logged in
      loginSection.style.display = "none";
      dashSection.style.display = "block";

      // load your dashboard data here if needed
      loadProducts();

    } else {
      // not logged in
      dashSection.style.display = "none";
      loginSection.style.display = "block";
    }
  });

  const imageInput = document.getElementById("productImageFile");

  if (imageInput) {
    imageInput.addEventListener("change", function () {
      const file = this.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = function (e) {
        const preview = document.getElementById("imagePreview");
        preview.src = e.target.result;
        preview.style.display = "block";
      };
      reader.readAsDataURL(file);
    });
  }
});

function showDashboard() {
  document.getElementById("loginSection").style.display = "none";
  document.getElementById("dashboardSection").style.display = "block";
}

function showLogin() {
  document.getElementById("loginSection").style.display = "block";
  document.getElementById("dashboardSection").style.display = "none";
}



async function login() {
  const user = document.getElementById("username").value.trim();
  const pass = document.getElementById("password").value;

  if (!user || !pass) {
    Swal.fire({ icon: "warning", title: "Missing details", text: "Enter email and password" });
    return;
  }

  showLoading("Logging in...");

  try {
    await auth.signInWithEmailAndPassword(user, pass);
    hideLoading();

    await Swal.fire({
      icon: "success",
      title: "Login Successful",
      text: "Welcome back!",
      timer: 1500,
      showConfirmButton: false
    });

    showDashboard();
    loadProducts();

  } catch (error) {
    hideLoading();

    Swal.fire({
      icon: "error",
      title: "Login Failed",
      text: error.message || "Invalid Credentials",
      showConfirmButton: true
    });
  }
}
async function logout() {
  await auth.signOut();

  Swal.fire({
    icon: 'success',
    title: 'Logout Successful',
    text: 'You have been logged out',
    timer: 1500,
    showConfirmButton: false
  });

  showLogin();
}

// --- Product Management Logic ---
const ITEMS_PER_PAGE = 20; // Admin Pagination Limit
let currentPage = 1;

// --- Firestore Product Management ---
// --- Firestore Product Management ---
let allProductsCache = []; // store loaded products in memory for pagination

async function loadProducts() {
  const tbody = document.getElementById("productTableBody");
  const paginationContainer = document.getElementById("pagination");

  tbody.innerHTML = "<tr><td colspan='8' style='text-align:center;'>Loading...</td></tr>";
  paginationContainer.innerHTML = "";

  try {
    // Get all products (simple way). For big data later we can do server-side pagination.
    const snap = await productsCol.orderBy("createdAt", "desc").get();

    allProductsCache = snap.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    renderProductsPage();
  } catch (err) {
    console.error(err);
    tbody.innerHTML = "<tr><td colspan='8' style='text-align:center;color:red;'>Failed to load products</td></tr>";
  }
}
function renderProductsPage() {
  const tbody = document.getElementById("productTableBody");
  const paginationContainer = document.getElementById("pagination");

  tbody.innerHTML = "";

  if (allProductsCache.length === 0) {
    tbody.innerHTML = "<tr><td colspan='8' style='text-align:center;'>No products found.</td></tr>";
    paginationContainer.innerHTML = "";
    return;
  }

  const totalItems = allProductsCache.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);

  if (currentPage > totalPages) currentPage = totalPages || 1;
  if (currentPage < 1) currentPage = 1;

  const start = (currentPage - 1) * ITEMS_PER_PAGE;
  const end = start + ITEMS_PER_PAGE;
  const displayed = allProductsCache.slice(start, end);

  displayed.forEach(p => {
  const qty = Number(p.qty ?? 0);
  const price = Number(p.price ?? 0);

  // ✅ show readable ID in table (fallback to old if missing)
  const readableId = p.productId || p.readableId || makeReadableProductIdFromDocId(p.id);

  const row = `<tr>
    <td>${readableId}</td>
    <td>${escapeHtml(p.name || "")}</td>
    <td>${escapeHtml(p.brand || "No Brand")}</td>
    <td>${escapeHtml(p.category || "Other")}</td>
    <td>${escapeHtml(p.weight || "0")}</td>
    <td>C$ ${price}</td>
    <td>
      <span class="badget ${qty > 10 ? 'stock-ok' : (qty > 0 ? 'stock-low' : 'stock-out')}">
        ${qty}
      </span>
    </td>
   <td class="action-buttons">
  <button class="btn btn-secondary"
    onclick="editProduct('${p.id}')">Edit</button>

  <button class="btn btn-danger"
    onclick="deleteProduct('${p.id}')">Delete</button>
</td>
  </tr>`;

  tbody.innerHTML += row;
});

  // Pagination UI
  let html = "";
  if (totalPages > 1) {
    html += `<button class="page-btn" onclick="changePage(${currentPage - 1})" ${currentPage === 1 ? "disabled" : ""}>Prev</button>`;
    for (let i = 1; i <= totalPages; i++) {
      html += `<button class="page-btn ${i === currentPage ? "active" : ""}" onclick="changePage(${i})">${i}</button>`;
    }
    html += `<button class="page-btn" onclick="changePage(${currentPage + 1})" ${currentPage === totalPages ? "disabled" : ""}>Next</button>`;
  }
  paginationContainer.innerHTML = html;
}

function changePage(page) {
  const totalPages = Math.ceil(allProductsCache.length / ITEMS_PER_PAGE);
  if (page < 1 || page > totalPages) return;
  currentPage = page;
  renderProductsPage();
}

function setSaveMode() {
  const btn = document.getElementById("saveBtn");
  btn.textContent = "Save Product";
  btn.classList.remove("btn-secondary");
}

function setUpdateMode() {
  const btn = document.getElementById("saveBtn");
  btn.textContent = "Update Product";
  //btn.classList.add("btn-danger"); // optional style difference
}


async function saveProduct() {
  const docId = document.getElementById("productId").value.trim();
  const name = document.getElementById("productName").value.trim();
  let brand = document.getElementById("productBrand").value.trim();
if (!brand) brand = "No Brand";

let category = document.getElementById("productCategory").value.trim();
if (!category) category = "Other";

let weight = document.getElementById("weight").value.trim();
if (!weight) weight = "0";

  const price = Number(document.getElementById("productPrice").value);

  const qty = Number(document.getElementById("productQty").value);
  const fileInput = document.getElementById("productImageFile");
  let imageUrl = null;

  if (fileInput.files.length > 0) {
    showLoading("Uploading image...");
    imageUrl = await uploadImageToCloudinary(fileInput.files[0]);
  }
  if (!name || !Number.isFinite(price) || !Number.isFinite(qty)) {
    Swal.fire({ icon: "warning", title: "Missing details", text: "Please enter name, price and quantity." });
    return;
  }

  const data = {
    name,
    brand,
    category,
    weight,
    price,
    qty,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  if (imageUrl) {
    data.image = imageUrl;
  };

  try {
    showLoading(docId ? "Updating product..." : "Adding product...");

    if (docId) {
      await productsCol.doc(docId).update(data);
} else {
  data.createdAt = firebase.firestore.FieldValue.serverTimestamp();

  // ✅ generate firestore doc first (no write yet)
  const ref = productsCol.doc();         // creates doc reference with random id
  const newId = "P-" + ref.id.slice(-8).toUpperCase(); // readable product id

  // ✅ save product (single write)
  await ref.set({
    ...data,
    productId: newId,     // store readable id inside doc
    readableId: newId     // optional, if you want consistent naming
  });
}

    hideLoading();

    Swal.fire({ icon: "success", title: docId ? "Updated!" : "Added!", timer: 1200, showConfirmButton: false });
    clearForm();
    setSaveMode();
    await loadProducts();
  } catch (err) {
    hideLoading();
    console.error(err);
    Swal.fire({ icon: "error", title: "Save failed", text: err.message });
  }
}

function editProduct(docId) {
  const p = allProductsCache.find(x => x.id === docId);
  if (!p) return;

  document.getElementById("productId").value = p.id;
  document.getElementById("productName").value = p.name || "";
  document.getElementById("productPrice").value = p.price ?? "";
  document.getElementById("productQty").value = p.qty ?? 0;
  document.getElementById("productBrand").value = p.brand || "";
  document.getElementById("productCategory").value = p.category || "";
  document.getElementById("weight").value = p.weight || "";

  const preview = document.getElementById("imagePreview");
  if (p.image) {
    preview.src = p.image;
    preview.style.display = "block";
  } else {
    preview.src = "";
    preview.style.display = "none";
  }

  setUpdateMode();

  // ✅ scroll to form
  document.getElementById("productFormSection")?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

async function deleteProduct(docId) {
  const result = await Swal.fire({
    title: "Delete product?",
    text: "This cannot be undone.",
    icon: "warning",
    showCancelButton: true,
    confirmButtonText: "Yes, delete",
  });

  if (!result.isConfirmed) return;

  try {
    showLoading("Deleting...");
    await productsCol.doc(docId).delete();
    hideLoading();
    Swal.fire({ icon: "success", title: "Deleted", timer: 1200, showConfirmButton: false });
    loadProducts();
  } catch (err) {
    hideLoading();
    console.error(err);
    Swal.fire({ icon: "error", title: "Delete failed", text: err.message });
  }
}

function clearForm() {
  document.getElementById("productId").value = "";
  document.getElementById("productName").value = "";
  document.getElementById("productPrice").value = "";
  document.getElementById("productQty").value = "";
  document.getElementById("productBrand").value = "";
  document.getElementById("productCategory").value = "";
  document.getElementById("weight").value = "";

  // Clear file input
  const fileInput = document.getElementById("productImageFile");
  fileInput.value = "";

  // Hide preview
  const preview = document.getElementById("imagePreview");
  preview.src = "";
  preview.style.display = "none";

  setSaveMode();
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

function showLoading(title = "Processing...") {
  Swal.fire({
    title,
    allowOutsideClick: false,
    allowEscapeKey: false,
    didOpen: () => {
      Swal.showLoading();
    }
  });
}

function hideLoading() {
  Swal.close();
}

async function uploadImageToCloudinary(file) {
  const cloudName = "drbpkssnp";
  const uploadPreset = "ceylon_mart_products";

  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", uploadPreset);

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    {
      method: "POST",
      body: formData
    }
  );

  const data = await response.json();

  if (!data.secure_url) {
    throw new Error("Image upload failed");
  }

  return data.secure_url;
}

function makeReadableProductIdFromDocId(docId) {
  return "P-" + docId.slice(-8).toUpperCase(); // P-7G2FPQ4Z
} 

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