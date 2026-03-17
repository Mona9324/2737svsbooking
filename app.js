var currentBuff = "monday";
var selectedSlot = null;
var ADMIN_PASSWORD = "2737admin";
var adminAuthenticated = false;
var bookingOpen = true;
var svsDate = new Date("2026-03-23T00:00:00Z");

var grid = document.getElementById("slots");
var rankingBox = document.getElementById("rankingBox");
var db = window.db || firebase.firestore();

var allSlotsData = {};
var bookingUnsubscribe = null;
var slotsUnsubscribe = null;
var recentBookedSlotId = null;

var medalMap = ["🥇", "🥈", "🥉"];
var ALLIANCE_STORAGE_KEY = "svs_recent_alliances";

function padTime(h, m) {
  if (m >= 60) {
    h += Math.floor(m / 60);
    m = m % 60;
  }
  h = h % 24;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showToast(message, type) {
  var container = document.getElementById("toastContainer");
  if (!container) return;

  var toast = document.createElement("div");
  toast.className = "toast" + (type ? " " + type : "");
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(function () {
    toast.classList.add("hide");
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 250);
  }, 2200);
}

function getSavedAlliances() {
  try {
    var raw = localStorage.getItem(ALLIANCE_STORAGE_KEY);
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

function saveAllianceRecent(alliance) {
  if (!alliance) return;

  var items = getSavedAlliances().filter(function (item) {
    return item.toLowerCase() !== alliance.toLowerCase();
  });

  items.unshift(alliance);
  items = items.slice(0, 8);

  localStorage.setItem(ALLIANCE_STORAGE_KEY, JSON.stringify(items));
  renderAllianceSuggestions();
}

function renderAllianceSuggestions() {
  var list = document.getElementById("allianceSuggestions");
  if (!list) return;

  var items = getSavedAlliances();
  list.innerHTML = "";

  items.forEach(function (item) {
    var option = document.createElement("option");
    option.value = item;
    list.appendChild(option);
  });
}

function updateCountdown() {
  var now = new Date();
  var diff = svsDate - now;

  if (diff <= 0) {
    document.getElementById("countdown").innerText = "SVS has begun";
    return;
  }

  var d = Math.floor(diff / (1000 * 60 * 60 * 24));
  var h = Math.floor((diff / (1000 * 60 * 60)) % 24);
  var m = Math.floor((diff / (1000 * 60)) % 60);

  document.getElementById("countdown").innerText =
    "SVS begins in " + d + "d " + h + "h " + m + "m";
}

function setActiveTab() {
  var buttons = document.querySelectorAll(".tabs button");
  buttons.forEach(function (btn) {
    btn.classList.remove("active");
  });

  var activeId = "tab-monday";
  if (currentBuff === "tuesday") activeId = "tab-tuesday";
  if (currentBuff === "thursday") activeId = "tab-thursday";

  var activeBtn = document.getElementById(activeId);
  if (activeBtn) activeBtn.classList.add("active");
}

function clearSelection() {
  var slots = document.querySelectorAll(".slot");
  slots.forEach(function (slot) {
    slot.classList.remove("selected", "highlightAvailable", "highlightReserved");
  });
}

function highlightSlot(div, isAvailable) {
  clearSelection();
  div.classList.add("selected");
  if (isAvailable) {
    div.classList.add("highlightAvailable");
  } else {
    div.classList.add("highlightReserved");
  }
}

function switchBuff(buff) {
  currentBuff = buff;
  setActiveTab();
  renderAll();
}

function openReserveModal(id) {
  if (!bookingOpen) {
    showToast("예약이 닫혀 있습니다.", "error");
    return;
  }
  selectedSlot = id;
  document.getElementById("modal").classList.add("show");
}

function closeModal() {
  document.getElementById("modal").classList.remove("show");

  var allianceEl = document.getElementById("alliance");
  var playerEl = document.getElementById("player");
  var daysSavedEl = document.getElementById("daysSaved");
  var passwordEl = document.getElementById("password");

  if (allianceEl) allianceEl.value = "";
  if (playerEl) playerEl.value = "";
  if (daysSavedEl) daysSavedEl.value = "";
  if (passwordEl) passwordEl.value = "";

  selectedSlot = null;
  clearSelection();
}

function openCancelModal(id) {
  selectedSlot = id;
  document.getElementById("cancelModal").classList.add("show");
}

function closeCancelModal() {
  document.getElementById("cancelModal").classList.remove("show");
  var cancelPasswordEl = document.getElementById("cancelPassword");
  if (cancelPasswordEl) cancelPasswordEl.value = "";
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
  var passEl = document.getElementById("adminPass");
  var pw = passEl ? passEl.value : "";

  if (pw === ADMIN_PASSWORD) {
    adminAuthenticated = true;
    document.getElementById("adminLogin").style.display = "none";
    document.getElementById("adminControls").style.display = "flex";
    showToast("관리자 로그인 완료", "success");
  } else {
    showToast("관리자 비밀번호가 틀렸습니다.", "error");
  }
}

function setBooking(isOpen) {
  if (!adminAuthenticated) return;

  db.collection("settings").doc("booking").set({ open: isOpen }, { merge: true })
    .then(function () {
      bookingOpen = isOpen;
      renderAll();
      showToast(isOpen ? "예약이 열렸습니다." : "예약이 잠겼습니다.", "success");
    })
    .catch(function (error) {
      console.error("setBooking error:", error);
      showToast("설정 변경 중 오류가 발생했습니다.", "error");
    });
}

function clearAll() {
  if (!adminAuthenticated) return;
  if (!confirm("전체 예약을 삭제할까요?")) return;

  db.collection("slots").get()
    .then(function (snapshot) {
      var batch = db.batch();
      snapshot.forEach(function (doc) {
        batch.delete(doc.ref);
      });
      return batch.commit();
    })
    .then(function () {
      showToast("전체 예약이 삭제되었습니다.", "success");
    })
    .catch(function (error) {
      console.error("clearAll error:", error);
      showToast("전체 삭제 중 오류가 발생했습니다.", "error");
    });
}

function getCurrentBuffTop3() {
  return Object.keys(allSlotsData)
    .filter(function (key) {
      return key.indexOf(currentBuff + "_") === 0 && allSlotsData[key];
    })
    .map(function (key) {
      return allSlotsData[key];
    })
    .filter(function (slot) {
      return slot.daysSaved !== undefined && slot.daysSaved !== null && slot.daysSaved !== "";
    })
    .sort(function (a, b) {
      return Number(b.daysSaved) - Number(a.daysSaved);
    })
    .slice(0, 3);
}

function updateCounts() {
  var reserved = 0;
  var available = 0;

  for (var h = 0; h < 24; h++) {
    for (var m = 0; m < 60; m += 30) {
      var id = currentBuff + "_" + padTime(h, m);
      if (allSlotsData[id]) reserved++;
      else available++;
    }
  }

  document.getElementById("availableCount").innerText = "Available " + available;
  document.getElementById("reservedCount").innerText = "Reserved " + reserved;
}

function updateTopSpeedups() {
  var top3 = getCurrentBuffTop3();
  var html = '<div class="rankingTitle">Top Speed-ups</div>';
  html += '<div class="rankingList">';

  if (top3.length === 0) {
    html += '<div class="rankingItem empty">No data yet</div>';
  } else {
    top3.forEach(function (slot, idx) {
      var firstClass = idx === 0 ? " firstPlace" : "";
      html +=
        '<div class="rankingItem' + firstClass + '">' +
          '<span class="medal">' + medalMap[idx] + '</span>' +
          '<span class="rankingText">[' + escapeHtml(slot.alliance || "-") + '] ' +
          escapeHtml(slot.player || "-") + ' (' + Number(slot.daysSaved) + ')</span>' +
        '</div>';
    });
  }

  html += "</div>";
  rankingBox.innerHTML = html;

  rankingBox.classList.remove("rankingUpdate");
  void rankingBox.offsetWidth;
  rankingBox.classList.add("rankingUpdate");
}

function generateSlots() {
  grid.innerHTML = "";

  for (var h = 0; h < 24; h++) {
    for (var m = 0; m < 60; m += 30) {
      var utcStart = padTime(h, m);
      var utcEnd = padTime(h, m + 30);
      var id = currentBuff + "_" + utcStart;
      var slot = allSlotsData[id];

      var localDate = new Date();
      localDate.setUTCHours(h, m, 0, 0);
      var localEndDate = new Date(localDate.getTime() + 30 * 60 * 1000);

      var localStart = localDate.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });

      var localEnd = localEndDate.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
      });

      var div = document.createElement("div");
      div.className = "slot";

      if (id === recentBookedSlotId) {
        div.classList.add("successFlash");
      }

      if (!bookingOpen) {
        div.classList.add("locked");
        div.innerHTML =
          '<div class="timeRow">' +
            '<span class="timeUTC">' + utcStart + ' - ' + utcEnd + ' UTC</span>' +
          '</div>' +
          '<div class="timeLocal">' + localStart + ' - ' + localEnd + '</div>' +
          '<div class="bookingInfo">🔒 Booking Closed</div>';
      } else if (!slot) {
        div.classList.add("available");
        div.innerHTML =
          '<div class="timeRow">' +
            '<span class="timeUTC">' + utcStart + ' - ' + utcEnd + ' UTC</span>' +
            '<span class="statusAvailable">Available</span>' +
          '</div>' +
          '<div class="timeLocal">' + localStart + ' - ' + localEnd + '</div>' +
          '<div class="bookingInfo">Click to book this slot</div>';

        div.onclick = (function (slotId, el) {
          return function () {
            highlightSlot(el, true);
            openReserveModal(slotId);
          };
        })(id, div);
      } else {
        div.classList.add("reserved");
        div.innerHTML =
          '<div class="timeRow">' +
            '<span class="timeUTC">' + utcStart + ' - ' + utcEnd + ' UTC</span>' +
            '<span class="statusReserved">Reserved</span>' +
          '</div>' +
          '<div class="timeLocal">' + localStart + ' - ' + localEnd + '</div>' +
          '<div class="bookingInfo">[' + escapeHtml(slot.alliance) + '] ' +
          escapeHtml(slot.player) + ' (' + Number(slot.daysSaved) + ')</div>';

        div.onclick = (function (slotId, el) {
          return function () {
            highlightSlot(el, false);
            openCancelModal(slotId);
          };
        })(id, div);
      }

      grid.appendChild(div);
    }
  }
}

