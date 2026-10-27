/* PDF Watermark — stamped by pdf-lib (MIT), preview by pdf.js (Mozilla, Apache-2.0). Everything runs in this tab. */
import * as pdfjsLib from "./lib/pdf.min.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = "lib/pdf.worker.min.mjs";

const { $, $$, h } = S3;
const { PDFDocument, StandardFonts, rgb, degrees } = PDFLib;
const FONTS = { HelveticaBold: StandardFonts.HelveticaBold, Helvetica: StandardFonts.Helvetica, TimesRomanBold: StandardFonts.TimesRomanBold, CourierBold: StandardFonts.CourierBold };
const CSSF = { HelveticaBold: ["bold ", "Helvetica, Arial, sans-serif"], Helvetica: ["", "Helvetica, Arial, sans-serif"], TimesRomanBold: ["bold ", "'Times New Roman', Times, serif"], CourierBold: ["bold ", "'Courier New', Courier, monospace"] };
const DEF = { kind: "text", text: "CONFIDENTIAL", font: "HelveticaBold", color: "#d64545", size: 72, scale: 40, opacity: 25, rot: 45, mode: "center", gap: 80, range: "" };

// ---------- pure helpers ----------
const norm = r => ((r % 360) + 360) % 360;
function toUser(box, rot, X, Y) { // shown-page point (y up) -> PDF user space, for any /Rotate
  switch (norm(rot)) {
    case 90: return [box.x + box.w - Y, box.y + X];
    case 180: return [box.x + box.w - X, box.y + box.h - Y];
    case 270: return [box.x + Y, box.y + box.h - X];
    default: return [box.x + X, box.y + Y];
  }
}
const rotV = (deg, dx, dy) => { const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t); return [c * dx - s * dy, s * dx + c * dy]; };
function hexRgb(hex) { const n = parseInt(String(hex).slice(1), 16) || 0; return rgb((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255); }
function encodable(font, s) { try { font.encodeText(s); return true; } catch (e) { return false; } }
function parseRange(str, n) {
  const s = String(str || "").trim(), out = new Set();
  if (!s) { for (let i = 0; i < n; i++) out.add(i); return out; }
  s.split(/[,;]+/).forEach(part => {
    part = part.trim(); if (!part) return;
    const m = /^(\d*)\s*[-–]\s*(\d*)$/.exec(part); let a, b;
    if (m) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : n; } else if (/^\d+$/.test(part)) a = b = +part; else throw new Error("“" + part + "” isn't a page or range");
    if (a > b) [a, b] = [b, a];
    if (a < 1 || b > n) throw new Error("Page " + (a < 1 ? a : b) + " doesn't exist (" + n + " pages)");
    for (let p = a; p <= b; p++) out.add(p - 1);
  });
  if (!out.size) throw new Error("No pages selected");
  return out;
}
const isRtl = s => /[֐-ࣿ]/.test(s);
const measureCtx = document.createElement("canvas").getContext("2d");
function cssFont(key, px) { const f = CSSF[key] || CSSF.HelveticaBold; return f[0] + px + "px " + f[1]; }
function widthWith(font, key) { return (t, s) => { try { return font.widthOfTextAtSize(t, s); } catch (e) { measureCtx.font = cssFont(key, s); return measureCtx.measureText(t).width; } }; }
function textPng(text, size, color, key) { // for characters the standard fonts can't encode (Arabic…); baseline 0.3*size above the bottom
  const k = 4, c = document.createElement("canvas"), x = c.getContext("2d"); x.font = cssFont(key, size * k);
  c.width = Math.ceil(x.measureText(text).width) + 4; c.height = Math.ceil(size * 1.25 * k);
  x.font = cssFont(key, size * k); x.fillStyle = color; x.direction = isRtl(text) ? "rtl" : "ltr"; x.textAlign = "left";
  x.fillText(text, 2, size * 0.95 * k);
  return { src: c.toDataURL("image/png"), w: c.width / k, h: c.height / k };
}
// the stamp's local size and the local point that should sit on its visual centre
function markFor(cfg, W, widthOf, img) {
  if (cfg.kind === "image") { const w = W * cfg.scale / 100, hh = img ? w * img.h / img.w : w; return { w, h: hh, ox: w / 2, oy: hh / 2 }; }
  const w = widthOf(cfg.text, cfg.size); return { w, h: cfg.size * 0.75, ox: w / 2, oy: cfg.size * 0.36 };
}
// anchors (local origin: text baseline-left / image bottom-left) on a page shown W x H, y up
function placements(W, H, mark, cfg) {
  const anchor = (cx, cy) => { const [dx, dy] = rotV(cfg.rot, mark.ox, mark.oy); return [cx - dx, cy - dy]; };
  if (cfg.mode !== "tile") return [anchor(W / 2, H / 2)];
  const t = cfg.rot * Math.PI / 180, c = Math.abs(Math.cos(t)), s = Math.abs(Math.sin(t));
  const bw = mark.w * c + mark.h * s, bh = mark.w * s + mark.h * c, sx = Math.max(8, bw + cfg.gap), sy = Math.max(8, bh + cfg.gap), out = [];
  for (let r = 0, cy = H / 2; cy > -bh; r++, cy -= sy) for (const yy of r ? [H / 2 + r * sy, cy] : [cy]) {
    const off = r % 2 ? sx / 2 : 0;
    for (let cx = W / 2 + off; cx < W + bw; cx += sx) out.push(anchor(cx, yy));
    for (let cx = W / 2 + off - sx; cx > -bw; cx -= sx) out.push(anchor(cx, yy));
    if (out.length > 800) return out;
  }
  return out;
}
const shownSize = (box, rot) => rot % 180 ? [box.h, box.w] : [box.w, box.h];

