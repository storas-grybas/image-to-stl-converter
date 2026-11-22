// freeimagetostl.com converter UI. Everything happens on this page: the image is read with
// createImageBitmap, processed by relief-core.js and saved with a Blob URL. No upload, no server.
import { imageToSTL, triangleCount } from "./relief-core.js";

const $ = (id) => document.getElementById(id);
const MAX_SIDE = 2000; // larger pictures are scaled down locally before sampling

const DEFAULTS = {
  relief: { samples: 200, smoothing: 1, invert: false },
  litho: { samples: 250, smoothing: 0, invert: false },
};

const ui = {
  mode: "relief",
  img: null, // { rgba, w, h, name }
  last: null,
  timer: 0,
  view: null,
};

// ---------- reading controls ----------
function readOptions() {
  const n = (id) => parseFloat($(id).value);
  const o = {
    mode: ui.mode,
    widthMM: n("f-width"),
    samples: n("f-res"),
    smoothing: n("f-smooth"),
    invert: $("f-invert").checked,
  };
  if (ui.mode === "litho") {
    o.minMM = n("f-min");
    o.maxMM = Math.max(n("f-max"), o.minMM + 0.2);
    o.frameMM = $("f-frame-on").checked ? n("f-frame") : 0;
  } else {
    o.baseMM = n("f-base");
    o.reliefMM = n("f-relief");
  }
  return o;
}

function syncOutputs() {
  document.querySelectorAll(".ctl input[type=range]").forEach((r) => {
    const out = document.querySelector(`output[for="${r.id}"]`);
    if (out) out.textContent = r.value + (r.dataset.unit || "");
  });
}

function setMode(mode) {
  ui.mode = mode;
  document.querySelectorAll("[data-mode]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.mode === mode)));
  $("tool").dataset.mode = mode;
  const d = DEFAULTS[mode];
  $("f-res").value = d.samples;
  $("f-smooth").value = d.smoothing;
  $("f-invert").checked = d.invert;
  $("invert-hint").textContent = mode === "litho" ? "Off: dark areas print thicker, as a lithophane needs." : "Off: bright areas are raised.";
  syncOutputs();
  schedule();
}

// ---------- images ----------
async function loadFile(file) {
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    status(`That file is ${file.type || "an unknown type"}. Use a JPG, PNG or WebP image.`, true);
    return;
  }
  try {
    const bmp = await createImageBitmap(file);
    useBitmap(bmp, file.name.replace(/\.[^.]+$/, ""));
  } catch (e) {
    status("Your browser could not decode that image. Try saving it again as PNG or JPG.", true);
  }
}

