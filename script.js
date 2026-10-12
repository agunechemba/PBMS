/* ============================================================
   script.js — Prime Maintenance Culture
   - Sends submissions to a Google Apps Script Web App
   - Persists in-progress form data to localStorage
   ============================================================ */
(function () {
  "use strict";

  /* ------------------------------------------------------------
     CONFIG — paste your deployed Apps Script Web App URL below.
     ------------------------------------------------------------ */
  const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzx21GhuOjXRUtG6qqWtPtaiZIgKka49cI3_WEnZlI0r5wvhnjXbvCSEq_8QEti2uCV/exec";

  const STORAGE_KEY    = "pmc_lead_form_v1";
  const STORAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  const SAVE_DEBOUNCE  = 450;                     // ms

  /* ============================================================
     ELEMENTS
  ============================================================ */
  const form        = document.getElementById("leadForm");
  const steps       = Array.from(document.querySelectorAll(".step"));
  const stepItems   = Array.from(document.querySelectorAll(".stepper__item"));
  const stepper     = document.getElementById("stepper");
  const formCard    = document.getElementById("formCard");
  const successCard = document.getElementById("successCard");
  const prevBtn     = document.getElementById("prevBtn");
  const nextBtn     = document.getElementById("nextBtn");

  const buildingType  = document.getElementById("buildingType");
  const urgency       = document.getElementById("urgency");
  const emergencyNote = document.getElementById("emergencyNote");

  const submitError    = document.getElementById("submitError");
  const submitErrorMsg = document.getElementById("submitErrorMsg");

  const resumeBanner  = document.getElementById("resumeBanner");
  const resumeText    = document.getElementById("resumeText");
  const clearSavedBtn = document.getElementById("clearSavedBtn");

  let current = 0;

  /* ============================================================
     LOCAL STORAGE — safe access
     ============================================================ */
  const storage = (function () {
    try {
      const t = "__pmc_test__";
      window.localStorage.setItem(t, t);
      window.localStorage.removeItem(t);
      return window.localStorage;
    } catch (e) {
      return null; // private mode / disabled
    }
  })();

  function clearSavedState() {
    if (!storage) return;
    try { storage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
  }

  function saveState() {
    if (!storage) return;
    try {
      const payload = {
        v: 1,
        ts: Date.now(),
        step: current,
        hadFiles: files.length > 0,
        data: serializeForm()
      };
      storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch (e) {
      // Quota exceeded or storage unavailable — fail silently
      console.warn("PMC: could not save form state", e);
    }
  }

  function loadSavedState() {
    if (!storage) return null;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || parsed.v !== 1 || !parsed.data) {
        storage.removeItem(STORAGE_KEY);
        return null;
      }
      if (Date.now() - (parsed.ts || 0) > STORAGE_TTL_MS) {
        storage.removeItem(STORAGE_KEY);
        return null;
      }
      return parsed;
    } catch (e) {
      try { storage.removeItem(STORAGE_KEY); } catch (_) {}
      return null;
    }
  }

  function serializeForm() {
    const data = {};
    const fd = new FormData(form);
    fd.forEach((value, key) => {
      if (typeof File !== "undefined" && value instanceof File) return;
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        data[key] = [].concat(data[key], value);
      } else {
        data[key] = value;
      }
    });
    if (data.needs && !Array.isArray(data.needs)) data.needs = [data.needs];
    return data;
  }

  function applySavedState(saved) {
    if (!saved || !saved.data) return;
    const data = saved.data;

    form.querySelectorAll("input, select, textarea").forEach(el => {
      const name = el.name;
      if (!name) return;
      if (el.type === "file") return;

      if (el.type === "checkbox") {
        const vals = [].concat(data[name] || []);
        el.checked = vals.indexOf(el.value) !== -1;
      } else if (el.type === "radio") {
        el.checked = (data[name] === el.value);
      } else {
        const v = data[name];
        if (v !== undefined && v !== null && v !== "") {
          el.value = String(v);
        }
      }
    });

    if (typeof saved.step === "number" &&
        saved.step >= 0 && saved.step < steps.length) {
      current = saved.step;
    }
  }

  function savedStateIsSubstantial(saved) {
    if (!saved || !saved.data) return false;
    if (saved.step > 0) return true;
    const flat = [];
    Object.keys(saved.data).forEach(k => {
      flat.push.apply(flat, [].concat(saved.data[k]));
    });
    const nonEmpty = flat.filter(v => v !== "" && v !== undefined && v !== null).length;
    return nonEmpty >= 2;
  }

  /* Debounced save */
  let saveTimer = null;
  function scheduleSave() {
    if (!storage) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveState, SAVE_DEBOUNCE);
  }

  /* ============================================================
     STEP NAVIGATION
     ============================================================ */
  function showStep(index) {
    steps.forEach((s, i) => s.classList.toggle("hidden", i !== index));
    stepItems.forEach((s, i) => {
      s.classList.toggle("is-active", i === index);
      s.classList.toggle("is-done", i < index);
    });

    prevBtn.style.visibility = index === 0 ? "hidden" : "visible";
    nextBtn.textContent = index === steps.length - 1 ? "Submit request" : "Continue";

    formCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ============================================================
     CONDITIONAL FIELDS
     ============================================================ */
  function toggleWrap(id, show) {
    const wrap = document.getElementById(id);
    if (!wrap) return;
    wrap.classList.toggle("hidden", !show);
    wrap.querySelectorAll("input, select, textarea").forEach(el => {
      el.disabled = !show;
    });
  }

  function updateConditionals() {
    toggleWrap("otherBuildingWrap", buildingType.value === "other");

    const otherNeedBox = document.querySelector('input[name="needs"][value="Other"]');
    toggleWrap("otherNeedWrap", !!(otherNeedBox && otherNeedBox.checked));

    emergencyNote.classList.toggle("hidden", urgency.value !== "emergency");
  }

  buildingType.addEventListener("change", updateConditionals);
  urgency.addEventListener("change", updateConditionals);
  document.querySelectorAll('input[name="needs"]').forEach(cb => {
    cb.addEventListener("change", updateConditionals);
  });

  /* ============================================================
     VALIDATION
     ============================================================ */
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const PHONE_RE = /^[+]?[\d\s()\-.]{7,20}$/;

  function clearErrors(step) {
    step.querySelectorAll(".invalid").forEach(el => el.classList.remove("invalid"));
    step.querySelectorAll(".err").forEach(el => el.remove());
  }

  function setError(target, message) {
    const wrap = target.classList.contains("field") ? target : target.closest(".field");
    if (!wrap) return;
    wrap.classList.add("invalid");

    let err = wrap.querySelector(":scope > .err");
    if (!err) {
      err = document.createElement("p");
      err.className = "err";
      wrap.appendChild(err);
    }
    err.textContent = message;
  }

  function validateStep(step) {
    clearErrors(step);
    let valid = true;
    let firstBad = null;

    step.querySelectorAll("input, select, textarea").forEach(el => {
      if (el.disabled || el.type === "file") return;
      const wrap = el.closest(".field");
      if (wrap && wrap.classList.contains("hidden")) return;
      if (el.closest(".hidden")) return;

      if (el.type === "checkbox" || el.type === "radio") {
        if (el.required && !el.checked) {
          setError(el, "This is required.");
          valid = false;
          firstBad = firstBad || el;
        }
        return;
      }

      const value = el.value.trim();

      if (el.required && !value) {
        setError(el, "This field is required.");
        valid = false;
        firstBad = firstBad || el;
        return;
      }
      if (value && el.type === "email" && !EMAIL_RE.test(value)) {
        setError(el, "Please enter a valid email address.");
        valid = false;
        firstBad = firstBad || el;
        return;
      }
      if (value && el.type === "tel" && !PHONE_RE.test(value)) {
        setError(el, "Please enter a valid phone number.");
        valid = false;
        firstBad = firstBad || el;
      }
    });

    step.querySelectorAll("[data-required-group]").forEach(group => {
      if (group.closest(".hidden")) return;
      const checked = group.querySelectorAll('input[type="checkbox"]:checked').length;
      if (!checked) {
        setError(group, "Please select at least one option.");
        valid = false;
        firstBad = firstBad || group;
      }
    });

    if (firstBad) {
      firstBad.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return valid;
  }

  /* ============================================================
     FILE UPLOAD
     ============================================================ */
  const drop      = document.getElementById("drop");
  const fileInput = document.getElementById("fileInput");
  const fileList  = document.getElementById("fileList");
  const MAX_FILES    = 6;
  const MAX_FILE_MB  = 5;
  const MAX_TOTAL_MB = 8;
  let files = [];

  function syncInput() {
    try {
      const dt = new DataTransfer();
      files.forEach(f => dt.items.add(f));
      fileInput.files = dt.files;
    } catch (e) { /* DataTransfer unsupported */ }
  }

  function renderFiles() {
    fileList.innerHTML = "";
    files.forEach((file, index) => {
      const li = document.createElement("li");

      const name = document.createElement("span");
      name.className = "fname";
      name.textContent = file.name;

      const size = document.createElement("span");
      size.className = "fsize";
      size.textContent = (file.size / 1024 / 1024).toFixed(2) + " MB";

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "fremove";
      remove.setAttribute("aria-label", "Remove " + file.name);
      remove.innerHTML = "&times;";
      remove.addEventListener("click", () => {
        files.splice(index, 1);
        syncInput();
        renderFiles();
        saveState();
      });

      li.append(name, size, remove);
      fileList.appendChild(li);
    });
  }

  function totalSize() {
    return files.reduce((sum, f) => sum + f.size, 0);
  }

  function addFiles(list) {
    Array.from(list).forEach(file => {
      if (files.length >= MAX_FILES) {
        alert("You can upload a maximum of " + MAX_FILES + " files.");
        return;
      }
      if (file.size > MAX_FILE_MB * 1024 * 1024) {
        alert(file.name + " is larger than " + MAX_FILE_MB + "MB and was skipped.");
        return;
      }
      if (totalSize() + file.size > MAX_TOTAL_MB * 1024 * 1024) {
        alert("Total upload size limit is " + MAX_TOTAL_MB + "MB. " + file.name + " was skipped.");
        return;
      }
      const duplicate = files.some(f => f.name === file.name && f.size === file.size);
      if (!duplicate) files.push(file);
    });
    syncInput();
    renderFiles();
    saveState();
  }

  drop.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => addFiles(fileInput.files));

  ["dragenter", "dragover"].forEach(evt =>
    drop.addEventListener(evt, e => { e.preventDefault(); drop.classList.add("is-drag"); })
  );
  ["dragleave", "drop"].forEach(evt =>
    drop.addEventListener(evt, e => { e.preventDefault(); drop.classList.remove("is-drag"); })
  );
  drop.addEventListener("drop", e => {
    if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });

  /* ============================================================
     NAVIGATION HANDLERS
     ============================================================ */
  prevBtn.addEventListener("click", () => {
    if (current > 0) {
      current--;
      showStep(current);
      saveState();
    }
  });

  nextBtn.addEventListener("click", () => {
    if (!validateStep(steps[current])) return;

    if (current === steps.length - 1) {
      form.requestSubmit ? form.requestSubmit()
                         : form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
    } else {
      current++;
      showStep(current);
      saveState();
    }
  });

  form.addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.tagName !== "TEXTAREA" && e.target.type !== "checkbox") {
      e.preventDefault();
      nextBtn.click();
    }
  });

  /* ============================================================
     LIVE SAVE  (debounced)  +  on tab hide / close
     ============================================================ */
  form.addEventListener("input", scheduleSave);
  form.addEventListener("change", scheduleSave);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveState();
  });
  window.addEventListener("pagehide", saveState);
  window.addEventListener("beforeunload", saveState);

  /* ============================================================
     REFERENCE NUMBER GENERATOR
     ============================================================ */
  function makeReference(email) {
    const now = new Date();
    const pad = (n, len) => String(n).padStart(len, "0");

    const yy = String(now.getFullYear()).slice(-2);
    const mm = pad(now.getMonth() + 1, 2);
    const dd = pad(now.getDate(), 2);
    const hh = pad(now.getHours(), 2);
    const mi = pad(now.getMinutes(), 2);
    const ss = pad(now.getSeconds(), 2);
    const ms = pad(now.getMilliseconds(), 3);

    const emailPrefix = String(email || "X")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 5)
      .padEnd(5, "X");

    return `PPH-${yy}${mm}${dd}-${hh}${mi}${ss}${ms}-${emailPrefix}`;
  }

  /* ============================================================
     FILE → BASE64
     ============================================================ */
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result);
        const idx = result.indexOf(",");
        const base64 = idx >= 0 ? result.slice(idx + 1) : result;
        resolve({
          name: file.name,
          type: file.type || "application/octet-stream",
          size: file.size,
          data: base64
        });
      };
      reader.onerror = () => reject(new Error("Failed to read " + file.name));
      reader.readAsDataURL(file);
    });
  }

  function buildFilePayload() {
    if (!files.length) return Promise.resolve([]);
    return Promise.all(files.map(fileToBase64));
  }

  /* ============================================================
     BUILD PAYLOAD FROM FORM
     ============================================================ */
  async function buildPayload() {
    const data = serializeForm();
    const reference = makeReference(data.email);
    const filePayloads = await buildFilePayload();

    return Object.assign(
      { reference: reference, submittedAt: new Date().toISOString(), files: filePayloads },
      data
    );
  }

  /* ============================================================
     SUMMARY BUILDER
     ============================================================ */
  function buildSummary(data) {
    const needs = data.needs ? [].concat(data.needs) : [];
    const rows = [
      ["Building type", data.buildingType === "other" ? data.otherBuilding : data.buildingType],
      ["Location", [data.location, data.cityState].filter(Boolean).join(", ")],
      ["Buildings / sites", data.siteCount],
      ["Service needed", needs.join(", ") || "—"],
      ["Urgency", data.urgency === "emergency" ? "Emergency (24–48 hrs)" : data.urgency],
      ["Frequency", data.frequency],
      ["Budget range", data.budgetRange || "Not stated"],
      ["Preferred contact", data.contactMethod],
      ["Phone / WhatsApp", data.phone],
      ["Email", data.email]
    ].filter(row => row[1]);

    const dl = document.createElement("dl");
    rows.forEach(([label, value]) => {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      dl.append(dt, dd);
    });

    const heading = document.createElement("h3");
    heading.textContent = "Summary of your request";

    const box = document.getElementById("summary");
    box.innerHTML = "";
    box.append(heading, dl);
  }

  /* ============================================================
     SUCCESS VIEW
     ============================================================ */
  function showSuccessView(data, reference) {
    document.getElementById("sName").textContent =
      (data.fullName || "").trim().split(/\s+/)[0] || "there";
    document.getElementById("sEmail").textContent = data.email || "your inbox";
    document.getElementById("sRef").textContent = reference;

    buildSummary(data);

    stepper.classList.add("hidden");
    formCard.classList.add("hidden");
    successCard.classList.remove("hidden");
    successCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ============================================================
     SUBMIT
     ============================================================ */
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    submitError.classList.add("hidden");
    submitErrorMsg.textContent = "";

    if (!validateStep(steps[current])) return;

    if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf("PASTE_YOUR") === 0) {
      submitErrorMsg.textContent = " Form is not connected yet. Please contact the site administrator.";
      submitError.classList.remove("hidden");
      submitError.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const originalText = nextBtn.textContent;
    nextBtn.disabled = true;
    nextBtn.textContent = "Sending…";

    try {
      const payload = await buildPayload();

      const res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
      });

      let result = null;
      try { result = await res.json(); } catch (_) {}

      if (result && result.status === "error") {
        throw new Error(result.message || "Server rejected the request.");
      }

      console.log("Lead submitted:", payload);

      // Success → clear the saved draft
      clearSavedState();
      if (resumeBanner) resumeBanner.classList.add("hidden");

      showSuccessView(payload, payload.reference);

    } catch (err) {
      console.error("Submission failed:", err);
      submitErrorMsg.textContent =
        " " + (err.message || "Please check your connection and try again.");
      submitError.classList.remove("hidden");
      submitError.scrollIntoView({ behavior: "smooth", block: "center" });
    } finally {
      nextBtn.disabled = false;
      nextBtn.textContent = originalText;
    }
  });

  /* ============================================================
     START OVER (success card)
     ============================================================ */
  document.getElementById("againBtn").addEventListener("click", () => {
    clearSavedState();
    if (resumeBanner) resumeBanner.classList.add("hidden");

    form.reset();
    files = [];
    renderFiles();
    clearErrors(form);
    current = 0;
    updateConditionals();
    submitError.classList.add("hidden");
    successCard.classList.add("hidden");
    stepper.classList.remove("hidden");
    formCard.classList.remove("hidden");
    showStep(0);
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  /* ============================================================
     RESUME BANNER — "Start fresh" button
     ============================================================ */
  if (clearSavedBtn) {
    clearSavedBtn.addEventListener("click", () => {
      const ok = window.confirm("Discard your saved progress and start with a blank form?");
      if (!ok) return;

      clearSavedState();
      form.reset();
      files = [];
      renderFiles();
      clearErrors(form);
      current = 0;
      updateConditionals();
      resumeBanner.classList.add("hidden");
      showStep(0);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  /* ============================================================
     INIT
     ============================================================ */
  const saved = loadSavedState();
  if (saved) {
    applySavedState(saved);
    if (savedStateIsSubstantial(saved) && resumeBanner && resumeText) {
      let msg = "We restored your saved progress on this device.";
      if (saved.hadFiles) {
        msg += " Please re-attach any files you had selected — they can't be saved.";
      }
      resumeText.textContent = msg;
      resumeBanner.classList.remove("hidden");
    }
  }

  updateConditionals();
  showStep(current);
  prevBtn.style.visibility = current === 0 ? "hidden" : "visible";
})();