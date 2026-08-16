// login.js — handles the "send code" -> "verify code" flow on login.html

const requestStep = document.getElementById("request-step");
const otpStep = document.getElementById("otp-step");
const sendBtn = document.getElementById("send-code-btn");
const verifyBtn = document.getElementById("verify-btn");
const resendLink = document.getElementById("resend-link");
const otpInput = document.getElementById("otp-input");
const statusMsg = document.getElementById("status-msg");

function showStatus(text, type) {
  statusMsg.textContent = text;
  statusMsg.className = type || "";
}

async function requestCode() {
  sendBtn.disabled = true;
  showStatus("Sending code…", "");
  try {
    const res = await fetch("/api/request-otp", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to send code");

    requestStep.style.display = "none";
    otpStep.style.display = "block";
    otpInput.focus();
    showStatus("Code sent — check your email.", "success");
  } catch (err) {
    showStatus(err.message, "error");
    sendBtn.disabled = false;
  }
}

async function verifyCode() {
  const code = otpInput.value.trim();
  if (!code) {
    showStatus("Enter the code first.", "error");
    return;
  }
  verifyBtn.disabled = true;
  showStatus("Checking…", "");
  try {
    const res = await fetch("/api/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Verification failed");

    showStatus("Logged in — redirecting…", "success");
    window.location.href = "/";
  } catch (err) {
    showStatus(err.message, "error");
    verifyBtn.disabled = false;
  }
}

sendBtn.addEventListener("click", requestCode);
verifyBtn.addEventListener("click", verifyCode);
resendLink.addEventListener("click", (e) => {
  e.preventDefault();
  sendBtn.disabled = false;
  requestCode();
});
otpInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") verifyCode();
});
