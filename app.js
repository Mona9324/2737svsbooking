let currentBuff = "monday";
let selectedSlot = null;
const ADMIN_PASSWORD = "2737admin";
let adminAuthenticated = false;
let bookingOpen = false;
const svsDate = new Date("2026-03-23T00:00:00Z");
const grid = document.getElementById("slots");

const dbRef = window.db || firebase.firestore();

let bookingUnsubscribe = null;
let slotsUnsubscribe = null;
let allSlotsData = {};

const medalMap = ["🥇", "🥈", "🥉"];

function updateCountdown() {
  const now = new Date();
  const diff = svsDate - now;

  if (diff <= 0) {
    document.getElementById("countdown").innerText = "SVS has begun";
    return;
  }

  const d = Math.floor(diff / (1000 * 60 * 60 * 24));
  const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
  const m = Math.floor((diff / (1000 * 60)) % 60);

  document.getElementById("countdown").innerText = `SVS begins in ${d}d ${h}h ${m}m`;
}

function padTime(h, m) {
  if (m >= 60) {
    h += Math.floor(m / 60);
    m = m % 60;
  }
  h = h % 24;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

function setActiveTab() {
  const buttons = document.querySelectorAll(".tabs button");
  buttons.forEach((btn) => btn.classList.remove("active"));

  if (currentBuff === "monday" && buttons[0]) buttons[0].classList.add("active");
  if (currentBuff === "tuesday" && buttons[1]) buttons[1].classList.add("active");
  if (currentBuff === "thursday" && buttons[2]) buttons[2].classList.add("active");
}

function clearSelection() {
  document.querySelectorAll(".slot").forEach((slot) => {
    slot.classList.remove("selected", "highlightAvailable", "highlightReserved");
  });
}

function highlightSlot(div, isAvailable) {
  clearSelection();
  div.classList.add("selected");
  div.classList.add(isAvailable ? "highlightAvailable" : "highlightReserved");
}

function switchBuff(buff) {
  currentBuff = buff;
  setActiveTab();
  renderAll(allSlotsData);
}

function openReserveModal(id) {
  if (!bookingOpen) {
    alert("예약이 닫혀 있습니다.");
    return;
  }
  selectedSlot = id;
  document.getElementById("modal").classList.add("show");
}

function closeModal() {
  document.getElementById("modal").classList.remove("show");
  document.getElementById("alliance").value = "";
  document.getElementById("player").value = "";
  document.getElementById("daysSaved").value = "";
  document.getElementById("password").value = "";
  selectedSlot = null;
  clearSelection();
}

function openCancelModal(id) {
  selectedSlot = id;
  document.getElementById("cancelModal").classList.add("show");
}

function closeCancelModal() {
  document.getElementById("cancelModal").classList.remove("show");
  document.getElementById("cancelPassword").value = "";
  selectedSlot = null;
  clearSelection();
}

function openAdmin() {
  document.getElementById("adminPanel").classList.add("show");
}

function closeAdmin() {
  document.getElementById("adminPanel").classList.remove("show");
}

function adminLogin() {
  const pw = document.getElementById("adminPass").value;
  if (pw === ADMIN_PASSWORD) {
    adminAuthenticated = true;
    document.getElementById("adminLogin").style.display = "none";
    document.getElementById("adminControls").style.display = "flex";
  } else {
    alert("관리자 비밀번호가 틀렸습니다.");
  }
}

function setBooking(isOpen) {
  if (!adminAuthenticated) return;

  dbRef.collection("settings").doc("booking").set({ open: isOpen }, { merge: true })
    .then(() => {
      alert(isOpen ? "예약이 열렸습니다." : "예약이 잠겼습니다.");
    })
    .catch((error) => {
      console.error(error);
      alert("설정 변경 중 오류가 발생했습니다.");
    });
}

function clearAll() {
  if (!adminAuthenticated) return;
  if (!confirm("전체 예약을 삭제할까요?")) return;

  dbRef.collection("slots").get()
    .then((snapshot) => {
      const batch = dbRef.batch();
      snapshot.forEach((doc) => batch.delete(doc.ref));
      return batch.commit();
    })
    .then(() => {
      alert("전체 예약이 삭제되었습니다.");
    })
    .catch((error) => {
      console.error(error);
      alert("전체 삭제 중 오류가 발생했습니다.");
    });
}

function getCurrentBuffTop3(data) {
  return Object.entries(data)
    .filter(([key, value]) => key.startsWith(`${currentBuff}_`) && value)
    .map(([, value]) => value)
    .filter((slot) => slot.daysSaved !== undefined && slot.daysSaved !== null && slot.daysSaved !== "")
    .sort((a, b) => Number(b.daysSaved) - Number(a.daysSaved))
    .slice(0, 3);
}

function updateCounts(data) {
  let reserved = 0;
  let available = 0;

  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const id = `${currentBuff}_${padTime(h, m)}`;
      if (data[id]) reserved++;
      else available++;
    }
  }

  document.getElementById("availableCount").innerText = `Available ${available}`;
  document.getElementById("reservedCount").innerText = `Reserved ${reserved}`;
}