function renderAll() {
  generateSlots();
  updateCounts();
  updateTopSpeedups();
}

function attachRealtimeListeners() {
  if (bookingUnsubscribe) {
    bookingUnsubscribe();
    bookingUnsubscribe = null;
  }
  if (slotsUnsubscribe) {
    slotsUnsubscribe();
    slotsUnsubscribe = null;
  }

  bookingUnsubscribe = db.collection("settings").doc("booking").onSnapshot(
    function (doc) {
      bookingOpen = doc.exists ? Boolean(doc.data().open) : true;
      renderAll();
    },
    function (error) {
      console.error("booking onSnapshot error:", error);
      bookingOpen = true;
      renderAll();
    }
  );

  slotsUnsubscribe = db.collection("slots").onSnapshot(
    function (snapshot) {
      var data = {};
      snapshot.forEach(function (docItem) {
        data[docItem.id] = docItem.data();
      });
      allSlotsData = data;
      renderAll();
    },
    function (error) {
      console.error("slots onSnapshot error:", error);
    }
  );
}

function loadSlots() {
  attachRealtimeListeners();
}

function confirmBooking() {
  var allianceEl = document.getElementById("alliance");
  var playerEl = document.getElementById("player");
  var daysSavedEl = document.getElementById("daysSaved");
  var passwordEl = document.getElementById("password");

  if (!allianceEl || !playerEl || !daysSavedEl || !passwordEl) {
    showToast("예약 입력창을 찾을 수 없습니다.", "error");
    return;
  }

  if (!selectedSlot) {
    showToast("예약 슬롯을 먼저 선택해주세요.", "error");
    return;
  }

  if (!bookingOpen) {
    showToast("예약이 닫혀 있습니다.", "error");
    return;
  }

  var alliance = allianceEl.value.trim();
  var player = playerEl.value.trim();
  var daysSavedRaw = daysSavedEl.value.trim();
  var password = passwordEl.value;

  if (!alliance || !player || !daysSavedRaw || !password) {
    showToast("모든 항목을 입력해주세요.", "error");
    return;
  }

  var daysSaved = Number(daysSavedRaw);
  if (isNaN(daysSaved) || daysSaved < 0) {
    showToast("Use Speed-up 값을 올바르게 입력해주세요.", "error");
    return;
  }

  var docRef = db.collection("slots").doc(selectedSlot);

  docRef.get()
    .then(function (doc) {
      if (doc.exists) {
        throw new Error("ALREADY_RESERVED");
      }

      return docRef.set({
        alliance: alliance,
        player: player,
        daysSaved: daysSaved,
        password: password,
        buff: currentBuff,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    })
    .then(function () {
      saveAllianceRecent(alliance);
      recentBookedSlotId = selectedSlot;
      setTimeout(function () {
        recentBookedSlotId = null;
      }, 1800);

      closeModal();
      showToast("예약이 완료되었습니다.", "success");
    })
    .catch(function (error) {
      console.error("confirmBooking error:", error);
      if (error.message === "ALREADY_RESERVED") {
        showToast("이미 예약된 슬롯입니다.", "error");
      } else {
        showToast("예약 중 오류가 발생했습니다.", "error");
      }
    });
}

function confirmCancel() {
  if (!selectedSlot) {
    showToast("취소할 슬롯을 먼저 선택해주세요.", "error");
    return;
  }

  var cancelPasswordEl = document.getElementById("cancelPassword");
  if (!cancelPasswordEl) {
    showToast("취소 입력창을 찾을 수 없습니다.", "error");
    return;
  }

  var cancelPassword = cancelPasswordEl.value;
  var docRef = db.collection("slots").doc(selectedSlot);

  docRef.get()
    .then(function (doc) {
      if (!doc.exists) {
        throw new Error("NOT_FOUND");
      }

      var data = doc.data();
      if (data.password !== cancelPassword) {
        throw new Error("WRONG_PASSWORD");
      }

      return docRef.delete();
    })
    .then(function () {
      closeCancelModal();
      showToast("예약이 취소되었습니다.", "success");
    })
    .catch(function (error) {
      console.error("confirmCancel error:", error);
      if (error.message === "NOT_FOUND") {
        showToast("예약 정보를 찾을 수 없습니다.", "error");
      } else if (error.message === "WRONG_PASSWORD") {
        showToast("비밀번호가 올바르지 않습니다.", "error");
      } else {
        showToast("취소 중 오류가 발생했습니다.", "error");
      }
    });
}

function csvEscape(value) {
  var str = value === undefined || value === null ? "" : String(value);
  str = str.replace(/"/g, '""');
  return '"' + str + '"';
}

function downloadCSV(filename, rows) {
  var csvContent = rows.map(function (row) {
    return row.map(csvEscape).join(",");
  }).join("\n");

  var blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  var link = document.createElement("a");
  var url = URL.createObjectURL(blob);

  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  setTimeout(function () {
    URL.revokeObjectURL(url);
  }, 1000);
}

function exportCurrentBuffCSV() {
  if (!adminAuthenticated) return;

  var rows = [["Buff", "UTC Slot", "Alliance", "Player", "Use Speed-up"]];
  Object.keys(allSlotsData)
    .filter(function (key) {
      return key.indexOf(currentBuff + "_") === 0;
    })
    .sort()
    .forEach(function (key) {
      var slot = allSlotsData[key];
      rows.push([
        currentBuff,
        key.replace(currentBuff + "_", ""),
        slot.alliance || "",
        slot.player || "",
        slot.daysSaved || ""
      ]);
    });

  downloadCSV("svs_" + currentBuff + "_booking.csv", rows);
  showToast("현재 탭 CSV를 내보냈습니다.", "success");
}

function exportAllCSV() {
  if (!adminAuthenticated) return;

  var rows = [["Buff", "UTC Slot", "Alliance", "Player", "Use Speed-up"]];
  Object.keys(allSlotsData)
    .sort()
    .forEach(function (key) {
      var parts = key.split("_");
      var buff = parts[0];
      var utcSlot = parts.slice(1).join("_");
      var slot = allSlotsData[key];

      rows.push([
        buff,
        utcSlot,
        slot.alliance || "",
        slot.player || "",
        slot.daysSaved || ""
      ]);
    });

  downloadCSV("svs_all_booking.csv", rows);
  showToast("전체 CSV를 내보냈습니다.", "success");
}

var canvas = document.getElementById("snow");
var ctx = canvas.getContext("2d");
var flakes = [];

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function initSnow() {
  resizeCanvas();
  flakes.length = 0;

  for (var i = 0; i < 180; i++) {
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

  flakes.forEach(function (f) {
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
renderAllianceSuggestions();
initSnow();
drawSnow();
loadSlots();

var secretClickCount = 0;
var secretClickTimer = null;

function registerSecretClick() {
  secretClickCount++;

  clearTimeout(secretClickTimer);

  secretClickTimer = setTimeout(function () {
    secretClickCount = 0;
  }, 1200);

  if (secretClickCount >= 3) {
    secretClickCount = 0;
    openAdmin();
  }
}

var snowBtn = document.getElementById("snowSecret");
if (snowBtn) {
  snowBtn.addEventListener("click", registerSecretClick);
}
