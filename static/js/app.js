const $ = (selector) => document.querySelector(selector);
const toast = $("#toast");
function showToast(message) {
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

// Theme preferences
function applyTheme(mode) {
  const theme = mode === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : mode;
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("formcheck-theme", mode);
  const toggle = $("#themeToggle");
  if (toggle) toggle.innerHTML = theme === "dark" ? "☀ <span>Light mode</span>" : "☾ <span>Dark mode</span>";
  document.querySelectorAll(".mode-choice").forEach(btn => btn.classList.toggle("selected", btn.dataset.mode === mode));
}
applyTheme(localStorage.getItem("formcheck-theme") || "light");
$("#themeToggle")?.addEventListener("click", () => {
  const current = document.documentElement.dataset.theme;
  applyTheme(current === "dark" ? "light" : "dark");
});
document.querySelectorAll(".mode-choice").forEach(btn => btn.addEventListener("click", () => applyTheme(btn.dataset.mode)));
$("#mobileMenu")?.addEventListener("click", () => $("#sidebar")?.classList.toggle("open"));

// Upload and OCR workflow with Multi-Mode support
const input = $("#documents"), dropzone = $("#dropzone"), fileList = $("#fileList"), form = $("#uploadForm"), analyzeBtn = $("#analyzeBtn");
let selectedFiles = [];
const formatSize = bytes => bytes < 1024*1024 ? (bytes/1024).toFixed(1)+" KB" : (bytes/1024/1024).toFixed(1)+" MB";
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c])); }
function renderFiles() {
  if (!fileList) return;
  fileList.innerHTML = selectedFiles.map((file, i) => `<div class="file-item"><span class="file-badge">${escapeHtml(file.name.split(".").pop().toUpperCase())}</span><div class="file-meta"><b>${escapeHtml(file.name)}</b><small>${formatSize(file.size)}</small></div><button type="button" class="remove-file" data-index="${i}" aria-label="Remove file">×</button></div>`).join("");
}

window.clearSelectedFiles = function() {
  selectedFiles = [];
  renderFiles();
};

function addFiles(files) {
  const mode = $("#analysisModeInput")?.value || "single";
  const maxLimit = mode === "single" ? 1 : (mode === "reference" ? 2 : 10);

  [...files].forEach(file => {
    const ext = "." + file.name.split(".").pop().toLowerCase();
    if (![".pdf",".png",".jpg",".jpeg"].includes(ext)) return showToast("Unsupported file type: " + file.name);
    if (file.size > 15*1024*1024) return showToast(file.name + " exceeds the 15 MB limit.");
    if (selectedFiles.some(f => f.name === file.name && f.size === file.size)) return;
    
    if (selectedFiles.length >= maxLimit) {
      if (mode === "single") return showToast("Single Document Validation allows only 1 file.");
      if (mode === "reference") return showToast("Reference-Based Verification allows exactly 2 files (1 form, 1 reference).");
      return;
    }
    selectedFiles.push(file);
  });
  renderFiles();
}

input?.addEventListener("change", e => { addFiles(e.target.files); input.value = ""; });
fileList?.addEventListener("click", e => {
  const btn = e.target.closest(".remove-file"); if (!btn) return;
  selectedFiles.splice(Number(btn.dataset.index), 1); renderFiles();
});
dropzone?.addEventListener("dragover", e => { e.preventDefault(); dropzone.classList.add("dragover"); });
dropzone?.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone?.addEventListener("drop", e => { e.preventDefault(); dropzone.classList.remove("dragover"); addFiles(e.dataTransfer.files); });