async function loadLib(bytes) {
  try { return await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (e) { throw new Error(/encrypted/i.test(e && e.message) ? "This PDF is password-protected or encrypted. Remove the protection first." : "This file couldn't be read as a PDF."); }
}
function openJs(bytes) { return pdfjsLib.getDocument({ data: bytes.slice(), isEvalSupported: false, verbosity: 0 }).promise; }
// img: {src (png data URL), w, h} for image watermarks
async function stampPdf(bytes, cfg, img) {
  const doc = await loadLib(bytes), pages = doc.getPages(), sel = parseRange(cfg.range, pages.length), opacity = cfg.opacity / 100;
  const font = await doc.embedFont(FONTS[cfg.font] || StandardFonts.HelveticaBold), widthOf = widthWith(font, cfg.font), color = hexRgb(cfg.color);
  let image = null, tImg = null;
  if (cfg.kind === "image") image = await doc.embedPng(img.src);
  else if (!encodable(font, cfg.text)) { const t = textPng(cfg.text, cfg.size, cfg.color, cfg.font); tImg = Object.assign(t, { emb: await doc.embedPng(t.src) }); }
  for (let i = 0; i < pages.length; i++) {
    if (!sel.has(i)) continue;
    const pg = pages[i], cb = pg.getCropBox(), box = { x: cb.x, y: cb.y, w: cb.width, h: cb.height }, rot = norm(pg.getRotation().angle), [W, H] = shownSize(box, rot);
    const mark = markFor(cfg, W, widthOf, img), angle = degrees(cfg.rot + rot);
    for (const [ax, ay] of placements(W, H, mark, cfg)) {
      if (image) { const [x, y] = toUser(box, rot, ax, ay); pg.drawImage(image, { x, y, width: mark.w, height: mark.h, rotate: angle, opacity }); }
      else if (tImg) { const [dx, dy] = rotV(cfg.rot, -0.5, -cfg.size * 0.3), [x, y] = toUser(box, rot, ax + dx, ay + dy); pg.drawImage(tImg.emb, { x, y, width: tImg.w, height: tImg.h, rotate: angle, opacity }); }
      else { const [x, y] = toUser(box, rot, ax, ay); pg.drawText(cfg.text, { x, y, size: cfg.size, font, color, rotate: angle, opacity }); }
    }
  }
  return doc.save();
}

// ---------- UI ----------
const cfg = Object.assign({}, DEF, S3.store("wm.cfg") || {});
const st = { file: null, base: "", bytes: null, js: null, n: 0, sizes: [], pv: 0, sel: null, img: null };
const metricDoc = await PDFDocument.create(), metrics = {};
for (const k of Object.keys(FONTS)) metrics[k] = await metricDoc.embedFont(FONTS[k]);

function seg(el, value, onPick) {
  $$("button", el).forEach(b => {
    b.setAttribute("aria-pressed", String(b.dataset.v === value));
    b.addEventListener("click", () => { $$("button", el).forEach(x => x.setAttribute("aria-pressed", String(x === b))); onPick(b.dataset.v); });
  });
}
seg($("#kind"), cfg.kind, v => { cfg.kind = v; update(); });
seg($("#mode"), cfg.mode, v => { cfg.mode = v; update(); });
$("#chips").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { cfg.text = b.dataset.v; $("#text").value = cfg.text; update(); } });
const bind = [["#text", "text", String], ["#font", "font", String], ["#color", "color", String], ["#size", "size", Number], ["#scale", "scale", Number],
  ["#opacity", "opacity", Number], ["#rot", "rot", Number], ["#gap", "gap", Number], ["#range", "range", String]];
