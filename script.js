/* RE WALLET - LANDING PAGE SCRIPT */

/* ---------------------------------------------------------------------------
   MÉTRICAS — placeholders.

   Reemplazar con valores reales del Dynamic Dashboard API:
     GET /environments/:environmentId/analytics/topline
     (scope del token: environment.analytics.read)

   Campos a mapear:
     METRICS.users    -> users.allTime
     METRICS.wallets  -> wallets.allTime
     METRICS.sessions -> sessions.allTime

   NUNCA exponer el API token de Dynamic en el cliente: el bake debe hacerse
   en build time o desde un backend propio.
--------------------------------------------------------------------------- */
const METRICS = {
  users: 1240,
  wallets: 960,
  sessions: 5180,
};

const startBtn = document.getElementById("startBtn");
const emailInput = document.getElementById("emailInput");
const demoBtn = document.querySelector(".demo-btn");

/* WAITLIST — registra el correo del interesado */
startBtn.addEventListener("click", () => {
  const email = emailInput.value.trim();

  if (!email) {
    emailInput.focus();
    return;
  }

  console.log("Email ingresado:", email);
  alert("Gracias. Estás en la lista de espera de Re Wallet.");
});

/* DEMO DEVNET - navega a la app principal (React/Vite en /) */
demoBtn.addEventListener("click", () => {
  console.log("Demo Devnet seleccionado");
  window.location.href = "/";
});

/* HEADLINE ROTATOR — "cualquier persona" ↔ "cualquier negocio" */
const headlineRotate = document.getElementById("headlineRotate");
const prefersReducedMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

if (headlineRotate && !prefersReducedMotion) {
  const headlines = ["cualquier persona", "cualquier negocio"];
  let headlineIndex = 0;

  setInterval(() => {
    headlineRotate.classList.add("is-out");

    setTimeout(() => {
      headlineIndex = (headlineIndex + 1) % headlines.length;
      headlineRotate.textContent = headlines[headlineIndex];
      headlineRotate.classList.remove("is-out");
    }, 350);
  }, 2800);
}

/* MÉTRICAS — cuenta animada al entrar en viewport */
function animateCount(el, target, duration = 1400) {
  const start = performance.now();

  const frame = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(target * eased).toLocaleString("es");

    if (progress < 1) {
      requestAnimationFrame(frame);
    }
  };

  requestAnimationFrame(frame);
}

const metricsObserver = new IntersectionObserver(
  (entries, observer) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;

      const key = entry.target.dataset.metric;
      animateCount(entry.target, METRICS[key] ?? 0);
      observer.unobserve(entry.target);
    });
  },
  { threshold: 0.6 },
);

document.querySelectorAll("[data-metric]").forEach((el) => {
  metricsObserver.observe(el);
});

/* PROGRESS BAR — avance de scroll + sección activa */
const progressFill = document.getElementById("progressFill");
const progressLabel = document.getElementById("progressLabel");

window.addEventListener(
  "scroll",
  () => {
    const doc = document.documentElement;
    const max = doc.scrollHeight - doc.clientHeight;
    const pct = max > 0 ? (doc.scrollTop / max) * 100 : 0;
    progressFill.style.width = `${pct}%`;
  },
  { passive: true },
);

const sectionObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting && entry.target.dataset.label) {
        progressLabel.textContent = entry.target.dataset.label;
      }
    });
  },
  { rootMargin: "-40% 0px -55% 0px" },
);

document.querySelectorAll("[data-label]").forEach((section) => {
  sectionObserver.observe(section);
});

/* CONTACTO — validación básica; el envío real requiere backend */
const contactForm = document.getElementById("contactForm");
const contactStatus = document.getElementById("contactStatus");

contactForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const name = document.getElementById("contactName").value.trim();
  const email = document.getElementById("contactEmail").value.trim();
  const message = document.getElementById("contactMessage").value.trim();

  if (!name || !email || !message) {
    contactStatus.textContent = "Completa todos los campos antes de enviar.";
    contactStatus.classList.add("is-error");
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    contactStatus.textContent = "Revisa el formato del email.";
    contactStatus.classList.add("is-error");
    return;
  }

  contactStatus.classList.remove("is-error");
  contactStatus.textContent = "Mensaje enviado. Te respondemos pronto.";
  console.log("Contacto:", { name, email, message });
  contactForm.reset();
});
