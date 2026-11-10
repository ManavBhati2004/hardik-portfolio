import { createViewer } from "./viewer.js";

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const loader = $("loader");
const telemetry = $("telemetry");
if (params.has("stats")) telemetry.hidden = false;

addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() === "s" && !e.metaKey && !e.ctrlKey) telemetry.hidden = !telemetry.hidden;
});

const fmt = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });

try {
  await createViewer($("scene"), {
    model: params.get("model") ?? "/models/station.glb",
    quality: params.get("quality") ?? "auto",
    debug: params.has("debug"),
    onProgress: (p) => {
      $("bar").style.transform = `scaleX(${p})`;
      loader.setAttribute("aria-valuenow", Math.round(p * 100));
    },
    onStats: (s) => {
      $("t-fps").textContent = s.fps;
      $("t-calls").textContent = s.calls;
      $("t-tris").textContent = fmt.format(s.triangles);
      $("t-tier").textContent = s.tier;
    },
  });
  loader.classList.add("done");
  document.body.classList.add("ready");
} catch (err) {
  console.error(err);
  loader.querySelector(".eyebrow").textContent = "Could not load the model";
  loader.classList.add("error");
}
