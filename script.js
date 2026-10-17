/* RE WALLET - LANDING PAGE SCRIPT */

const startBtn = document.getElementById("startBtn");
const emailInput = document.getElementById("emailInput");
const demoBtn = document.querySelector(".demo-btn");

/* START - ENTER LEFT MODE */
startBtn.addEventListener("click", () => {
  const email = emailInput.value.trim();

  if (!email) {
    emailInput.focus();
    return;
  }

  console.log("Email ingresado:", email);
  alert("Gracias por registrar tu correo. Pronto accederás al modo izquierdo.");
});

/* DEMO DEVNET - navega a la app principal (React/Vite en /) */
demoBtn.addEventListener("click", () => {
  console.log("Demo Devnet seleccionado");
  window.location.href = "/";
});