function updateTopSpeedups(data) {
  const rankingBox = document.getElementById("rankingBox");
  const top3 = getCurrentBuffTop3(data);

  let html = '<div class="rankingTitle">Top Speed-ups</div>';
  html += '<div class="rankingList">';

  if (top3.length === 0) {
    html += '<div class="rankingItem empty">No data yet</div>';
  } else {
    top3.forEach((slot, idx) => {
      html += `
        <div class="rankingItem">
          <span class="medal">${medalMap[idx]}</span>
          <span class="rankingText">[${escapeHtml(slot.alliance || "-")}] ${escapeHtml(slot.player || "-")} (${Number(slot.daysSaved)})</span>
        </div>
      `;
    });
  }

  html += '</div>';
  rankingBox.innerHTML = html;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function generateSlots(data) {
  grid.innerHTML = "";

  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const utcTime = padTime(h, m);
      const utcEndTime = padTime(h, m + 30);
      const id = `${currentBuff}_${utcTime}`;
      const slot = data[id];

      const localDate = new Date();
      localDate.setUTCHours(h, m, 0, 0);
      const localEndDate = new Date(localDate.getTime() + 30 * 60 * 1000);

      const localStart = localDate.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });

      const localEnd = localEndDate.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });

      const div = document.createElement("div");
      div.className = "slot";

      if (!bookingOpen) {
        div.classList.add("locked");
        div.innerHTML = `
          <div class="timeRow">
            <span class="timeUTC">${utcTime} - ${utcEndTime} UTC</span>
          </div>
          <div class="timeLocal">${localStart} - ${localEnd}</div>
          <div class="bookingInfo">🔒 Booking Closed</div>
        `;
      } else if (!slot) {
        div.classList.add("available");
        div.innerHTML = `
          <div class="timeRow">
            <span class="timeUTC">${utcTime} - ${utcEndTime} UTC</span>
            <span class="statusAvailable">Available</span>
          </div>
          <div class="timeLocal">${localStart} - ${localEnd}</div>
          <div class="bookingInfo">Click to book this slot</div>
        `;
        div.onclick = () => {
          highlightSlot(div, true);
          openReserveModal(id);
        };
      } else {
        div.classList.add("reserved");
        div.innerHTML = `
          <div class="timeRow">
            <span class="timeUTC">${utcTime} - ${utcEndTime} UTC</span>
            <span class="statusReserved">Reserved</span>
          </div>
          <div class="timeLocal">${localStart} - ${localEnd}</div>
          <div class="bookingInfo">[${escapeHtml(slot.alliance)}] ${escapeHtml(slot.player)} (${Number(slot.daysSaved)})</div>
        `;
        div.onclick = () => {
          highlightSlot(div, false);
          openCancelModal(id);
        };
      }

      grid.appendChild(div);
    }
  }
}

function renderAll(data) {
  generateSlots(data);
  updateCounts(data);
  updateTopSpeedups(data);
}

function attachRealtimeListeners() {
  if (slotsUnsubscribe) {
    slotsUnsubscribe();
    slotsUnsubscribe = null;
  }

  if (bookingUnsubscribe) {
    bookingUnsubscribe();
    bookingUnsubscribe = null;
  }

  bookingUnsubscribe = dbRef.collection("settings").doc("booking").onSnapshot(
    (doc) => {
      bookingOpen = doc.exists ? Boolean(doc.data().open) : false;

      if (slotsUnsubscribe) {
        slotsUnsubscribe();
        slotsUnsubscribe = null;
      }

      slotsUnsubscribe = dbRef.collection("slots").onSnapshot(
        (snapshot) => {
          const data = {};
          snapshot.forEach((docItem) => {
            data[docItem.id] = docItem.data();
          });

          allSlotsData = data;
          renderAll(allSlotsData);
        },
        (error) => {
          console.error("slots onSnapshot error:", error);
        }
      );
    },
    (error) => {
      console.error("booking onSnapshot error:", error);
    }
  );
}