bind.forEach(([sel, key, cast]) => { $(sel).value = cfg[key]; $(sel).addEventListener("input", () => { cfg[key] = cast($(sel).value); update(); }); });
$("#rot").addEventListener("dblclick", () => { cfg.rot = 0; $("#rot").value = 0; update(); });

S3.drop($("#imgDrop"), files => {
  const f = files[0];
  S3.readFile(f, "dataurl").then(url => {
    const im = new Image();
    im.onload = () => {
      const s = Math.min(1, 1600 / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(im.naturalWidth * s)); c.height = Math.max(1, Math.round(im.naturalHeight * s));
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      setImage(c.toDataURL("image/png"), c.width, c.height, f.name);
    };
    im.onerror = () => S3.toast("That image couldn't be opened", "error");
    im.src = url;
  });
}, { accept: "image/*", multiple: false });
function setImage(src, w, hh, name) {
  const el = new Image(); el.src = src;
  st.img = { src, w, h: hh, el, name };
  el.onload = () => drawOverlay();
  const t = $("#imgThumb"); t.innerHTML = ""; t.appendChild(h("img", { src, alt: "" }));
  $("#imgName").textContent = name;
}

function update() {
  S3.store("wm.cfg", cfg);
  $("#pText").hidden = cfg.kind !== "text"; $("#pImage").hidden = cfg.kind !== "image";
  $("#gapBox").hidden = cfg.mode !== "tile";
  $("#sizeVal").textContent = cfg.size + " pt"; $("#scaleVal").textContent = cfg.scale + "% of page width";
  $("#opVal").textContent = cfg.opacity + "%"; $("#rotVal").textContent = cfg.rot + "°"; $("#gapVal").textContent = cfg.gap + " pt";
  $$("#chips button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === cfg.text)));
  if (!st.js) return;
  let err = "";
  try { st.sel = parseRange(cfg.range, st.n); } catch (e) { st.sel = null; err = e.message; }
  $("#rangeMsg").textContent = err; $("#rangeMsg").className = "faint" + (err ? " bad" : ""); $("#range").classList.toggle("bad", !!err);
  const ready = st.sel && (cfg.kind === "image" ? !!st.img : !!cfg.text.trim());
  $("#save").disabled = !ready;
  $("#fmeta").textContent = st.n + " page" + (st.n > 1 ? "s" : "") + " · " + S3.fmtBytes(st.file.size) + (st.sel ? " · " + st.sel.size + " will be stamped" : "");
  drawOverlay();
}

// preview
let gen = 0;
async function showPage(i) {
  if (!st.js) return;
  st.pv = Math.max(0, Math.min(st.n - 1, i));
  const g = ++gen, pg = $("#page"), [W, H] = st.sizes[st.pv];
  pg.style.aspectRatio = W + " / " + H; pg.style.width = "min(100%, " + (60 * W / H).toFixed(2) + "vh)";
  $("#pageNo").textContent = "Page " + (st.pv + 1) + " of " + st.n;
  $("#prev").disabled = st.pv === 0; $("#next").disabled = st.pv === st.n - 1;
  $$("canvas.wm-base", pg).forEach(c => c.remove());
  drawOverlay();
  try {
    const page = await st.js.getPage(st.pv + 1), w = pg.getBoundingClientRect().width || 500, dpr = Math.min(2, window.devicePixelRatio || 1);
    const vp = page.getViewport({ scale: w * dpr / W }), c = h("canvas", { "class": "wm-base" });
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    if (g === gen) { $$("canvas.wm-base", pg).forEach(x => x.remove()); pg.insertBefore(c, pg.firstChild); }
  } catch (e) { /* preview is best-effort */ }
}
function drawOverlay() {
  const ov = $("#ov"), pg = $("#page"), r = pg.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  if (!st.sizes.length || !r.width) return;
  const [W, H] = st.sizes[st.pv], k = r.width * dpr / W;
  ov.width = Math.round(r.width * dpr); ov.height = Math.round(r.height * dpr);
  const x = ov.getContext("2d"); x.clearRect(0, 0, ov.width, ov.height);
  const on = st.sel && st.sel.has(st.pv), cap = $("#cap");
  if (!st.sel) { cap.textContent = "Fix the page range to see the preview."; return; }
  if (!on) { cap.textContent = "This page is outside the page range, so it stays as it is."; return; }
  if (cfg.kind === "image" && !st.img) { cap.textContent = "Choose an image to see it here."; return; }
  if (cfg.kind === "text" && !cfg.text.trim()) { cap.textContent = "Type the watermark text."; return; }
  const mark = markFor(cfg, W, widthWith(metrics[cfg.font] || metrics.HelveticaBold, cfg.font), st.img), spots = placements(W, H, mark, cfg);
  x.globalAlpha = cfg.opacity / 100; x.fillStyle = cfg.color; x.textBaseline = "alphabetic"; x.textAlign = "left";
  x.font = cssFont(cfg.font, cfg.size * k); x.direction = isRtl(cfg.text) ? "rtl" : "ltr";
  spots.forEach(([ax, ay]) => {
    x.save(); x.translate(ax * k, (H - ay) * k); x.rotate(-cfg.rot * Math.PI / 180);
    if (cfg.kind === "image") x.drawImage(st.img.el, 0, -mark.h * k, mark.w * k, mark.h * k); else x.fillText(cfg.text, 0, 0);
    x.restore();
  });
  cap.textContent = (cfg.mode === "tile" ? spots.length + " copies on this page" : "Centred") + " · " + cfg.opacity + "% opacity · " + cfg.rot + "°";
}
if ("ResizeObserver" in window) new ResizeObserver(S3.debounce(() => { if (st.js) showPage(st.pv); }, 120)).observe($("#page").parentNode);
$("#prev").addEventListener("click", () => showPage(st.pv - 1));
$("#next").addEventListener("click", () => showPage(st.pv + 1));

async function openFile(file) {
  try {
    const bytes = new Uint8Array(await S3.readFile(file)), doc = await loadLib(bytes);
    const sizes = doc.getPages().map(p => { const b = p.getCropBox(); return shownSize({ w: b.width, h: b.height }, norm(p.getRotation().angle)); });
    let js; try { js = await openJs(bytes); } catch (e) { throw new Error("This file couldn't be read as a PDF."); }
    if (st.js) st.js.destroy();
    Object.assign(st, { file, base: file.name.replace(/\.pdf$/i, "") || "document", bytes, js, n: sizes.length, sizes });
    $("#fname").textContent = file.name;
    $("#dropCard").hidden = true; $("#work").hidden = false;
    update();
    await showPage(0);
  } catch (e) { S3.toast(e.message, "error"); }
}
const fileInput = S3.drop($("#drop"), files => openFile(files[0]), { accept: ".pdf,application/pdf", multiple: false });
$("#change").addEventListener("click", () => fileInput.click());

$("#save").addEventListener("click", async () => {
  if (!st.bytes || !st.sel) return;
  const b = $("#save"); b.disabled = true;
  try {
    const out = await stampPdf(st.bytes, cfg, st.img);
    S3.download(new Blob([out], { type: "application/pdf" }), st.base + "-watermarked.pdf");
    S3.toast("Watermarked " + st.sel.size + " page" + (st.sel.size > 1 ? "s" : "")); S3.done();
  } catch (e) { S3.toast("Couldn't save: " + (e && e.message || e), "error"); }
  b.disabled = false;
});
update();

// ---------- sample + self-test ----------
async function samplePdf() {
  const d = await PDFDocument.create(), f = await d.embedFont(StandardFonts.Helvetica), fb = await d.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.16, 0.18, 0.22), grey = rgb(0.5, 0.53, 0.58), bar = rgb(0.9, 0.91, 0.93);
  for (let i = 0; i < 3; i++) {
    const p = d.addPage([595.28, 841.89]), H = p.getHeight();
    p.drawRectangle({ x: 0, y: H - 8, width: 595.28, height: 8, color: rgb(0.05, 0.62, 0.6) });
    p.drawText(["Q3 Product Roadmap", "Launch timeline", "Budget"][i], { x: 56, y: H - 80, size: 24, font: fb, color: ink });
    p.drawText("Internal · prepared by the product team", { x: 56, y: H - 104, size: 11, font: f, color: grey });
    for (let l = 0; l < 22; l++) p.drawRectangle({ x: 56, y: H - 150 - l * 26, width: 483 - ((l * 59 + i * 17) % 170), height: 9, color: bar });
    p.drawRectangle({ x: 56, y: 90, width: 230, height: 120, color: rgb(0.86, 0.95, 0.94) });
    p.drawRectangle({ x: 309, y: 90, width: 230, height: 120, color: rgb(0.93, 0.91, 0.98) });
  }
  return d.save();
}
window.S3_DEMO = async () => {
  Object.assign(cfg, DEF);
  bind.forEach(([sel, key]) => { $(sel).value = cfg[key]; });
  $$("#kind button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === "text")));
  $$("#mode button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v === "center")));
  await openFile(new File([await samplePdf()], "Q3 roadmap.pdf", { type: "application/pdf" }));
  await new Promise(r => setTimeout(r, 700));
};

window.S3_SELFTEST = async () => {
  const fails = [], ok = (c, m) => { if (!c) fails.push(m); };
  const d = await PDFDocument.create(); d.addPage([595.28, 841.89]); d.addPage([842, 595]);
  const r3 = d.addPage([400, 600]); r3.setMediaBox(20, 30, 400, 600); r3.setRotation(degrees(90));
  const bytes = await d.save();
  const c1 = Object.assign({}, DEF, { text: "CONFIDENTIAL", size: 60, rot: 45, range: "1,3", opacity: 30 });
  const out = await stampPdf(bytes, c1, null), js = await openJs(out), PU = pdfjsLib.Util;
  const w = metrics.HelveticaBold.widthOfTextAtSize("CONFIDENTIAL", 60);
  for (const n of [1, 2, 3]) {
    const pg = await js.getPage(n), vp = pg.getViewport({ scale: 1 }), items = (await pg.getTextContent()).items.filter(t => t.str.trim());
    if (n === 2) { ok(items.length === 0, "page outside the range left alone"); continue; }
    const t = items.find(x => x.str === "CONFIDENTIAL");
    ok(!!t, "watermark text on page " + n);
    if (!t) continue;
    const m = PU.transform(vp.transform, t.transform), ang = Math.atan2(-m[1], m[0]) * 180 / Math.PI;
    const th = 45 * Math.PI / 180, cx = m[4] + Math.cos(th) * w / 2 - Math.sin(th) * 60 * 0.36, cy = m[5] - Math.sin(th) * w / 2 - Math.cos(th) * 60 * 0.36;
    ok(Math.abs(ang - 45) < 0.5, "page " + n + " reads at 45° as shown (" + ang.toFixed(1) + ")");
    ok(Math.abs(cx - vp.width / 2) < 1.5 && Math.abs(cy - vp.height / 2) < 1.5, "page " + n + " centred (" + cx.toFixed(1) + "," + cy.toFixed(1) + " vs " + vp.width / 2 + "," + vp.height / 2 + ")");
  }
  js.destroy();
  // image watermark at 50% opacity: a red square over white turns pink
  const sq = document.createElement("canvas"); sq.width = sq.height = 40; const sx = sq.getContext("2d"); sx.fillStyle = "#ff0000"; sx.fillRect(0, 0, 40, 40);
  const c2 = Object.assign({}, DEF, { kind: "image", scale: 20, rot: 0, opacity: 50, range: "2" });
  const js2 = await openJs(await stampPdf(bytes, c2, { src: sq.toDataURL("image/png"), w: 40, h: 40 })), pg2 = await js2.getPage(2), vp2 = pg2.getViewport({ scale: 1 }), cv = document.createElement("canvas");
  cv.width = Math.round(vp2.width); cv.height = Math.round(vp2.height);
  const cx2 = cv.getContext("2d"); await pg2.render({ canvasContext: cx2, viewport: vp2 }).promise;
  const mid = cx2.getImageData(421, 297, 1, 1).data, edge = cx2.getImageData(421 + 90, 297, 1, 1).data;
  ok(mid[0] > 235 && mid[1] > 105 && mid[1] < 150 && mid[2] > 105 && mid[2] < 150, "50% opacity image in the centre " + Array.from(mid).join());
  ok(edge[1] > 240, "image sized to 20% of page width");
  js2.destroy();
  // tiling covers the page; Arabic text still stamps (as an image)
  const tiles = placements(595, 842, markFor(Object.assign({}, DEF, { size: 36 }), 595, widthWith(metrics.HelveticaBold, "HelveticaBold")), Object.assign({}, DEF, { mode: "tile", gap: 60 }));
  ok(tiles.length >= 8 && tiles.length < 200, "tiled copies: " + tiles.length);
  const ar = await PDFDocument.load(await stampPdf(bytes, Object.assign({}, DEF, { text: "سري للغاية", range: "1" }), null));
  ok(ar.getPageCount() === 3, "Arabic watermark saved");
  let bad = ""; try { parseRange("0-2", 3); } catch (e) { bad = e.message; }
  ok(/doesn't exist/.test(bad) && [...parseRange("3-1", 3)].join() === "0,1,2", "page ranges");
  return fails.length ? fails : true;
};