function useBitmap(src, name) {
  const scale = Math.min(1, MAX_SIDE / Math.max(src.width, src.height));
  const w = Math.max(2, Math.round(src.width * scale)), h = Math.max(2, Math.round(src.height * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(src, 0, 0, w, h);
  ui.img = { rgba: g.getImageData(0, 0, w, h).data, w, h, name: slug(name) || "image" };
  $("src-name").textContent = `${name} · ${src.width} × ${src.height} px${scale < 1 ? ` (read at ${w} × ${h})` : ""}`;
  schedule(0);
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/** Built-in sample so the preview is never empty: a sun over mountain ridges. */
function sampleImage() {
  const c = document.createElement("canvas");
  c.width = 800; c.height = 560;
  const g = c.getContext("2d");
  const sky = g.createLinearGradient(0, 0, 0, 560);
  sky.addColorStop(0, "#1b1f3b"); sky.addColorStop(0.55, "#8f8fb8"); sky.addColorStop(1, "#f1eee8");
  g.fillStyle = sky; g.fillRect(0, 0, 800, 560);
  const sun = g.createRadialGradient(560, 190, 10, 560, 190, 120);
  sun.addColorStop(0, "#ffffff"); sun.addColorStop(0.45, "#fff6dc"); sun.addColorStop(1, "rgba(255,246,220,0)");
  g.fillStyle = sun; g.beginPath(); g.arc(560, 190, 120, 0, Math.PI * 2); g.fill();
  const ridge = (y0, amp, seed, col) => {
    g.fillStyle = col; g.beginPath(); g.moveTo(0, 560);
    for (let x = 0; x <= 800; x += 8) g.lineTo(x, y0 - amp * (0.55 * Math.sin(x / 97 + seed) + 0.3 * Math.sin(x / 41 + seed * 2) + 0.15 * Math.sin(x / 13 + seed * 3)));
    g.lineTo(800, 560); g.closePath(); g.fill();
  };
  ridge(330, 70, 1.2, "#5a5a86"); ridge(400, 60, 2.7, "#34345a"); ridge(470, 45, 4.1, "#191930");
  useBitmap(c, "sample-mountains");
}

// ---------- build ----------
function schedule(delay = 140) {
  clearTimeout(ui.timer);
  ui.timer = setTimeout(build, delay);
}

function build() {
  if (!ui.img) return;
  const o = readOptions();
  let r;
  try {
    r = imageToSTL(ui.img.rgba, ui.img.w, ui.img.h, o);
  } catch (e) {
    status("Could not build the model: " + e.message, true);
    return;
  }
  ui.last = { ...r, opts: o };
  const [x, y, z] = r.mesh.size;
  $("o-dims").textContent = `${x.toFixed(1)} × ${y.toFixed(1)} × ${z.toFixed(1)} mm`;
  $("o-tris").textContent = r.mesh.triangles.toLocaleString("en-US");
  $("o-size").textContent = mb(r.stl.byteLength);
  $("o-grid").textContent = `${r.field.nx} × ${r.field.ny} (${r.field.spacing.toFixed(2)} mm)`;
  $("o-time").textContent = `${Math.round(r.ms)} ms`;
  $("dl").disabled = false;
  status(r.mesh.triangles > 600000 ? "Large file. Lower the resolution if your slicer struggles." : "Ready. Drag the preview to rotate, scroll to zoom.");
  drawMap(r, o);
  drawView(r.mesh);
}

const mb = (bytes) => (bytes >= 1e6 ? (bytes / 1e6).toFixed(1) + " MB" : Math.round(bytes / 1e3) + " KB");

function status(msg, bad = false) {
  const s = $("o-msg");
  s.textContent = msg;
  s.classList.toggle("bad", bad);
}

/** 2D view: height map for reliefs, simulated backlight for lithophanes. */
function drawMap(r, o) {
  const { z, nx, ny } = r.field;
  const cv = $("map");
  cv.width = nx; cv.height = ny;
  const g = cv.getContext("2d");
  const im = g.createImageData(nx, ny);
  let lo = Infinity, hi = -Infinity;
  for (const v of z) { if (v < lo) lo = v; if (v > hi) hi = v; }
  for (let k = 0; k < z.length; k++) {
    const q = k * 4;
    if (o.mode === "litho") {
      const b = Math.exp(-0.95 * (z[k] - o.minMM)); // thicker plastic lets less light through
      im.data[q] = 255 * b; im.data[q + 1] = 238 * b; im.data[q + 2] = 205 * b;
    } else {
      const t = hi > lo ? (z[k] - lo) / (hi - lo) : 0;
      im.data[q] = im.data[q + 1] = im.data[q + 2] = 255 * t;
    }
    im.data[q + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  $("map-label").textContent = o.mode === "litho" ? "Backlit simulation" : "Height map (white = highest)";
}

// ---------- 3D preview (three.js served from /vendor, loaded on demand) ----------
async function drawView(mesh) {
  try {
    if (!ui.view) ui.view = await createViewer($("view"));
    ui.view.show(mesh, ui.mode);
  } catch (e) {
    $("view").classList.add("no-gl");
    $("view").textContent = "3D preview needs WebGL, which this browser has turned off. The STL download still works.";
  }
}

async function createViewer(host) {
  const THREE = await import("three");
  const { OrbitControls } = await import("../../vendor/OrbitControls.js");
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  host.textContent = "";
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4f4fb);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 5000);
  camera.up.set(0, 0, 1);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8888aa, 0.9));
  const sunLight = new THREE.DirectionalLight(0xffffff, 3.2); // low raking light shows the relief
  sunLight.position.set(-60, -40, 120);
  scene.add(sunLight);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  let model = null, framedFor = "";

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(host);
  resize();
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

  return {
    show(mesh, mode) {
      if (model) { scene.remove(model); model.geometry.dispose(); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
      geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
      geo.computeVertexNormals();
      const [x, y, z] = mesh.size;
      geo.translate(-x / 2, -y / 2, 0);
      model = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        color: mode === "litho" ? 0xf3efe6 : 0xc7cbff, roughness: 0.55, metalness: 0.02,
      }));
      scene.add(model);
      const key = `${x.toFixed(0)}x${y.toFixed(0)}`;
      if (key !== framedFor) {
        framedFor = key;
        const d = Math.max(x, y);
        camera.position.set(0, -d * 1.15, d * 1.05);
        controls.target.set(0, 0, z / 2);
        camera.near = d / 100; camera.far = d * 20;
        sunLight.position.set(-d, d * 0.7, d * 0.45);
        camera.updateProjectionMatrix();
      }
    },
  };
}

// ---------- download ----------
function download() {
  if (!ui.last) return;
  const o = ui.last.opts;
  const name = `${ui.img.name}-${o.mode === "litho" ? "lithophane" : "heightmap"}-${Math.round(o.widthMM)}mm.stl`;
  const url = URL.createObjectURL(new Blob([ui.last.stl], { type: "model/stl" }));
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  status(`Saved ${name} (${mb(ui.last.stl.byteLength)}). Nothing left your computer.`);
}

// ---------- wiring ----------
function init() {
  document.querySelectorAll("[data-mode]").forEach((b) => b.addEventListener("click", () => setMode(b.dataset.mode)));
  document.querySelectorAll(".ctl input").forEach((el) => el.addEventListener("input", () => { syncOutputs(); schedule(); }));
  $("f-file").addEventListener("change", (e) => loadFile(e.target.files[0]));
  const drop = $("drop");
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => loadFile(e.dataTransfer.files[0]));
  window.addEventListener("paste", (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith("image/"));
    if (item) loadFile(item.getAsFile());
  });
  $("sample").addEventListener("click", sampleImage);
  $("dl").addEventListener("click", download);
  syncOutputs();
  sampleImage();
}

// exposed for our automated checks only; it reports the last build, it does not send anything
window.fitsReport = () => ui.last && { triangles: ui.last.mesh.triangles, expected: triangleCount(ui.last.field.nx, ui.last.field.ny), size: ui.last.mesh.size, ms: ui.last.ms, bytes: ui.last.stl.byteLength };

init();
