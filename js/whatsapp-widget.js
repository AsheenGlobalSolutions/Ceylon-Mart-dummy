(function () {
    // Create the button container
    const whatsappDiv = document.createElement('div');
    whatsappDiv.className = 'whatsapp-float';

    // Create the link
    const link = document.createElement('a');
    link.href = "https://wa.me/+17096909972";
    link.target = "_blank";
    link.className = 'whatsapp-btn';

    // Add icon and text
    // Using a simple SVG for WhatsApp icon to avoid external dependencies like FontAwesome if not already present.
    // However, if FontAwesome is used, we could use <i class="fab fa-whatsapp"></i>.
    // Let's use an SVG for self-containment.
    const svgIcon = `<i class="fa-brands fa-whatsapp" style="padding-left: 5px !important; font-size: 20px !important;"></i>`;

    link.innerHTML = "Chat with Us " + svgIcon;

    whatsappDiv.appendChild(link);
    document.body.appendChild(whatsappDiv);
})();
