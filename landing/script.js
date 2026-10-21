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
/* La URL de la app sale del <meta name="re-wallet-app-url"> del HTML: es el
   único punto que hay que tocar cuando la landing se despliega en un host
   propio. Sin configurarla cae en el origen que sirve la página, que es lo
   correcto cuando la landing y la app se sirven juntas (el build copia
   landing/ dentro de dist/). */
const CONFIGURED_APP_URL = (
  document.querySelector('meta[name="re-wallet-app-url"]')?.content ?? ""
).trim();
// Vacío o placeholder = la landing y la app se sirven juntas, así que el
// origen actual ES la app. Un placeholder sin detectar haría que el botón
// de demo apuntara a un host que no existe.
const HAS_APP_URL =
  CONFIGURED_APP_URL !== "" && !CONFIGURED_APP_URL.includes("TU-APP-URL");
const APP_URL = IS_LOCAL
  ? "http://127.0.0.1:3000"
  : HAS_APP_URL
    ? CONFIGURED_APP_URL
    : window.location.origin;
/* API — en dev es el server Express (:3001); en prod, el mismo worker. */
const API_URL = IS_LOCAL ? "http://127.0.0.1:3001" : APP_URL || window.location.origin;

/* ---------------------------------------------------------------------------
   MÉTRICAS — valores reales vía GET /api/landing/metrics.

   El server consulta el Dashboard API de Dynamic
   (GET /environments/:environmentId/analytics/topline, scope
   environment.analytics.read) y cachea el snapshot en SQLite: el token de
   Dynamic NUNCA llega al cliente. Si la API responde distinto o falla, la
   franja se anima con ceros (fail-soft).
--------------------------------------------------------------------------- */
const METRICS = {
  // De Dynamic (adopción).
  users: 0,
  wallets: 0,
  sessions: 0,
  // Del ledger (economía de pagos).
  transactions: 0,
  volumeUsdc: 0,
  successRate: 0,
  avgProcessingMs: 0,
};

const metricsReady = fetch(`${API_URL}/api/landing/metrics`)
  .then((res) => (res.ok ? res.json() : null))
  .then((data) => {
    if (!data) return;
    // Cada contador se toma por separado: un campo ausente deja su métrica
    // en cero en vez de romper la franja entera.
    for (const key of Object.keys(METRICS)) {
      METRICS[key] = Number(data[key]) || 0;
    }
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

/* MÉTRICAS — cuenta animada al entrar en viewport.

   Cada métrica tiene su formato: los conteos son enteros, el volumen lleva
   dos decimales, la tasa un porcentaje y el tiempo se muestra en segundos
   (el API lo entrega en milisegundos). */
const METRIC_FORMATS = {
  int: (value) => Math.round(value).toLocaleString("es"),
  decimal: (value) =>
    value.toLocaleString("es", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
  percent: (value) =>
    `${value.toLocaleString("es", { maximumFractionDigits: 1 })}%`,
  seconds: (value) =>
    `${(value / 1000).toLocaleString("es", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}s`,
};

function animateCount(el, target, duration = 1400) {
  const start = performance.now();
  const format = METRIC_FORMATS[el.dataset.format] || METRIC_FORMATS.int;

  const frame = (now) => {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = format(target * eased);

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
/* ---------------------------------------------------------------------------
   ENCUESTA — DESCONECTADA.

   El formulario de opinión vivía acá y posteaba a POST /api/landing/survey.
   Ahora la encuesta vive dentro de la app (la tarjeta del home), que es
   donde el usuario ya está identificado. Esta landing queda con la llamada
   a la acción de partner.
--------------------------------------------------------------------------- */