function loadSlots() {
  attachRealtimeListeners();
}

function confirmBooking() {
  if (!selectedSlot) return;

  if (!bookingOpen) {
    alert("예약이 닫혀 있습니다.");
    return;
  }

  const alliance = document.getElementById("alliance").value.trim();
  const player = document.getElementById("player").value.trim();
  const daysSavedRaw = document.getElementById("daysSaved").value.trim();
  const password = document.getElementById("password").value;

  if (!alliance || !player || !daysSavedRaw || !password) {
    alert("모든 항목을 입력해주세요.");
    return;
  }

  const daysSaved = Number(daysSavedRaw);
  if (Number.isNaN(daysSaved) || daysSaved < 0) {
    alert("Use Speed-up 값을 올바르게 입력해주세요.");
    return;
  }

  const slotRef = dbRef.collection("slots").doc(selectedSlot);
  const bookingRef = dbRef.collection("settings").doc("booking");

  dbRef.runTransaction(async (transaction) => {
    const bookingDoc = await transaction.get(bookingRef);
    const slotDoc = await transaction.get(slotRef);

    const isOpen = bookingDoc.exists ? Boolean(bookingDoc.data().open) : false;
    if (!isOpen) {
      throw new Error("BOOKING_CLOSED");
    }

    if (slotDoc.exists) {
      throw new Error("ALREADY_RESERVED");
    }

    transaction.set(slotRef, {
      alliance,
      player,
      daysSaved,
      password,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      buff: currentBuff
    });
  })
    .then(() => {
      closeModal();
    })
    .catch((error) => {
      console.error(error);

      if (error.message === "BOOKING_CLOSED") {
        alert("예약이 닫혀 있습니다.");
      } else if (error.message === "ALREADY_RESERVED") {
        alert("이미 예약된 슬롯입니다.");
      } else {
        alert("예약 중 오류가 발생했습니다.");
      }
    });
}

function confirmCancel() {
  if (!selectedSlot) return;

  const cancelPassword = document.getElementById("cancelPassword").value;
  const slotRef = dbRef.collection("slots").doc(selectedSlot);

  dbRef.runTransaction(async (transaction) => {
    const doc = await transaction.get(slotRef);

    if (!doc.exists) {
      throw new Error("NOT_FOUND");
    }

    const data = doc.data();
    if (data.password !== cancelPassword) {
      throw new Error("WRONG_PASSWORD");
    }

    transaction.delete(slotRef);
  })
    .then(() => {
      closeCancelModal();
    })
    .catch((error) => {
      console.error(error);

      if (error.message === "NOT_FOUND") {
        alert("예약 정보를 찾을 수 없습니다.");
      } else if (error.message === "WRONG_PASSWORD") {
        alert("Password incorrect");
      } else {
        alert("취소 중 오류가 발생했습니다.");
      }
    });
}

/* blue snow */
const canvas = document.getElementById("snow");
const ctx = canvas.getContext("2d");
const flakes = [];

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function initSnow() {
  resizeCanvas();
  flakes.length = 0;

  for (let i = 0; i < 180; i++) {
    flakes.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      radius: Math.random() * 2.6 + 0.8,
      speedY: Math.random() * 0.9 + 0.3,
      speedX: Math.random() * 0.4 - 0.2
    });
  }
}

function drawSnow() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  flakes.forEach((f) => {
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(170, 210, 255, 0.85)";
    ctx.fill();

    f.y += f.speedY;
    f.x += f.speedX;

    if (f.y > canvas.height + 5) {
      f.y = -5;
      f.x = Math.random() * canvas.width;
    }

    if (f.x < -5) f.x = canvas.width + 5;
    if (f.x > canvas.width + 5) f.x = -5;
  });

  requestAnimationFrame(drawSnow);
}

window.addEventListener("resize", resizeCanvas);
setInterval(updateCountdown, 60000);

updateCountdown();
setActiveTab();
initSnow();
drawSnow();
loadSlots();
