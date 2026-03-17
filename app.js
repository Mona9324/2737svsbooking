var currentBuff = "monday";
var selectedSlot = null;
var adminAuthenticated = false;
var currentUser = null;
var adminSlotTarget = null;

var grid = document.getElementById("slots");
var db = window.db || firebase.firestore();
var auth = window.auth || firebase.auth();
var googleProvider = window.googleProvider || new firebase.auth.GoogleAuthProvider();

var allSlotsData = {};
var bookingSettings = {
  baseDate: "2026-03-23",
  tabs: {
    monday: { manualOpen: true, openAt: "", closeAt: "" },
    tuesday: { manualOpen: true, openAt: "", closeAt: "" },
    thursday: { manualOpen: true, openAt: "", closeAt: "" }
  }
};

var bookingUnsubscribe = null;
var slotsUnsubscribe = null;
var logsUnsubscribe = null;
var recentBookedSlotId = null;

var ALLIANCE_STORAGE_KEY = "svs_recent_alliances";
var MY_BOOKING_KEY = "svs_my_booking_info";

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

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function simpleHash(value) {
  var str = String(value || "");
  var hash = 0;
  for (var i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash |= 0;
  }
  return "h_" + Math.abs(hash);
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

function saveMyBookingInfo(alliance, player) {
  localStorage.setItem(MY_BOOKING_KEY, JSON.stringify({
    alliance: alliance || "",
    player: player || ""
  }));
}

function getMyBookingInfo() {
  try {
    var raw = localStorage.getItem(MY_BOOKING_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function isMyReservation(slot) {
  var mine = getMyBookingInfo();
  if (!mine || !slot) return false;

  return normalizeText(mine.player) === normalizeText(slot.player) &&
         normalizeText(mine.alliance) === normalizeText(slot.alliance);
}

function getTabSetting(buff) {
  return bookingSettings.tabs[buff] || { manualOpen: true, openAt: "", closeAt: "" };
}

function parseLocalDateTime(value) {
  if (!value) return null;
  var date = new Date(value);
  if (isNaN(date.getTime())) return null;
  return date;
}

function isBuffBookingOpen(buff) {
  var setting = getTabSetting(buff);
  var now = new Date();

  if (!setting.manualOpen) return false;

  var openAt = parseLocalDateTime(setting.openAt);
  var closeAt = parseLocalDateTime(setting.closeAt);

  if (openAt && now < openAt) return false;
  if (closeAt && now > closeAt) return false;

  return true;
}

function updateTabBookingStateText() {
  var el = document.getElementById("tabBookingState");
  if (!el) return;

  var setting = getTabSetting(currentBuff);
  var open = isBuffBookingOpen(currentBuff);
  var parts = [
    "Current tab: " + currentBuff,
    open ? "Booking Open" : "Booking Closed"
  ];

  if (setting.openAt) parts.push("Open At: " + setting.openAt.replace("T", " "));
  if (setting.closeAt) parts.push("Close At: " + setting.closeAt.replace("T", " "));

  el.textContent = parts.join(" / ");
}

function getBaseDate() {
  var raw = bookingSettings.baseDate || "2026-03-28";
  var date = new Date(raw + "T12:00:00Z");
  if (isNaN(date.getTime())) {
    date = new Date("2026-03-28T12:00:00Z");
  }
  return date;
}

function getNextSvsDate() {
  var now = new Date();
  var base = getBaseDate();
  var next = new Date(base.getTime());
  var cycleMs = 28 * 24 * 60 * 60 * 1000;

  while (next <= now) {
    next = new Date(next.getTime() + cycleMs);
  }

  return next;
}

function updateCountdown() {
  var svsDate = getNextSvsDate();
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
    "Next SVS begins in " + d + "d " + h + "h " + m + "m";

  var cycleInfo = document.getElementById("svsCycleInfo");
  if (cycleInfo) {
    var utcText =
      svsDate.getUTCFullYear() + "." +
      String(svsDate.getUTCMonth() + 1).padStart(2, "0") + "." +
      String(svsDate.getUTCDate()).padStart(2, "0") + " " +
      String(svsDate.getUTCHours()).padStart(2, "0") + ":" +
      String(svsDate.getUTCMinutes()).padStart(2, "0") + " UTC";

    cycleInfo.textContent = "28-day cycle / Next SVS: " + utcText;
  }
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
  populateScheduleInputs();
  renderAll();
}

function formatSlotInfo(slotId) {
  if (!slotId) return "";
  var parts = slotId.split("_");
  var buff = parts[0];
  var start = parts[1];
  var endParts = start.split(":");
  var end = padTime(Number(endParts[0]), Number(endParts[1]) + 30);

  var date = new Date();
  date.setUTCHours(Number(endParts[0]), Number(endParts[1]), 0, 0);
  var localEndDate = new Date(date.getTime() + 30 * 60 * 1000);

  return [
    "Buff: " + buff,
    "UTC: " + start + " - " + end,
    "Local: " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) +
      " - " + localEndDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  ].join("<br>");
}

function openReserveModal(id) {
  if (!isBuffBookingOpen(currentBuff)) {
    showToast("현재 탭 예약이 닫혀 있습니다.", "error");
    return;
  }

  selectedSlot = id;
  var info = document.getElementById("selectedSlotInfo");
  if (info) info.innerHTML = formatSlotInfo(id);

  document.getElementById("modal").classList.add("show");
}

function closeModal() {
  document.getElementById("modal").classList.remove("show");

  ["alliance", "player", "daysSaved", "password"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.value = "";
  });

  selectedSlot = null;
  clearSelection();
}

function openReservedModal(id) {
  selectedSlot = id;
  var slot = allSlotsData[id];

  var info = document.getElementById("reservedSlotInfo");
  if (info) info.innerHTML = formatSlotInfo(id);

  var detail = document.getElementById("reservedDetail");
  if (detail && slot) {
    detail.innerHTML =
      "Alliance: " + escapeHtml(slot.alliance || "-") + "<br>" +
      "Player: " + escapeHtml(slot.player || "-") + "<br>" +
      "Use Speed-up: " + escapeHtml(slot.daysSaved || 0) + "<br>" +
      (slot.adminNote && adminAuthenticated ? ("Admin Note: " + escapeHtml(slot.adminNote)) : "");
  }

  var editAlliance = document.getElementById("editAlliance");
  var editDaysSaved = document.getElementById("editDaysSaved");
  var editPassword = document.getElementById("editPassword");

  if (editAlliance) editAlliance.value = slot ? (slot.alliance || "") : "";
  if (editDaysSaved) editDaysSaved.value = slot ? (slot.daysSaved || "") : "";
  if (editPassword) editPassword.value = "";

  document.getElementById("reservedModal").classList.add("show");

  if (adminAuthenticated) {
    adminSlotTarget = id;
    updateAdminSelectedSlotLabel();
  }
}

function closeReservedModal() {
  document.getElementById("reservedModal").classList.remove("show");
  ["editAlliance", "editDaysSaved", "editPassword"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.value = "";
  });
  selectedSlot = null;
  clearSelection();
}

function openAdmin() {
  document.getElementById("adminPanel").classList.add("show");
  populateScheduleInputs();
  updateAdminUserInfo();
  updateAdminSelectedSlotLabel();
  if (adminAuthenticated) loadLogs();
}

function closeAdmin() {
  document.getElementById("adminPanel").classList.remove("show");
}

function updateAdminSelectedSlotLabel() {
  var label = document.getElementById("adminSelectedSlotLabel");
  if (!label) return;
  label.textContent = adminSlotTarget ? ("선택 슬롯: " + adminSlotTarget) : "선택된 슬롯 없음";

  var noteInput = document.getElementById("adminNoteInput");
  if (noteInput) {
    noteInput.value = adminSlotTarget && allSlotsData[adminSlotTarget]
      ? (allSlotsData[adminSlotTarget].adminNote || "")
      : "";
  }
}

function updateAdminUserInfo() {
  var info = document.getElementById("adminUserInfo");
  if (!info) return;

  if (!currentUser) {
    info.textContent = "관리자 로그인이 필요합니다.";
    return;
  }

  info.textContent = "로그인: " + (currentUser.email || currentUser.uid);
}

function adminGoogleLogin() {
  auth.signInWithPopup(googleProvider)
    .then(function () {
      checkAdminStatus();
    })
    .catch(function (error) {
      console.error("adminGoogleLogin error:", error);
      showToast("Google 로그인 중 오류가 발생했습니다.", "error");
    });
}

function adminLogout() {
  auth.signOut()
    .then(function () {
      adminAuthenticated = false;
      currentUser = null;
      updateAdminUI();
      showToast("로그아웃되었습니다.", "success");
    })
    .catch(function (error) {
      console.error("adminLogout error:", error);
      showToast("로그아웃 중 오류가 발생했습니다.", "error");
    });
}

function checkAdminStatus() {
  currentUser = auth.currentUser || null;
  updateAdminUserInfo();

  if (!currentUser) {
    adminAuthenticated = false;
    updateAdminUI();
    return;
  }

  db.collection("admins").doc(currentUser.uid).get()
    .then(function (doc) {
      adminAuthenticated = doc.exists;
      updateAdminUI();
      if (adminAuthenticated) {
        showToast("관리자 인증 완료", "success");
        loadLogs();
      } else {
        showToast("이 계정은 관리자 권한이 없습니다.", "error");
      }
    })
    .catch(function (error) {
      console.error("checkAdminStatus error:", error);
      adminAuthenticated = false;
      updateAdminUI();
    });
}

function updateAdminUI() {
  var controls = document.getElementById("adminControls");
  if (controls) {
    controls.style.display = adminAuthenticated ? "flex" : "none";
  }
  updateAdminUserInfo();
}

function logAction(type, payload) {
  var actor = auth.currentUser;
  var data = {
    type: type,
    payload: payload || {},
    actorUid: actor ? actor.uid : null,
    actorEmail: actor ? (actor.email || "") : "",
    createdAt: firebase.firestore.FieldValue.serverTimestamp()
  };

  return db.collection("logs").add(data).catch(function (error) {
    console.error("logAction error:", error);
  });
}

function setManualBooking(buff, isOpen) {
  if (!adminAuthenticated) return;

  var data = {};
  data["tabs." + buff + ".manualOpen"] = isOpen;

  db.collection("settings").doc("booking").set(data, { merge: true })
    .then(function () {
      return logAction("set_manual_booking", { buff: buff, isOpen: isOpen });
    })
    .then(function () {
      showToast(isOpen ? "현재 탭 예약이 열렸습니다." : "현재 탭 예약이 잠겼습니다.", "success");
    })
    .catch(function (error) {
      console.error("setManualBooking error:", error);
      showToast("예약 설정 변경 중 오류가 발생했습니다.", "error");
    });
}

function populateScheduleInputs() {
  var setting = getTabSetting(currentBuff);
  var openEl = document.getElementById("scheduleOpenAt");
  var closeEl = document.getElementById("scheduleCloseAt");
  var baseEl = document.getElementById("svsBaseDateInput");

  if (openEl) openEl.value = setting.openAt || "";
  if (closeEl) closeEl.value = setting.closeAt || "";
  if (baseEl) baseEl.value = bookingSettings.baseDate || "";
}

function saveTabSchedule() {
  if (!adminAuthenticated) return;

  var openAt = (document.getElementById("scheduleOpenAt") || {}).value || "";
  var closeAt = (document.getElementById("scheduleCloseAt") || {}).value || "";

  var data = {};
  data["tabs." + currentBuff + ".openAt"] = openAt;
  data["tabs." + currentBuff + ".closeAt"] = closeAt;

  db.collection("settings").doc("booking").set(data, { merge: true })
    .then(function () {
      return logAction("save_schedule", {
        buff: currentBuff,
        openAt: openAt,
        closeAt: closeAt
      });
    })
    .then(function () {
      showToast("현재 탭 자동 일정이 저장되었습니다.", "success");
    })
    .catch(function (error) {
      console.error("saveTabSchedule error:", error);
      showToast("일정 저장 중 오류가 발생했습니다.", "error");
    });
}

function saveSvsBaseDate() {
  if (!adminAuthenticated) return;

  var value = (document.getElementById("svsBaseDateInput") || {}).value || "";
  if (!value) {
    showToast("기준일을 입력해주세요.", "error");
    return;
  }

  db.collection("settings").doc("booking").set({ baseDate: value }, { merge: true })
    .then(function () {
      return logAction("save_base_date", { baseDate: value });
    })
    .then(function () {
      showToast("SVS 기준일이 저장되었습니다.", "success");
      updateCountdown();
    })
    .catch(function (error) {
      console.error("saveSvsBaseDate error:", error);
      showToast("기준일 저장 중 오류가 발생했습니다.", "error");
    });
}

function getFilteredSlotIds() {
  var search = normalizeText((document.getElementById("searchInput") || {}).value || "");
  var filterStatus = (document.getElementById("filterStatus") || {}).value || "all";

  var ids = [];
  for (var h = 0; h < 24; h++) {
    for (var m = 0; m < 60; m += 30) {
      ids.push(currentBuff + "_" + padTime(h, m));
    }
  }

  return ids.filter(function (id) {
    var slot = allSlotsData[id];
    var mine = slot && isMyReservation(slot);

    if (filterStatus === "available" && slot) return false;
    if (filterStatus === "reserved" && !slot) return false;
    if (filterStatus === "mine" && !mine) return false;

    if (!search) return true;
    if (!slot) return false;

    return normalizeText(slot.alliance).indexOf(search) >= 0 ||
           normalizeText(slot.player).indexOf(search) >= 0;
  });
}

function updateCounts(filteredIds) {
  var reserved = 0;
  var available = 0;
  var mine = 0;

  filteredIds.forEach(function (id) {
    var slot = allSlotsData[id];
    if (slot) {
      reserved++;
      if (isMyReservation(slot)) mine++;
    } else {
      available++;
    }
  });

  document.getElementById("availableCount").innerText = "Available " + available;
  document.getElementById("reservedCount").innerText = "Reserved " + reserved;
  document.getElementById("myCount").innerText = "My Reservation " + mine;
}

function generateSlots() {
  grid.innerHTML = "";
  var filteredIds = getFilteredSlotIds();
  var open = isBuffBookingOpen(currentBuff);

  filteredIds.forEach(function (id) {
    var slot = allSlotsData[id];
    var utcStart = id.replace(currentBuff + "_", "");
    var parts = utcStart.split(":");
    var utcEnd = padTime(Number(parts[0]), Number(parts[1]) + 30);

    var localDate = new Date();
    localDate.setUTCHours(Number(parts[0]), Number(parts[1]), 0, 0);
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

    if (slot && isMyReservation(slot)) {
      div.classList.add("myReservation");
    }

    if (!open && !slot) {
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

      var html =
        '<div class="timeRow">' +
          '<span class="timeUTC">' + utcStart + ' - ' + utcEnd + ' UTC</span>' +
          '<span class="statusReserved">Reserved</span>' +
        '</div>' +
        '<div class="timeLocal">' + localStart + ' - ' + localEnd + '</div>' +
  '<div class="bookingInfo compact">' +
    '[' + escapeHtml(slot.alliance || "-") + '] ' +
    escapeHtml(slot.player || "-") +
    ' <span class="bookingMeta">· ' + escapeHtml(slot.daysSaved || 0) + 'd</span>' +
  '</div>';
      
      if (isMyReservation(slot)) {
        html += '<div class="statusMine">★ My reservation</div>';
      }

      if (slot.adminNote && adminAuthenticated) {
        html += '<div class="adminNotePreview">Admin Note: ' + escapeHtml(slot.adminNote) + '</div>';
      }

      div.innerHTML = html;

      div.onclick = (function (slotId, el) {
        return function () {
          highlightSlot(el, false);
          openReservedModal(slotId);
        };
      })(id, div);
    }

    grid.appendChild(div);
  });

  updateCounts(filteredIds);
}

function renderAll() {
  generateSlots();
  updateTabBookingStateText();
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
      if (doc.exists) {
        var data = doc.data();
        bookingSettings.baseDate = data.baseDate || bookingSettings.baseDate;
        bookingSettings.tabs = data.tabs || bookingSettings.tabs;
      }
      populateScheduleInputs();
      updateCountdown();
      renderAll();
    },
    function (error) {
      console.error("booking onSnapshot error:", error);
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
      updateAdminSelectedSlotLabel();
    },
    function (error) {
      console.error("slots onSnapshot error:", error);
    }
  );
}

