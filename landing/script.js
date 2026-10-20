/* RE WALLET - LANDING PAGE SCRIPT */

/* ---------------------------------------------------------------------------
   APP_URL — URL de la app (worker de Cloudflare que sirve el SPA + API).

   Esta landing se despliega sola en Cloudflare Pages; la app vive en un
   worker separado. Reemplazar la URL de producción cuando el worker esté
   desplegado. En dev local apunta al Vite (:3000).
--------------------------------------------------------------------------- */
const IS_LOCAL =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";
const APP_URL = IS_LOCAL
  ? "http://127.0.0.1:3000"
  : "https://TODO-reemplazar-por-el-worker";
/* API — en dev es el server Express (:3001); en prod, el mismo worker. */
const API_URL = IS_LOCAL ? "http://127.0.0.1:3001" : APP_URL;

/* ---------------------------------------------------------------------------
   MÉTRICAS — valores reales vía GET /api/landing/metrics.

   El server consulta el Dashboard API de Dynamic
   (GET /environments/:environmentId/analytics/topline, scope
   environment.analytics.read) y cachea el snapshot en SQLite: el token de
   Dynamic NUNCA llega al cliente. Si la API responde distinto o falla, la
   franja se anima con ceros (fail-soft).
--------------------------------------------------------------------------- */
const METRICS = {
  users: 0,
  wallets: 0,
  sessions: 0,
};

const metricsReady = fetch(`${API_URL}/api/landing/metrics`)
  .then((res) => (res.ok ? res.json() : null))
  .then((data) => {
    if (!data) return;
    METRICS.users = Number(data.users) || 0;
    METRICS.wallets = Number(data.wallets) || 0;
    METRICS.sessions = Number(data.sessions) || 0;
  })
  .catch(() => {
    /* offline o API caída: se animan ceros */
  });

const demoBtn = document.querySelector(".demo-btn");

/* DEMO DEVNET - navega a la app (worker en prod, Vite en dev local) */
demoBtn.addEventListener("click", () => {
  window.location.href = APP_URL;
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

/* Se observa recién cuando el fetch de métricas asentó, para que la
   animación use los valores reales y no los ceros iniciales. */
metricsReady.then(() => {
  document.querySelectorAll("[data-metric]").forEach((el) => {
    metricsObserver.observe(el);
  });
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

/* OPINION WIZARD — validación paso a paso + envío al API + progreso. */
const opinionForm = document.getElementById("opinionForm");
const opinionStatus = document.getElementById("opinionStatus");
const opinionSuccess = document.getElementById("opinionSuccess");
const surveyProgress = document.getElementById("surveyProgress");
const surveyProgressLabel = document.getElementById("surveyProgressLabel");

const wizardSteps = opinionForm.querySelectorAll(".wizard-step");
const TOTAL_STEPS = wizardSteps.length;
let currentStep = 1;

const STEP_NAMES = [
  "Nombre y apellido",
  "Pregunta 1",
  "Pregunta 2",
  "Pregunta 3",
  "Pregunta 4",
];

const selectedRadio = (name) =>
  opinionForm.querySelector(`input[name="${name}"]:checked`)?.value ?? "";

function validateStep(step) {
  if (step === 1) {
    const name = document.getElementById("opinionName").value.trim();
    const lastName = document.getElementById("opinionLastName").value.trim();
    const email = document.getElementById("opinionEmail").value.trim();
    if (!name || !lastName) return "Completá tu nombre y apellido.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Revisá el formato del email.";
    return null;
  }
  if (step === 2 && !selectedRadio("q1")) return "Elegí una opción.";
  if (step === 3 && opinionForm.querySelectorAll('input[name="q2"]:checked').length === 0)
    return "Elegí al menos una opción.";
  if (step === 4 && !selectedRadio("q3")) return "Elegí una opción.";
  return null;
}

function updateProgress() {
  const steps = [
    Boolean(
      document.getElementById("opinionName").value.trim() &&
      document.getElementById("opinionLastName").value.trim() &&
      document.getElementById("opinionEmail").value.trim(),
    ),
    Boolean(selectedRadio("q1")),
    opinionForm.querySelectorAll('input[name="q2"]:checked').length > 0,
    Boolean(selectedRadio("q3")),
    Boolean(selectedRadio("q4")),
  ];

  surveyProgress.querySelectorAll(".step").forEach((el, i) => {
    el.classList.toggle("is-done", steps[i]);
    el.classList.toggle("is-current", i + 1 === currentStep);
  });

  surveyProgressLabel.textContent =
    currentStep === TOTAL_STEPS && steps.every(Boolean)
      ? "Listo para enviar"
      : `Paso ${currentStep} de ${TOTAL_STEPS}: ${STEP_NAMES[currentStep - 1]}`;
}

function goToStep(n) {
  wizardSteps.forEach((el) => el.classList.remove("is-active"));
  wizardSteps[n - 1].classList.add("is-active");
  currentStep = n;
  updateProgress();
  opinionForm.querySelector(`.wizard-step[data-step="${n}"]`).scrollIntoView({
    behavior: prefersReducedMotion.matches ? "auto" : "smooth",
    block: "start",
  });
}

opinionForm.addEventListener("click", (event) => {
  const nextBtn = event.target.closest(".wizard-next");
  const backBtn = event.target.closest(".wizard-back");

  if (nextBtn) {
    const error = validateStep(currentStep);
    if (error) {
      opinionStatus.textContent = error;
      opinionStatus.classList.add("is-error");
      return;
    }
    opinionStatus.classList.remove("is-error");
    opinionStatus.textContent = "";
    goToStep(currentStep + 1);
  }

  if (backBtn) {
    goToStep(currentStep - 1);
  }
});

opinionForm.addEventListener("input", updateProgress);
opinionForm.addEventListener("change", updateProgress);

opinionForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const name = document.getElementById("opinionName").value.trim();
  const lastName = document.getElementById("opinionLastName").value.trim();
  const email = document.getElementById("opinionEmail").value.trim();

  const answers = {
    q1: selectedRadio("q1"),
    q2: [...opinionForm.querySelectorAll('input[name="q2"]:checked')].map(
      (input) => input.value,
    ),
    q3: selectedRadio("q3"),
    q4: selectedRadio("q4"),
  };

  opinionStatus.classList.remove("is-error");
  opinionStatus.textContent = "";

  try {
    const response = await fetch(`${API_URL}/api/landing/survey`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, lastName, email, ...answers }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch {
    opinionStatus.textContent = "No se pudo guardar tu respuesta. Intentá de nuevo.";
    opinionStatus.classList.add("is-error");
    return;
  }

  opinionForm.hidden = true;
  opinionSuccess.hidden = false;
  opinionSuccess.scrollIntoView({
    behavior: prefersReducedMotion.matches ? "auto" : "smooth",
    block: "center",
  });
});

document.getElementById("successDemoBtn").addEventListener("click", () => {
  window.location.href = APP_URL;
});
