import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // SSLCommerz Integration
  const STORE_ID = process.env.SSLCOMMERZ_STORE_ID || "test67d264f331049";
  const STORE_PASSWORD = process.env.SSLCOMMERZ_STORE_PASSWORD || "test67d264f331049@ssl";
  const IS_SANDBOX = process.env.SSLCOMMERZ_IS_SANDBOX === "true" || true;
  const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

  const SSLCOMMERZ_API_URL = IS_SANDBOX 
    ? "https://sandbox.sslcommerz.com/gwprocess/v4/api.php"
    : "https://securepay.sslcommerz.com/gwprocess/v4/api.php";

  // API Route to initiate payment
  app.post("/api/payment/init", async (req, res) => {
    const { amount, appointmentData } = req.body;

    const tran_id = `REF-${Date.now()}`;
    
    const data = {
      store_id: STORE_ID,
      store_passwd: STORE_PASSWORD,
      total_amount: amount,
      currency: "BDT",
      tran_id: tran_id,
      success_url: `${APP_URL}/api/payment/success?tran_id=${tran_id}`,
      fail_url: `${APP_URL}/api/payment/fail?tran_id=${tran_id}`,
      cancel_url: `${APP_URL}/api/payment/cancel?tran_id=${tran_id}`,
      ipn_url: `${APP_URL}/api/payment/ipn`,
      shipping_method: "NO",
      product_name: "Doctor Appointment",
      product_category: "Healthcare",
      product_profile: "general",
      cus_name: appointmentData.patientName || "Customer",
      cus_email: appointmentData.patientEmail || "customer@example.com",
      cus_add1: "Dhaka",
      cus_city: "Dhaka",
      cus_postcode: "1000",
      cus_country: "Bangladesh",
      cus_phone: "01711111111",
      value_a: JSON.stringify(appointmentData) // Store appointment data to retrieve later
    };

    try {
      const response = await axios.post(SSLCOMMERZ_API_URL, data, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" }
      });

      if (response.data.status === "SUCCESS") {
        res.json({ url: response.data.GatewayPageURL });
      } else {
        res.status(400).json({ error: response.data.failedreason || "Payment initiation failed" });
      }
    } catch (error) {
      console.error("SSLCommerz Error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Payment Callbacks
  app.post("/api/payment/success", (req, res) => {
    // In a real app, you'd verify the payment here with SSLCommerz validation API
    // and then save the appointment to Firestore from the backend.
    // For this demo, we'll redirect back to the app with a success flag.
    const appointmentData = req.body.value_a;
    res.redirect(`/?payment=success&data=${encodeURIComponent(appointmentData)}`);
  });

  app.post("/api/payment/fail", (req, res) => {
    res.redirect("/?payment=fail");
  });

  app.post("/api/payment/cancel", (req, res) => {
    res.redirect("/?payment=cancel");
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