function loadSlots() {
  attachRealtimeListeners();
}

function validateBookingInput(alliance, player, daysSavedRaw, password) {
  if (!alliance || !player || !daysSavedRaw || !password) {
    return "모든 항목을 입력해주세요.";
  }

  if (alliance.length < 2 || alliance.length > 20) {
    return "Alliance는 2~20자로 입력해주세요.";
  }

  if (player.length < 2 || player.length > 20) {
    return "Player는 2~20자로 입력해주세요.";
  }

  if (password.length < 4 || password.length > 30) {
    return "비밀번호는 4~30자로 입력해주세요.";
  }

  var daysSaved = Number(daysSavedRaw);
  if (isNaN(daysSaved) || daysSaved < 0 || daysSaved > 9999) {
    return "Use Speed-up 값을 올바르게 입력해주세요.";
  }

  return "";
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

  if (!isBuffBookingOpen(currentBuff)) {
    showToast("현재 탭 예약이 닫혀 있습니다.", "error");
    return;
  }

  var alliance = allianceEl.value.trim();
  var player = playerEl.value.trim();
  var daysSavedRaw = daysSavedEl.value.trim();
  var password = passwordEl.value;

  var validationError = validateBookingInput(alliance, player, daysSavedRaw, password);
  if (validationError) {
    showToast(validationError, "error");
    return;
  }

  var daysSaved = Number(daysSavedRaw);
  var playerNorm = normalizeText(player);

  var slotRef = db.collection("slots").doc(selectedSlot);

  // 같은 buff + 같은 player 1개 제한용 잠금 문서
  var playerLockId = currentBuff + "__" + playerNorm;
  var playerLockRef = db.collection("playerBookings").doc(playerLockId);

  db.runTransaction(function (transaction) {
    return transaction.get(slotRef).then(function (slotDoc) {
      if (slotDoc.exists) {
        throw new Error("ALREADY_RESERVED");
      }

      return transaction.get(playerLockRef).then(function (lockDoc) {
        if (lockDoc.exists) {
          throw new Error("PLAYER_ALREADY_BOOKED");
        }

        transaction.set(slotRef, {
          alliance: alliance,
          player: player,
          playerNormalized: playerNorm,
          daysSaved: daysSaved,
          passwordHash: simpleHash(password),
          buff: currentBuff,
          utcSlot: selectedSlot.replace(currentBuff + "_", ""),
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          adminNote: "",
          status: "reserved"
        });

        transaction.set(playerLockRef, {
          slotId: selectedSlot,
          buff: currentBuff,
          player: player,
          playerNormalized: playerNorm,
          createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
      });
    });
  })
    .then(function () {
      saveAllianceRecent(alliance);
      saveMyBookingInfo(alliance, player);
      recentBookedSlotId = selectedSlot;

      return logAction("reserve", {
        slotId: selectedSlot,
        buff: currentBuff,
        alliance: alliance,
        player: player,
        daysSaved: daysSaved
      });
    })
    .then(function () {
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
      } else if (error.message === "PLAYER_ALREADY_BOOKED") {
        showToast("같은 player는 같은 buff에 1개만 예약 가능합니다.", "error");
      } else {
        showToast("예약 중 오류가 발생했습니다.", "error");
      }
    });
}

function confirmUpdateBooking() {
  if (!selectedSlot) {
    showToast("수정할 슬롯을 먼저 선택해주세요.", "error");
    return;
  }

  var alliance = ((document.getElementById("editAlliance") || {}).value || "").trim();
  var daysSavedRaw = ((document.getElementById("editDaysSaved") || {}).value || "").trim();
  var password = ((document.getElementById("editPassword") || {}).value || "");

  if (!alliance || !daysSavedRaw || !password) {
    showToast("Alliance, Use Speed-up, Password를 입력해주세요.", "error");
    return;
  }

  var daysSaved = Number(daysSavedRaw);
  if (isNaN(daysSaved) || daysSaved < 0 || daysSaved > 9999) {
    showToast("Use Speed-up 값을 올바르게 입력해주세요.", "error");
    return;
  }

  var docRef = db.collection("slots").doc(selectedSlot);
  var beforeData = null;

  db.runTransaction(function (transaction) {
    return transaction.get(docRef).then(function (doc) {
      if (!doc.exists) {
        throw new Error("NOT_FOUND");
      }

      var data = doc.data();
      beforeData = data;

      if (data.passwordHash !== simpleHash(password)) {
        throw new Error("WRONG_PASSWORD");
      }

      transaction.update(docRef, {
        alliance: alliance,
        daysSaved: daysSaved,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      });
    });
  })
    .then(function () {
      saveAllianceRecent(alliance);
      saveMyBookingInfo(alliance, beforeData.player);

      return logAction("update_reservation", {
        slotId: selectedSlot,
        before: {
          alliance: beforeData.alliance,
          daysSaved: beforeData.daysSaved
        },
        after: {
          alliance: alliance,
          daysSaved: daysSaved
        }
      });
    })
    .then(function () {
      closeReservedModal();
      showToast("예약이 수정되었습니다.", "success");
    })
    .catch(function (error) {
      console.error("confirmUpdateBooking error:", error);
      if (error.message === "NOT_FOUND") {
        showToast("예약 정보를 찾을 수 없습니다.", "error");
      } else if (error.message === "WRONG_PASSWORD") {
        showToast("비밀번호가 올바르지 않습니다.", "error");
      } else {
        showToast("수정 중 오류가 발생했습니다.", "error");
      }
    });
}

function confirmCancel() {
  if (!selectedSlot) {
    showToast("취소할 슬롯을 먼저 선택해주세요.", "error");
    return;
  }

  var password = ((document.getElementById("editPassword") || {}).value || "");
  var slotRef = db.collection("slots").doc(selectedSlot);
  var deletedData = null;

  db.runTransaction(function (transaction) {
    return transaction.get(slotRef).then(function (doc) {
      if (!doc.exists) {
        throw new Error("NOT_FOUND");
      }

      var data = doc.data();
      deletedData = data;

      if (data.passwordHash !== simpleHash(password)) {
        throw new Error("WRONG_PASSWORD");
      }

      var playerLockId = data.buff + "__" + normalizeText(data.player);
      var playerLockRef = db.collection("playerBookings").doc(playerLockId);

      transaction.delete(slotRef);
      transaction.delete(playerLockRef);
    });
  })
    .then(function () {
      return logAction("cancel_reservation", {
        slotId: selectedSlot,
        buff: deletedData.buff,
        alliance: deletedData.alliance,
        player: deletedData.player
      });
    })
    .then(function () {
      closeReservedModal();
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

function saveAdminNote() {
  if (!adminAuthenticated) return;
  if (!adminSlotTarget) {
    showToast("메모를 저장할 슬롯을 먼저 선택해주세요.", "error");
    return;
  }

  var note = ((document.getElementById("adminNoteInput") || {}).value || "").trim();
  var docRef = db.collection("slots").doc(adminSlotTarget);
  var beforeNote = allSlotsData[adminSlotTarget] ? (allSlotsData[adminSlotTarget].adminNote || "") : "";

  docRef.set({
    adminNote: note,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true })
    .then(function () {
      return logAction("save_admin_note", {
        slotId: adminSlotTarget,
        before: beforeNote,
        after: note
      });
    })
    .then(function () {
      showToast("관리자 메모가 저장되었습니다.", "success");
    })
    .catch(function (error) {
      console.error("saveAdminNote error:", error);
      showToast("관리자 메모 저장 중 오류가 발생했습니다.", "error");
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

function buildCsvRows(keys) {
  var rows = [["Buff", "UTC Slot", "Alliance", "Player", "Use Speed-up", "Admin Note"]];
  keys.sort().forEach(function (key) {
    var slot = allSlotsData[key];
    if (!slot) return;
    rows.push([
      slot.buff || "",
      slot.utcSlot || key.replace((slot.buff || "") + "_", ""),
      slot.alliance || "",
      slot.player || "",
      slot.daysSaved || "",
      slot.adminNote || ""
    ]);
  });
  return rows;
}

function exportCurrentBuffCSV() {
  if (!adminAuthenticated) return;

  var keys = Object.keys(allSlotsData).filter(function (key) {
    return key.indexOf(currentBuff + "_") === 0;
  });

  downloadCSV("svs_" + currentBuff + "_booking.csv", buildCsvRows(keys));
  showToast("현재 탭 CSV를 내보냈습니다.", "success");
}

function exportAllCSV() {
  if (!adminAuthenticated) return;

  var keys = Object.keys(allSlotsData);
  downloadCSV("svs_all_booking.csv", buildCsvRows(keys));
  showToast("전체 CSV를 내보냈습니다.", "success");
}

function askDeleteConfirm(message) {
  var input = prompt(message + "\n확인 문구를 정확히 입력하세요: DELETE");
  return input === "DELETE";
}

function backupAndClearCurrentBuff() {
  if (!adminAuthenticated) return;
  if (!askDeleteConfirm("현재 탭 백업 후 삭제하시겠습니까?")) {
    showToast("삭제가 취소되었습니다.", "error");
    return;
  }

  exportCurrentBuffCSV();

  db.collection("slots").get()
    .then(function (snapshot) {
      var batch = db.batch();

      snapshot.forEach(function (doc) {
        var data = doc.data();
        if (doc.id.indexOf(currentBuff + "_") === 0) {
          batch.delete(doc.ref);

          if (data && data.player) {
            var playerLockId = data.buff + "__" + normalizeText(data.player);
            var playerLockRef = db.collection("playerBookings").doc(playerLockId);
            batch.delete(playerLockRef);
          }
        }
      });

      return batch.commit();
    })
    .then(function () {
      return logAction("clear_current_buff", { buff: currentBuff });
    })
    .then(function () {
      showToast("현재 탭 예약이 백업 후 삭제되었습니다.", "success");
    })
    .catch(function (error) {
      console.error("backupAndClearCurrentBuff error:", error);
      showToast("현재 탭 삭제 중 오류가 발생했습니다.", "error");
    });
}

function backupAndClearAll() {
  if (!adminAuthenticated) return;
  if (!askDeleteConfirm("전체 예약을 백업 후 삭제하시겠습니까?")) {
    showToast("삭제가 취소되었습니다.", "error");
    return;
  }

  exportAllCSV();

  db.collection("slots").get()
    .then(function (snapshot) {
      var batch = db.batch();

      snapshot.forEach(function (doc) {
        var data = doc.data();
        batch.delete(doc.ref);

        if (data && data.player) {
          var playerLockId = data.buff + "__" + normalizeText(data.player);
          var playerLockRef = db.collection("playerBookings").doc(playerLockId);
          batch.delete(playerLockRef);
        }
      });

      return batch.commit();
    })
    .then(function () {
      return logAction("clear_all", {});
    })
    .then(function () {
      showToast("전체 예약이 백업 후 삭제되었습니다.", "success");
    })
    .catch(function (error) {
      console.error("backupAndClearAll error:", error);
      showToast("전체 삭제 중 오류가 발생했습니다.", "error");
    });
}
function renderLogs(snapshot) {
  var box = document.getElementById("logsBox");
  if (!box) return;

  box.innerHTML = "";

  if (!snapshot || snapshot.empty) {
    box.innerHTML = '<div class="logItem">로그가 없습니다.</div>';
    return;
  }

  snapshot.forEach(function (doc) {
    var data = doc.data();
    var item = document.createElement("div");
    item.className = "logItem";

    var timeText = "";
    if (data.createdAt && data.createdAt.toDate) {
      timeText = data.createdAt.toDate().toLocaleString();
    }

    item.innerHTML =
      '<strong>' + escapeHtml(data.type || "-") + '</strong><br>' +
      'Time: ' + escapeHtml(timeText) + '<br>' +
      'Actor: ' + escapeHtml(data.actorEmail || data.actorUid || "user") + '<br>' +
      'Detail: ' + escapeHtml(JSON.stringify(data.payload || {}));

    box.appendChild(item);
  });
}

function loadLogs() {
  if (!adminAuthenticated) return;

  if (logsUnsubscribe) {
    logsUnsubscribe();
    logsUnsubscribe = null;
  }

  logsUnsubscribe = db.collection("logs")
    .orderBy("createdAt", "desc")
    .limit(30)
    .onSnapshot(
      function (snapshot) {
        renderLogs(snapshot);
      },
      function (error) {
        console.error("loadLogs error:", error);
      }
    );
}

function clearSearch() {
  var input = document.getElementById("searchInput");
  var filter = document.getElementById("filterStatus");

  if (input) input.value = "";
  if (filter) filter.value = "all";
  renderAll();
}

var searchInput = document.getElementById("searchInput");
if (searchInput) {
  searchInput.addEventListener("input", function () {
    renderAll();
  });
}

/* secret admin open by snow x3 */
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

/* snow animation */
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

auth.onAuthStateChanged(function (user) {
  currentUser = user || null;
  checkAdminStatus();
});

window.addEventListener("resize", resizeCanvas);
setInterval(updateCountdown, 60000);

updateCountdown();
setActiveTab();
renderAllianceSuggestions();
initSnow();
drawSnow();
loadSlots();