form?.addEventListener("submit", async e => {
  e.preventDefault();
  if (!selectedFiles.length) return showToast("Please select at least one document.");
  
  const mode = $("#analysisModeInput")?.value || "single";
  if (mode === "single" && selectedFiles.length !== 1) {
    return showToast("Please upload exactly 1 document for Single Document Validation.");
  }
  if (mode === "reference" && selectedFiles.length !== 2) {
    return showToast("Please upload exactly 2 documents (1 form and 1 reference) for Reference-Based Verification.");
  }
  if (mode === "cross" && selectedFiles.length < 2) {
    return showToast("Please upload at least 2 documents for Cross-Document Comparison.");
  }

  const data = new FormData();
  selectedFiles.forEach(file => data.append("documents", file));
  data.append("analysis_mode", mode);

  analyzeBtn.disabled = true;
  analyzeBtn.innerHTML = '<span class="spinner"></span> Analyzing…';
  $("#analysisProgress")?.classList.remove("hidden");
  try {
    const response = await fetch("/analyze", {method:"POST", body:data});
    const result = await response.json();
    if (!response.ok || result.error) throw new Error(result.error || "Analysis failed.");
    window.location.href = "/results/" + result.id;
  } catch (err) {
    showToast(err.message || "Something went wrong.");
    analyzeBtn.disabled = false;
    analyzeBtn.innerHTML = "✦ Analyze documents <span>→</span>";
    $("#analysisProgress")?.classList.add("hidden");
  }
});

// PDF export from a saved result
$("#downloadReport")?.addEventListener("click", () => {
  const raw = $("#reportData");
  if (!raw || !window.jspdf?.jsPDF) return showToast("PDF library could not load. Check your internet connection.");
  const report = JSON.parse(raw.textContent);
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();
  const width = pdf.internal.pageSize.getWidth(), height = pdf.internal.pageSize.getHeight(), margin = 16;
  let y = 48;
  const addLine = (text, size=10, bold=false) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal"); pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(String(text ?? ""), width - margin*2);
    lines.forEach(line => { if (y > height-18) { pdf.addPage(); y=20; } pdf.text(line, margin, y); y += size*0.48+2; });
  };
  pdf.setFillColor(22,78,99); pdf.rect(0,0,width,35,"F");
  pdf.setTextColor(255,255,255); pdf.setFont("helvetica","bold"); pdf.setFontSize(20); pdf.text("FormCheck AI",margin,16);
  pdf.setFont("helvetica","normal"); pdf.setFontSize(10); pdf.text("Document Verification Report",margin,25);
  pdf.setTextColor(30,50,55);
  addLine("Generated: " + report.created_at, 10);
  addLine("Analysis Mode: " + (report.analysis_mode || "single").toUpperCase(), 10);
  addLine("Documents analyzed: " + report.documents.length, 10);
  y += 3; addLine("VERIFICATION SUMMARY", 13, true);
  addLine("Verification score: " + report.summary.score + "%");
  addLine("Errors: " + report.summary.errors + "   Warnings: " + report.summary.warnings + "   Checks passed: " + report.summary.passed);
  y += 3; addLine("DOCUMENT COMPARISON & INCONSISTENCIES", 13, true);
  if (report.inconsistencies?.length) report.inconsistencies.forEach(item => {
    addLine(item.field + " mismatch", 11, true); addLine("Value 1: " + (item.first || item.values?.[0]?.value)); addLine("Value 2: " + (item.second || item.values?.[1]?.value));
  }); else addLine("No inconsistencies detected.");
  report.documents.forEach((doc, index) => {
    y += 4; addLine("DOCUMENT " + (index+1) + ": " + doc.name, 12, true);
    Object.entries(doc.fields || {}).forEach(([key,value]) => addLine(key + ": " + value));
    (doc.errors || []).forEach(item => addLine("ERROR: " + item.message));
    (doc.warnings || []).forEach(item => addLine("WARNING: " + item.message));
    (doc.passed || []).forEach(item => addLine("PASSED: " + item.message));
  });
  const pages = pdf.internal.getNumberOfPages();
  for (let p=1;p<=pages;p++) { pdf.setPage(p); pdf.setFontSize(8); pdf.setTextColor(125,145,145); pdf.text("FormCheck AI · Automated document verification",margin,height-9); pdf.text(`Page ${p} of ${pages}`,width-margin,height-9,{align:"right"}); }
  pdf.save("FormCheck_AI_Report.pdf");
  showToast("PDF report downloaded.");
});