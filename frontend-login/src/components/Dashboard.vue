<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { io } from 'socket.io-client'
import axios from 'axios'

const showProfile = ref(false)
const adminName   = ref('Administrator')
const currentPower       = ref(0)
const currentVoltage     = ref(220)
const currentAmpere      = ref(0)
const currentTemperature = ref(0)
const currentHumidity    = ref(0)
const todaysCost     = ref(0)
const todaysUsageKwh = ref(0)
const weeklyEnergy   = ref(58.7)
const isConnected  = ref(false)
const isSimulating = ref(false)

const activeTab    = ref('Real-Time')
const activeEnvTab = ref('Temperature')
const showVoltsAmps = ref(false)

const powerHistory = ref([])
const tempHistory  = ref([])
const logs = ref([])

// ── THEME ─────────────────────────────────────────────────────────────────────
const isDark = ref(true)
function toggleTheme() {
  isDark.value = !isDark.value
  document.body.setAttribute('data-theme', isDark.value ? 'dark' : 'light')
}

// ── LOG EXPORT & MEMORY MANAGEMENT ───────────────────────────────────────────
const triggerLogDownload = (logArray, isAuto = false) => {
  if (logArray.length === 0) { if (!isAuto) alert("No logs to download!"); return; }
  let logText = "CCIS Power Monitoring - Activity Logs\n";
  logText += "Generated: " + new Date().toLocaleString() + (isAuto ? " (AUTO-EXPORT)" : "") + "\n";
  logText += "---------------------------------------------------\n\n";
  const reversedLogs = [...logArray].reverse();
  reversedLogs.forEach((log) => {
    logText += `[${log.timestamp}] EVENT: ${log.event}\n`;
    logText += `DETAILS: ${log.details}\n`;
    logText += "---------------------------------------------------\n";
  });
  const blob = new Blob([logText], { type: 'text/plain;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  let hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  const timeStr = `${hours}-${minutes}-${ampm}`;
  const uniqueNum = Math.floor(1000 + Math.random() * 9000);
  const prefix = isAuto ? 'CCIS_Auto_Export' : 'CCIS_Activity_Logs';
  link.download = `${prefix}_${dateStr}_${timeStr}_${uniqueNum}.txt`;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
};
const downloadLogsAsText = () => triggerLogDownload(logs.value, false);

function addLogEntry(event, details) {
  const ts = new Date().toLocaleString('en-PH', { month:'2-digit', day:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', hour12:true });
  logs.value.unshift({ timestamp: ts, event, details });
  if (logs.value.length >= 200) {
    triggerLogDownload(logs.value, true);
    logs.value = [];
    logs.value.push({ timestamp: ts, event: 'SYSTEM', details: 'Logs reached 200 limit. Auto-exported to file and cleared to preserve memory.' });
  }
}

// ── STATUS CHECKERS ───────────────────────────────────────────────────────────
const getTempStatus = (v, thresh = 28)  => v >= thresh ? 'High' : 'Normal'
const getHumStatus  = (v, thresh = 70)  => v >= thresh ? 'High' : 'Normal'
const getPwrStatus  = (v, thresh = 500) => v >= thresh ? 'High' : 'Normal'

const selectedViewRoom  = ref(null)
const showViewDropdown  = ref(false)
function selectViewRoom(id) { selectedViewRoom.value = id; showViewDropdown.value = false }
function onDocClick(e) {
  if (!e.target.closest('.view-dropdown-wrap')) showViewDropdown.value = false
  if (!e.target.closest('.profile-wrap'))       showProfile.value      = false
  if (!e.target.closest('.notif-wrap'))         showNotifications.value = false
}

// ── NOTIFICATION SYSTEM ───────────────────────────────────────────────────────
const systemAlerts      = ref([])
const showNotifications = ref(false)
const unreadAlertsCount = ref(0)
const alertCooldowns    = {}
const ALERT_COOLDOWN_MS = 60000 * 2

function toggleNotifications() {
  showNotifications.value = !showNotifications.value;
  if (showNotifications.value) markAlertsAsRead();
  showProfile.value = false;
}
function markAlertsAsRead() {
  unreadAlertsCount.value = 0;
  systemAlerts.value.forEach(a => a.read = true);
}
function clearAlerts() {
  systemAlerts.value = []; unreadAlertsCount.value = 0; showNotifications.value = false;
}
function triggerAlert(room, type, value, threshold, unit) {
  const alertKey = `${room.id}-${type}`;
  const now = Date.now();
  if (alertCooldowns[alertKey] && (now - alertCooldowns[alertKey] < ALERT_COOLDOWN_MS)) return;
  alertCooldowns[alertKey] = now;
  const id = Math.random().toString(36).substr(2, 9);
  const ts = new Date().toLocaleString('en-PH',{month:'2-digit',day:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:true});
  systemAlerts.value.unshift({ id, roomId: room.id, roomName: room.name, type, message: `${type} is critically high: ${value}${unit} (Limit: ${threshold}${unit})`, timestamp: ts, read: false });
  if (systemAlerts.value.length > 50) systemAlerts.value.pop();
  unreadAlertsCount.value++;
  const logDetails = `[${room.name}] 🚨 ${type} BREACH 🚨 Actual: ${value}${unit} (Limit: ${threshold}${unit}) | Pwr: ${room.power}W, Temp: ${room.temp}°C, Hum: ${room.humidity}%`;
  addLogEntry('SYSTEM ALERT', logDetails);
}

// ── THRESHOLD CONTROLLER ──────────────────────────────────────────────────────
const showThresholdModal = ref(false)
const isSavingThresholds = ref(false)
const editLimits = ref({ id: null, temp: 28, hum: 70, pwr: 500, name: '' })

function openThresholdEditor(room) {
  editLimits.value = { id: room.id, name: room.name, temp: room.tempThreshold || 28, hum: room.humThreshold || 70, pwr: room.pwrThreshold || 500 };
  showThresholdModal.value = true;
}
async function saveThresholds() {
  isSavingThresholds.value = true;
  try {
    await axios.patch(`http://localhost:3000/rooms/${editLimits.value.id}`, { tempThreshold: editLimits.value.temp, humThreshold: editLimits.value.hum, pwrThreshold: editLimits.value.pwr });
    const room = rooms.value.find(r => r.id === editLimits.value.id);
    if (room) {
      room.tempThreshold = editLimits.value.temp; room.humThreshold = editLimits.value.hum; room.pwrThreshold = editLimits.value.pwr;
      room.tempStatus = getTempStatus(room.temp, room.tempThreshold); room.humStatus = getHumStatus(room.humidity, room.humThreshold); room.pwrStatus = getPwrStatus(room.power, room.pwrThreshold);
    }
    showThresholdModal.value = false;
  } catch (err) { console.error(err); alert("Failed to save thresholds."); }
  finally { isSavingThresholds.value = false; }
}

// ── ROOM COLORS ───────────────────────────────────────────────────────────────
const ROOM_PALETTE = [
  { accent: '#c8e63c', bg: '#1a2a0a', border: '#c8e63c44', pill: '#1f3a0f' },
  { accent: '#36d1dc', bg: '#0a2a2e', border: '#36d1dc44', pill: '#0f3035' },
  { accent: '#f0a500', bg: '#2a1e00', border: '#f0a50044', pill: '#362600' },
  { accent: '#e05aff', bg: '#1e0a2a', border: '#e05aff44', pill: '#280f36' },
  { accent: '#ff6b6b', bg: '#2a0e0e', border: '#ff6b6b44', pill: '#351212' },
  { accent: '#5b86e5', bg: '#0e1a2e', border: '#5b86e544', pill: '#121f38' },
  { accent: '#00d97e', bg: '#002a1a', border: '#00d97e44', pill: '#003522' },
  { accent: '#ff9f43', bg: '#2a1800', border: '#ff9f4344', pill: '#352000' },
]
function getRoomColor(roomId) {
  const idx = rooms.value.findIndex(r => r.id === roomId);
  return ROOM_PALETTE[Math.max(0, idx) % ROOM_PALETTE.length];
}
const viewAccent = computed(() => selectedViewRoom.value ? getRoomColor(selectedViewRoom.value).accent : '#c8e63c')
const viewBg     = computed(() => selectedViewRoom.value ? getRoomColor(selectedViewRoom.value).bg     : '#1a2a0a')
const viewBorder = computed(() => selectedViewRoom.value ? getRoomColor(selectedViewRoom.value).border : '#c8e63c44')

const historyVersion = ref(0)
const roomHistories  = ref({})

function ensureRoomHistory(roomId) {
  if (!roomHistories.value[roomId]) roomHistories.value[roomId] = { power: [], temp: [] };
}
function pushRoomPower(roomId, value) {
  ensureRoomHistory(roomId);
  const arr = roomHistories.value[roomId].power;
  arr.push({ value }); if (arr.length > 60) arr.shift();
  roomHistories.value[roomId].power = [...arr]; historyVersion.value++;
}
function pushRoomTemp(roomId, temp, humidity) {
  ensureRoomHistory(roomId);
  const arr = roomHistories.value[roomId].temp;
  arr.push({ temp, humidity }); if (arr.length > 60) arr.shift();
  roomHistories.value[roomId].temp = [...arr]; historyVersion.value++;
}

const rooms = ref([])

const fetchRooms = async () => {
  try {
    const response = await axios.get('http://localhost:3000/rooms');
    if (response.data) {
      rooms.value = response.data.map(r => {
        const tThresh = r.tempThreshold || 28, hThresh = r.humThreshold || 70, pThresh = r.pwrThreshold || 500;
        return { ...r, voltage: r.voltage || 0, ampere: r.ampere || 0, power: r.power || 0, temp: r.temp || 0, humidity: r.humidity || 0, tempThreshold: tThresh, humThreshold: hThresh, pwrThreshold: pThresh, tempStatus: getTempStatus(r.temp || 0, tThresh), humStatus: getHumStatus(r.humidity || 0, hThresh), pwrStatus: getPwrStatus(r.power || 0, pThresh) };
      });
      rooms.value.forEach(r => ensureRoomHistory(r.id));
    }
  } catch (error) { console.warn("Could not fetch rooms from DB.", error); }
};
const fetchInitialData = async () => {
  try {
    const response = await axios.get('http://localhost:3000/sensors/latest');
    if (response.data) applySensorData({ roomId: response.data.roomId, voltage: response.data.voltage, ampere: response.data.ampere, temperature: response.data.temperature, humidity: response.data.humidity, power: response.data.power });
  } catch (error) { console.warn("Couldn't reach the database for initial sensor data"); }
};

const showAddRoom = ref(false); const newRoomName = ref(''); const isAddingRoom = ref(false)
async function addRoom() {
  const name = newRoomName.value.trim(); if (!name) return;
  isAddingRoom.value = true;
  const generatedId = name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Math.floor(Math.random() * 1000);
  try {
    const response = await axios.post('http://localhost:3000/rooms', { id: generatedId, name });
    rooms.value.push({ ...response.data, voltage: 0, ampere: 0, power: 0, temp: 0, humidity: 0, tempThreshold: 28, humThreshold: 70, pwrThreshold: 500, tempStatus: 'Normal', humStatus: 'Normal', pwrStatus: 'Normal' });
    ensureRoomHistory(response.data.id);
    newRoomName.value = ''; showAddRoom.value = false;
  } catch (err) { console.error(err); alert("Error saving room to DB."); }
  finally { isAddingRoom.value = false; }
}

const showRenameRoom = ref(false); const renameTarget = ref(null); const renameValue = ref(''); const isRenaming = ref(false)
function openRename(room) { renameTarget.value = room; renameValue.value = room.name; showRenameRoom.value = true; showRoomDetail.value = false; }
async function confirmRename() {
  const n = renameValue.value.trim(); if (!n || !renameTarget.value) return;
  isRenaming.value = true;
  try {
    await axios.patch(`http://localhost:3000/rooms/${renameTarget.value.id}`, { name: n });
    renameTarget.value.name = n; showRenameRoom.value = false; renameTarget.value = null;
  } catch (err) { console.error(err); alert("Failed to rename room in DB."); }
  finally { isRenaming.value = false; }
}

const showDeleteConfirm = ref(false); const deleteTargetId = ref(null); const deleteTargetName = ref(''); const isDeleting = ref(false)
function requestDelete(roomId, roomName) { deleteTargetId.value = roomId; deleteTargetName.value = roomName; showDeleteConfirm.value = true; showRoomDetail.value = false; }
async function confirmDeleteRoom() {
  if (!deleteTargetId.value) return;
  isDeleting.value = true;
  try {
    await axios.delete(`http://localhost:3000/rooms/${encodeURIComponent(deleteTargetId.value)}`);
    rooms.value = rooms.value.filter(r => r.id !== deleteTargetId.value);
    delete roomHistories.value[deleteTargetId.value];
    if (selectedIotRoom.value === deleteTargetId.value) selectedIotRoom.value = null;
    if (selectedRoom.value?.id === deleteTargetId.value) closeRoomDetail();
    if (selectedViewRoom.value === deleteTargetId.value) selectedViewRoom.value = null;
    showDeleteConfirm.value = false; deleteTargetId.value = null; deleteTargetName.value = '';
  } catch (err) { console.error(err); alert("Failed to delete room."); }
  finally { isDeleting.value = false; }
}
function cancelDelete() { showDeleteConfirm.value = false; deleteTargetId.value = null; deleteTargetName.value = ''; }

const showReportModal = ref(false); const isDownloading = ref(false)
const downloadReport = async (timeframe) => {
  isDownloading.value = true;
  try {
    const response = await fetch(`http://localhost:3000/sensors/report/download?type=${timeframe}`);
    if (!response.ok) throw new Error('Network response was not ok');
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.setAttribute('download', `CCIS_Audit_${timeframe}.pdf`);
    document.body.appendChild(link); link.click(); link.remove();
    window.URL.revokeObjectURL(url); showReportModal.value = false;
  } catch (error) { console.error('Failed to download report:', error); alert('Error generating report. Is the NestJS backend running?'); }
  finally { isDownloading.value = false; }
};

// ── IOT ───────────────────────────────────────────────────────────────────────
const selectedIotRoom = ref(null); const iotState = ref({})
function getIot(roomId) {
  if (!iotState.value[roomId]) iotState.value[roomId] = { acOn: false, acTemp: 24, roomPowered: false, lightsOn: false };
  return iotState.value[roomId];
}
function adjustTemp(roomId, delta) { const s = getIot(roomId); s.acTemp = Math.min(30, Math.max(16, s.acTemp + delta)); }
function toggleLights(roomId) { const s = getIot(roomId); if (!s.roomPowered) return; s.lightsOn = !s.lightsOn; }
function toggleRoomPower(roomId) { const s = getIot(roomId); s.roomPowered = !s.roomPowered; if (!s.roomPowered) { s.acOn = false; s.lightsOn = false; } }

const roomPage = ref(0), roomSliding = ref(false), slideDirection = ref('left')
let roomRotateTimer = null
const totalPages   = computed(() => Math.max(1, Math.ceil(rooms.value.length / 4)))
const visibleRooms = computed(() => rooms.value.slice(roomPage.value * 4, roomPage.value * 4 + 4))
function goToPage(page, dir = 'left') {
  if (roomSliding.value || page === roomPage.value) return;
  slideDirection.value = dir; roomSliding.value = true;
  setTimeout(() => { roomPage.value = page; roomSliding.value = false; }, 380);
}
function startRoomRotation() {
  roomRotateTimer = setInterval(() => {
    if (rooms.value.length === 0) return;
    goToPage((roomPage.value + 1) % Math.max(1, Math.ceil(rooms.value.length / 4)), 'left');
  }, 5000);
}
function stopRoomRotation() { clearInterval(roomRotateTimer); roomRotateTimer = null; }
const showAllRooms = ref(false); const selectedRoom = ref(null); const showRoomDetail = ref(false)
function openRoomDetail(room) { selectedRoom.value = room; showRoomDetail.value = true; }
function closeRoomDetail() { showRoomDetail.value = false; setTimeout(() => { selectedRoom.value = null; }, 300); }

// ── COMPUTED DATA ─────────────────────────────────────────────────────────────
const activeVoltage = computed(() => {
  void historyVersion.value;
  if (selectedViewRoom.value) { const r = rooms.value.find(r => r.id === selectedViewRoom.value); return r ? Number(r.voltage || 0).toFixed(2) : "0.00"; }
  return Number(currentVoltage.value || 0).toFixed(2);
})
const activeAmpere = computed(() => {
  void historyVersion.value;
  if (selectedViewRoom.value) { const r = rooms.value.find(r => r.id === selectedViewRoom.value); return r ? Number(r.ampere || 0).toFixed(2) : "0.00"; }
  return Number(currentAmpere.value || 0).toFixed(2);
})
const activePowerHistory = computed(() => { void historyVersion.value; if (selectedViewRoom.value) return roomHistories.value[selectedViewRoom.value]?.power || []; return powerHistory.value; })
const activeTempHistory  = computed(() => { void historyVersion.value; if (selectedViewRoom.value) return roomHistories.value[selectedViewRoom.value]?.temp  || []; return tempHistory.value; })
const activeTemp = computed(() => {
  void historyVersion.value;
  if (selectedViewRoom.value) { const r = rooms.value.find(r => r.id === selectedViewRoom.value); return r ? r.temp : 0; }
  return rooms.value.length ? +(rooms.value.reduce((s,r)=>s+r.temp,0)/rooms.value.length).toFixed(1) : 0;
})
const activeHumidity = computed(() => {
  void historyVersion.value;
  if (selectedViewRoom.value) { const r = rooms.value.find(r => r.id === selectedViewRoom.value); return r ? r.humidity : 0; }
  return rooms.value.length ? +(rooms.value.reduce((s,r)=>s+r.humidity,0)/rooms.value.length).toFixed(1) : 0;
})
const activePowerVal = computed(() => {
  void historyVersion.value;
  if (selectedViewRoom.value) { const r = rooms.value.find(r => r.id === selectedViewRoom.value); return r ? r.power : 0; }
  return rooms.value.reduce((s,r)=>s+r.power,0);
})
const maxPower = computed(() => activePowerHistory.value.length ? Math.max(...activePowerHistory.value.map(d => d.value)) : 0)
const minPower = computed(() => activePowerHistory.value.length ? Math.min(...activePowerHistory.value.map(d => d.value)) : 0)

const CW = 720, CH = 120, TH = 90

function getGlobalPowerPeak() {
  void historyVersion.value;
  let peak = 200;
  rooms.value.forEach(room => { const d = roomHistories.value[room.id]?.power || []; if (d.length) peak = Math.max(peak, ...d.map(p => p.value)); });
  return peak * 1.15;
}
function buildRoomPowerPath(roomId) {
  void historyVersion.value;
  const d = roomHistories.value[roomId]?.power || []; if (d.length < 2) return '';
  const peak = getGlobalPowerPeak();
  return d.map((p, i) => { const x=(i/(d.length-1))*CW; const y=CH-(p.value/peak)*CH; return `${i===0?'M':'L'}${x.toFixed(1)},${Math.max(2,y).toFixed(1)}`; }).join(' ');
}
function getRoomLastPoint(roomId) {
  void historyVersion.value;
  const d = roomHistories.value[roomId]?.power || []; if (!d.length) return null;
  const peak = getGlobalPowerPeak(); const last = d[d.length-1];
  return { x: CW, y: Math.max(2, CH-(last.value/peak)*CH) };
}
function getGlobalTempRange() {
  void historyVersion.value;
  let tMin=60, tMax=0;
  rooms.value.forEach(room => { const d=roomHistories.value[room.id]?.temp||[]; d.forEach(p=>{tMin=Math.min(tMin,p.temp);tMax=Math.max(tMax,p.temp);}); });
  if (tMax===0&&tMin===60){tMin=20;tMax=40;}
  tMin-=1;tMax+=1; return {tMin,tMax,range:tMax-tMin||1};
}
function buildRoomTempPath(roomId) {
  void historyVersion.value;
  const d = roomHistories.value[roomId]?.temp||[]; if (d.length<2) return '';
  const {tMin,range}=getGlobalTempRange();
  return d.map((p,i)=>{const x=(i/(d.length-1))*CW;const y=TH-((p.temp-tMin)/range)*(TH-8);return `${i===0?'M':'L'}${x.toFixed(1)},${Math.max(2,y).toFixed(1)}`;}).join(' ');
}
function buildRoomHumidityPath(roomId) {
  void historyVersion.value;
  const d = roomHistories.value[roomId]?.temp||[]; if (d.length<2) return '';
  return d.map((p,i)=>{const x=(i/(d.length-1))*CW;const y=TH-(p.humidity/100)*(TH-8);return `${i===0?'M':'L'}${x.toFixed(1)},${Math.max(2,y).toFixed(1)}`;}).join(' ');
}
function getRoomTempLastPoint(roomId) {
  void historyVersion.value;
  const d=roomHistories.value[roomId]?.temp||[]; if(!d.length) return null;
  const {tMin,range}=getGlobalTempRange(); const last=d[d.length-1];
  return {x:CW,y:Math.max(2,TH-((last.temp-tMin)/range)*(TH-8))};
}
function getRoomHumLastPoint(roomId) {
  void historyVersion.value;
  const d=roomHistories.value[roomId]?.temp||[]; if(!d.length) return null;
  const last=d[d.length-1]; return {x:CW,y:Math.max(2,TH-(last.humidity/100)*(TH-8))};
}
function buildPowerPath() {
  const d=activePowerHistory.value; if(d.length<2) return '';
  const peak=Math.max(...d.map(p=>p.value),100);
  return d.map((p,i)=>{const x=(i/(d.length-1))*CW;const y=CH-(p.value/(peak*1.15))*CH;return `${i===0?'M':'L'}${x.toFixed(1)},${Math.max(2,y).toFixed(1)}`;}).join(' ');
}
function getPowerPoints() {
  const d=activePowerHistory.value; if(!d.length) return [];
  const peak=Math.max(...d.map(p=>p.value),100);
  return d.map((p,i)=>({x:(i/Math.max(d.length-1,1))*CW,y:Math.max(2,CH-(p.value/(peak*1.15))*CH)}));
}
function getTempRange() {
  const d=activeTempHistory.value; if(!d.length) return {tMin:0,tMax:60,range:60};
  const temps=d.map(p=>p.temp); const tMin=Math.min(...temps)-1; const tMax=Math.max(...temps)+1;
  return {tMin,tMax,range:tMax-tMin||1};
}
function buildTempPath() {
  const d=activeTempHistory.value; if(d.length<2) return '';
  const {tMin,range}=getTempRange();
  return d.map((p,i)=>{const x=(i/(d.length-1))*CW;const y=TH-((p.temp-tMin)/range)*(TH-8);return `${i===0?'M':'L'}${x.toFixed(1)},${Math.max(2,y).toFixed(1)}`;}).join(' ');
}
function buildHumidityPath() {
  const d=activeTempHistory.value; if(d.length<2) return '';
  return d.map((p,i)=>{const x=(i/(d.length-1))*CW;const y=TH-(p.humidity/100)*(TH-8);return `${i===0?'M':'L'}${x.toFixed(1)},${Math.max(2,y).toFixed(1)}`;}).join(' ');
}
function getTempPoints() {
  const d=activeTempHistory.value; if(!d.length) return [];
  const {tMin,range}=getTempRange();
  return d.map((p,i)=>({x:(i/Math.max(d.length-1,1))*CW,y:Math.max(2,TH-((p.temp-tMin)/range)*(TH-8))}));
}
function getHumPoints() {
  const d = activeTempHistory.value; if(!d.length) return [];
  return d.map((p, i) => ({ x: (i / Math.max(d.length - 1, 1)) * CW, y: Math.max(2, TH - (p.humidity / 100) * (TH - 8)) }));
}
const envYLabels = computed(() => {
  if (activeEnvTab.value === 'Humidity') return ['100%', '50%', '0%'];
  if (!selectedViewRoom.value && rooms.value.length > 1) {
    const {tMin,tMax} = getGlobalTempRange();
    return [`${tMax.toFixed(0)}°C`,`${((tMax+tMin)/2).toFixed(0)}°C`,`${tMin.toFixed(0)}°C`];
  }
  const d=activeTempHistory.value; if(!d.length) return ['60°C','30°C','0°C'];
  const temps=d.map(p=>p.temp);
  return [`${(Math.max(...temps)+1).toFixed(0)}°C`,`${((Math.max(...temps)+Math.min(...temps))/2).toFixed(0)}°C`,`${(Math.min(...temps)-1).toFixed(0)}°C`];
})
function xLabel(i, total) {
  const t=new Date(); t.setMinutes(t.getMinutes()-25+Math.round((i/(total-1))*25));
  return `${t.getHours()}:${String(t.getMinutes()).padStart(2,'0')}`;
}

// ── GAUGE HELPERS ─────────────────────────────────────────────────────────────
function gaugePath(fromPct, toPct, r) {
  const cx = 65, cy = 74;
  const a1 = Math.PI + fromPct * Math.PI, a2 = Math.PI + toPct * Math.PI;
  const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
  const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
  const large = (a2 - a1) > Math.PI ? 1 : 0;
  return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large} 1 ${x2.toFixed(2)},${y2.toFixed(2)}`;
}
function gaugeNeedleX(value, max) { const pct = Math.min(value / max, 1); return (65 + 46 * Math.cos(Math.PI + pct * Math.PI)).toFixed(2); }
function gaugeNeedleY(value, max) { const pct = Math.min(value / max, 1); return (74 + 46 * Math.sin(Math.PI + pct * Math.PI)).toFixed(2); }

// ── SENSOR DATA ───────────────────────────────────────────────────────────────
function applySensorData(data) {
  if (rooms.value.length === 0) return;
  const voltage = Number(data.voltage ?? data.V ?? data.v) || 0;
  const ampere  = Number(data.ampere ?? data.A ?? data.a ?? data.current) || 0;
  const payloadPower = data.power ?? data.P ?? data.p ?? data.W ?? data.w;
  const calculatedPower = payloadPower !== undefined ? Number(payloadPower) : +(voltage * ampere).toFixed(2);
  const temperature = Number(data.temperature ?? data.temp ?? data.Temp ?? data.t);
  const humidity    = Number(data.humidity ?? data.hum ?? data.Hum ?? data.h);
  if (isNaN(temperature) || isNaN(humidity)) { console.warn('Data rejected:', data); return; }
  let room = rooms.value.find(r => String(r.id) === String(data.roomId));
  if (!room) room = rooms.value[0];
  if (!room) return;
  currentVoltage.value = voltage; currentAmpere.value = ampere; currentPower.value = calculatedPower;
  powerHistory.value.push({ value: calculatedPower }); if (powerHistory.value.length > 60) powerHistory.value.shift();
  tempHistory.value.push({ temp: temperature, humidity }); if (tempHistory.value.length > 60) tempHistory.value.shift();
  room.voltage = voltage; room.ampere = ampere; room.power = calculatedPower; room.temp = temperature; room.humidity = humidity;
  room.tempStatus = getTempStatus(temperature, room.tempThreshold);
  room.humStatus  = getHumStatus(humidity, room.humThreshold);
  room.pwrStatus  = getPwrStatus(calculatedPower, room.pwrThreshold);
  pushRoomPower(room.id, calculatedPower);
  pushRoomTemp(room.id, temperature, humidity);
  if (temperature >= (room.tempThreshold || 28))   triggerAlert(room, 'Temperature', temperature, room.tempThreshold || 28, '°C');
  if (humidity >= (room.humThreshold || 70))        triggerAlert(room, 'Humidity', humidity, room.humThreshold || 70, '%');
  if (calculatedPower >= (room.pwrThreshold || 500)) triggerAlert(room, 'Power Usage', calculatedPower, room.pwrThreshold || 500, 'W');
  const logDetails = `[${room.name}] V: ${voltage}V | I: ${ampere}A | Pwr: ${calculatedPower}W | Temp: ${temperature}°C | Hum: ${humidity}%`;
  addLogEntry('Sensor Update', logDetails);
  const kwh = (calculatedPower / 1000) * (2 / 3600);
  todaysUsageKwh.value = +(todaysUsageKwh.value + kwh).toFixed(5);
  todaysCost.value     = +(todaysCost.value + kwh * 11.8).toFixed(4);
}

let socket = null
onMounted(async () => {
  document.body.setAttribute('data-theme', 'dark');
  await fetchRooms();
  await fetchInitialData();
  socket = io('http://localhost:3000', { transports: ['websocket'], reconnectionAttempts: 10, reconnectionDelay: 2000 });
  socket.on('connect',       () => { isConnected.value = true; });
  socket.on('sensor_update', (d) => { applySensorData(d); });
  socket.on('disconnect',    () => { isConnected.value = false; });
  socket.on('connect_error', () => { isConnected.value = false; });
  startRoomRotation();
  document.addEventListener('click', onDocClick);
})
onUnmounted(() => {
  stopRoomRotation();
  if (socket) socket.disconnect();
  document.removeEventListener('click', onDocClick);
})

const isMultiRoom = computed(() => !selectedViewRoom.value && rooms.value.length > 1)
</script>

<template>
  <div class="db">

    <!-- ══ HEADER ══ -->
    <header class="header">
      <div class="header-left">
        <svg viewBox="0 0 40 40" width="34" height="34" style="flex-shrink:0">
          <circle cx="20" cy="20" r="19" fill="#1a3a1a" stroke="#4caf50" stroke-width="1.5"/>
          <text x="20" y="26" text-anchor="middle" font-size="10" font-weight="bold" fill="#4caf50" font-family="Arial">CCIS</text>
        </svg>
        <div class="header-titles">
          <h1 class="title">CCIS Power Monitoring Dashboard</h1>
          <p class="subtitle">College of Computing and Information Sciences — Caraga State University</p>
        </div>
      </div>

      <div class="header-right">
        <!-- Connection pill -->
        <div :class="['conn-pill', isConnected ? 'live' : isSimulating ? 'sim' : 'off']">
          <span class="conn-dot"></span>
          <span class="conn-label">{{ isConnected ? 'Live' : isSimulating ? 'Simulating' : 'Disconnected' }}</span>
        </div>

        <!-- ── THEME TOGGLE (between bell and avatar) ── -->
        <button class="theme-toggle-btn" @click="toggleTheme" :title="isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'">
          <span class="theme-toggle-track" :class="{ light: !isDark }">
            <span class="theme-toggle-thumb" :class="{ light: !isDark }">
              <!-- Moon icon when dark -->
              <svg v-if="isDark" width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
              <!-- Sun icon when light -->
              <svg v-else width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                <circle cx="12" cy="12" r="5"/>
                <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            </span>
          </span>
          <span class="theme-toggle-label">{{ isDark ? 'Dark' : 'Light' }}</span>
        </button>

        <!-- Notification bell -->
        <div class="notif-wrap" style="position:relative">
          <button class="notif-btn" @click.stop="toggleNotifications">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
            <span v-if="unreadAlertsCount > 0" class="notif-badge">{{ unreadAlertsCount > 9 ? '9+' : unreadAlertsCount }}</span>
          </button>
          <Transition name="hdr-drop">
            <div v-if="showNotifications" class="hdr-dropdown notif-dropdown" @click.stop>
              <div class="notif-top">
                <div class="notif-title">Notifications</div>
                <button class="notif-clear" @click="clearAlerts" v-if="systemAlerts.length > 0">Clear All</button>
              </div>
              <div class="notif-divider"></div>
              <div class="notif-list">
                <div v-if="systemAlerts.length === 0" class="notif-empty">No recent alerts.</div>
                <div v-else v-for="alert in systemAlerts" :key="alert.id" :class="['notif-item', { unread: !alert.read }]">
                  <div class="notif-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                  </div>
                  <div class="notif-content">
                    <div class="notif-room">{{ alert.roomName }} Warning</div>
                    <div class="notif-msg">{{ alert.message }}</div>
                    <div class="notif-time">{{ alert.timestamp }}</div>
                  </div>
                </div>
              </div>
            </div>
          </Transition>
        </div>

        <!-- Profile -->
        <div class="profile-wrap" style="position:relative">
          <button class="avatar-btn" @click.stop="showProfile = !showProfile; showNotifications = false">
            <div class="avatar">{{ adminName.charAt(0).toUpperCase() }}</div>
            <span class="avatar-label">{{ adminName }}</span>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" :style="{ transform: showProfile ? 'rotate(180deg)' : '', transition: 'transform .2s' }"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <Transition name="hdr-drop">
            <div v-if="showProfile" class="hdr-dropdown profile-dropdown" @click.stop>
              <div class="profile-top">
                <div class="profile-avatar-lg">{{ adminName.charAt(0).toUpperCase() }}</div>
                <div><div class="profile-name">{{ adminName }}</div><div class="profile-role">System Administrator</div></div>
              </div>
              <div class="profile-divider"></div>
              <div class="profile-item profile-logout" @click="showProfile = false">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                Sign Out
              </div>
            </div>
          </Transition>
        </div>
      </div>
    </header>

    <!-- ══ VIEW SELECTOR ══ -->
    <div class="view-selector-bar">
      <div class="view-dropdown-wrap">
        <button class="view-dropdown-btn" :class="{ active: showViewDropdown }" @click.stop="showViewDropdown = !showViewDropdown">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          Show Rooms
          <span v-if="selectedViewRoom !== null" class="vdb-active-dot"></span>
          <svg class="vdb-chevron" :class="{ rotated: showViewDropdown }" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <Transition name="vdrop">
          <div v-if="showViewDropdown" class="view-dropdown-menu" @click.stop>
            <button :class="['vdm-item', { active: selectedViewRoom === null }]" @click="selectViewRoom(null)">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
              All Rooms <span v-if="selectedViewRoom === null" class="vdm-check">✓</span>
            </button>
            <div v-if="rooms.length" class="vdm-divider"></div>
            <button v-for="room in rooms" :key="room.id" :class="['vdm-item', { active: selectedViewRoom === room.id }]" @click="selectViewRoom(room.id)">
              <span class="vdm-dot" :style="{ background: getRoomColor(room.id).accent }"></span>
              {{ room.name }} <span v-if="selectedViewRoom === room.id" class="vdm-check">✓</span>
            </button>
            <div v-if="!rooms.length" class="vdm-empty">No rooms added yet</div>
          </div>
        </Transition>
      </div>
    </div>

    <!-- ══ STAT CARDS ══ -->
    <section class="stat-cards">
      <div class="stat-card green clickable" @click="showVoltsAmps = !showVoltsAmps" title="Click to toggle Voltage & Ampere">
        <div class="stat-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="white" opacity=".9"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div>
        <div v-if="!showVoltsAmps">
          <p class="stat-label">{{ selectedViewRoom ? (rooms.find(r=>r.id===selectedViewRoom)?.name ?? 'Room') : 'All Rooms' }} — Power</p>
          <p class="stat-value">{{ activePowerVal }} <span class="stat-unit">W</span></p>
        </div>
        <div v-else>
          <p class="stat-label">{{ selectedViewRoom ? (rooms.find(r=>r.id===selectedViewRoom)?.name ?? 'Room') : 'All Rooms' }} — Electrical</p>
          <p class="stat-value" style="font-size:1.4rem;padding-top:4px">{{ activeVoltage }}<span class="stat-unit">V</span> &nbsp;|&nbsp; {{ activeAmpere }}<span class="stat-unit">A</span></p>
        </div>
      </div>
      <div class="stat-card orange">
        <div class="stat-peso">&#8369;</div>
        <div><p class="stat-label">Today's Cost</p><p class="stat-value">&#8369;{{ todaysCost.toFixed(2) }}</p></div>
      </div>
      <div class="stat-card blue">
        <div class="stat-icon"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" opacity=".9"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg></div>
        <div><p class="stat-label">Weekly Energy Usage</p><p class="stat-value">{{ weeklyEnergy }} <span class="stat-unit">kWh</span></p></div>
      </div>
      <div class="stat-card purple clickable" @click="showReportModal = true">
        <div class="stat-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" opacity=".9">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        </div>
        <div><p class="stat-label">&nbsp;</p><p class="stat-value-sm">Generate PDF Report</p></div>
      </div>
    </section>

    <!-- ══ MAIN GRID ══ -->
    <div class="main-grid">
      <div class="left-col">

        <!-- Power Chart -->
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">Power Usage Chart</span>
            <span v-if="isMultiRoom" class="chart-mode-badge">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
              {{ rooms.length }} rooms — shared scale
            </span>
          </div>
          <div class="tabs">
            <button v-for="t in ['Real-Time','Daily','Weekly']" :key="t" :class="['tab', { active: activeTab === t }]" @click="activeTab = t">{{ t }}</button>
          </div>
          <div class="chart-wrap">
            <div class="y-labels">
              <span v-for="v in [1000,750,500,250,0]" :key="v" :style="{ bottom: (v/1000*100)+'%' }">{{ v }}</span>
            </div>
            <div class="chart-inner">
              <svg :viewBox="`0 0 ${CW} ${CH}`" class="chart-svg" preserveAspectRatio="none">
                <line v-for="v in [0,250,500,750,1000]" :key="v" x1="0" :y1="CH-(v/1000)*CH" :x2="CW" :y2="CH-(v/1000)*CH" class="chart-grid" stroke-width="1.2"/>
                <template v-if="isMultiRoom">
                  <g v-for="room in rooms" :key="room.id">
                    <path v-if="(roomHistories[room.id]?.power?.length ?? 0) >= 2" :d="buildRoomPowerPath(room.id)" fill="none" :stroke="getRoomColor(room.id).accent" stroke-width="0.8" stroke-linejoin="round" stroke-linecap="round" opacity="0.75"/>
                    <circle v-if="getRoomLastPoint(room.id)" :cx="getRoomLastPoint(room.id).x" :cy="getRoomLastPoint(room.id).y" r="2" :fill="getRoomColor(room.id).accent" opacity="0.95"/>
                  </g>
                </template>
                <template v-else>
                  <path :key="`pwr-path-${historyVersion}`" v-if="activePowerHistory.length >= 2" :d="buildPowerPath()" fill="none" :stroke="viewAccent" stroke-width="0.9" stroke-linejoin="round" stroke-linecap="round" opacity="0.9"/>
                  <circle :key="`pwr-dot-${historyVersion}`" v-if="activePowerHistory.length >= 1" :cx="getPowerPoints().at(-1)?.x" :cy="getPowerPoints().at(-1)?.y" r="2.5" :fill="viewAccent" opacity="0.95"/>
                </template>
              </svg>
              <div class="x-labels"><span v-for="(_, i) in Array(6)" :key="i">{{ xLabel(i, 6) }}</span></div>
            </div>
          </div>
          <div class="chart-section-divider"></div>
          <div v-if="isMultiRoom" class="chart-legend-grid">
            <span v-for="room in rooms" :key="room.id" class="clg-item">
              <span class="clg-line" :style="{ background: getRoomColor(room.id).accent }"></span>
              <span class="clg-name">{{ room.name }}</span>
              <span class="clg-val" :style="{ color: getRoomColor(room.id).accent }">{{ room.power }}W</span>
            </span>
          </div>
          <div v-if="!isMultiRoom && selectedViewRoom" class="single-legend">
            <span class="sl-dot" :style="{ background: viewAccent }"></span>
            <span class="sl-label">{{ rooms.find(r=>r.id===selectedViewRoom)?.name }}</span>
          </div>
          <div class="chart-section-divider"></div>
          <div class="power-stats">
            <span>Current: <b class="lime">{{ activePowerVal }} W</b></span>
            <span>Max: <b class="lime">{{ maxPower }} W</b></span>
            <span>Min: <b class="lime">{{ minPower }} W</b></span>
          </div>
        </div>

        <!-- Env Chart -->
        <div class="panel panel-grow">
          <div class="panel-header">
            <span class="panel-title">{{ activeEnvTab }} Trend</span>
            <span v-if="isMultiRoom" class="chart-mode-badge">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
              {{ rooms.length }} rooms — shared scale
            </span>
          </div>
          <div class="tabs">
            <button :class="['tab', { active: activeEnvTab === 'Temperature' }]" @click="activeEnvTab = 'Temperature'">Temperature</button>
            <button :class="['tab', { active: activeEnvTab === 'Humidity' }]" @click="activeEnvTab = 'Humidity'">Humidity</button>
          </div>
          <div class="temp-chart-wrap">
            <div class="y-labels" style="font-size:10px">
              <span v-for="(lbl, i) in envYLabels" :key="i" :style="{ bottom: (100 - i*50)+'%' }">{{ lbl }}</span>
            </div>
            <div class="chart-inner">
              <svg :viewBox="`0 0 ${CW} ${TH}`" class="chart-svg" preserveAspectRatio="none">
                <line x1="0" :y1="TH*0.0" :x2="CW" :y2="TH*0.0" class="chart-grid" stroke-width="1.2"/>
                <line x1="0" :y1="TH*0.5" :x2="CW" :y2="TH*0.5" class="chart-grid" stroke-width="1.2"/>
                <line x1="0" :y1="TH*1.0" :x2="CW" :y2="TH*1.0" class="chart-grid" stroke-width="1.2"/>
                <template v-if="isMultiRoom">
                  <g v-for="room in rooms" :key="room.id">
                    <template v-if="activeEnvTab === 'Humidity'">
                      <path v-if="(roomHistories[room.id]?.temp?.length ?? 0) >= 2" :d="buildRoomHumidityPath(room.id)" fill="none" :stroke="getRoomColor(room.id).accent" stroke-width="0.8" stroke-linejoin="round" stroke-linecap="round" opacity="0.8"/>
                      <circle v-if="getRoomHumLastPoint(room.id)" :cx="getRoomHumLastPoint(room.id).x" :cy="getRoomHumLastPoint(room.id).y" r="1.8" :fill="getRoomColor(room.id).accent" opacity="0.95"/>
                    </template>
                    <template v-if="activeEnvTab === 'Temperature'">
                      <path v-if="(roomHistories[room.id]?.temp?.length ?? 0) >= 2" :d="buildRoomTempPath(room.id)" fill="none" :stroke="getRoomColor(room.id).accent" stroke-width="0.8" stroke-linejoin="round" stroke-linecap="round" opacity="0.8"/>
                      <circle v-if="getRoomTempLastPoint(room.id)" :cx="getRoomTempLastPoint(room.id).x" :cy="getRoomTempLastPoint(room.id).y" r="1.8" :fill="getRoomColor(room.id).accent" opacity="0.95"/>
                    </template>
                  </g>
                </template>
                <template v-else>
                  <template v-if="activeEnvTab === 'Humidity'">
                    <path :key="`hum-path-${historyVersion}`" v-if="activeTempHistory.length >= 2" :d="buildHumidityPath()" fill="none" :stroke="viewAccent" stroke-width="0.9" stroke-linejoin="round" stroke-linecap="round" opacity="0.95"/>
                    <circle :key="`hum-dot-${historyVersion}`" v-if="activeTempHistory.length >= 1" :cx="getHumPoints().at(-1)?.x" :cy="getHumPoints().at(-1)?.y" r="2" :fill="viewAccent" opacity="0.95"/>
                  </template>
                  <template v-if="activeEnvTab === 'Temperature'">
                    <path :key="`tmp-path-${historyVersion}`" v-if="activeTempHistory.length >= 2" :d="buildTempPath()" fill="none" :stroke="viewAccent" stroke-width="0.9" stroke-linejoin="round" stroke-linecap="round" opacity="0.95"/>
                    <circle :key="`tmp-dot-${historyVersion}`" v-if="activeTempHistory.length >= 1" :cx="getTempPoints().at(-1)?.x" :cy="getTempPoints().at(-1)?.y" r="2" :fill="viewAccent" opacity="0.95"/>
                  </template>
                </template>
              </svg>
              <div class="x-labels"><span v-for="(_, i) in Array(6)" :key="i">{{ xLabel(i, 6) }}</span></div>
            </div>
          </div>
          <div class="chart-section-divider"></div>
          <div v-if="isMultiRoom" class="chart-legend-grid">
            <span v-for="room in rooms" :key="room.id" class="clg-item">
              <span class="clg-line" :style="{ background: getRoomColor(room.id).accent }"></span>
              <span class="clg-name">{{ room.name }}</span>
              <span class="clg-val" :style="{ color: getRoomColor(room.id).accent }">{{ activeEnvTab === 'Temperature' ? rooms.find(r=>r.id===room.id)?.temp + '°C' : rooms.find(r=>r.id===room.id)?.humidity + '%' }}</span>
            </span>
          </div>
          <div v-else class="single-legend">
            <span class="sl-dot" :style="{ background: viewAccent }"></span>
            <span class="sl-label">{{ selectedViewRoom ? rooms.find(r=>r.id===selectedViewRoom)?.name : (rooms.length ? 'Global Average' : '—') }}</span>
          </div>
          <div class="chart-section-divider"></div>
          <div class="readout-cards">
            <div class="readout-card" :style="{ borderColor: viewBorder, background: viewBg }">
              <div class="rtc-icon-wrap" :style="{ background: viewAccent + '22', borderColor: viewAccent + '55' }">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" :stroke="viewAccent" stroke-width="2" stroke-linecap="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"/></svg>
              </div>
              <div class="rtc-content">
                <span class="rtc-name">Temp</span>
                <span class="rtc-src">{{ selectedViewRoom ? rooms.find(r=>r.id===selectedViewRoom)?.name : (rooms.length ? 'avg' : '—') }}</span>
                <span class="rtc-val" :style="{ color: viewAccent }">{{ activeTemp }}&#176;C</span>
                <span :class="['badge', activeTemp >= (selectedViewRoom ? rooms.find(r=>r.id===selectedViewRoom)?.tempThreshold : 28) ? 'badge-high' : 'badge-ok']">{{ activeTemp >= (selectedViewRoom ? rooms.find(r=>r.id===selectedViewRoom)?.tempThreshold : 28) ? '⚠ High' : '✓ OK' }}</span>
              </div>
            </div>
            <div class="readout-card" :style="{ borderColor: viewBorder + '99', background: viewBg }">
              <div class="rtc-icon-wrap" :style="{ background: viewAccent + '15', borderColor: viewAccent + '44' }">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" :stroke="viewAccent" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.7"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>
              </div>
              <div class="rtc-content">
                <span class="rtc-name">Humidity</span>
                <span class="rtc-src">{{ selectedViewRoom ? rooms.find(r=>r.id===selectedViewRoom)?.name : (rooms.length ? 'avg' : '—') }}</span>
                <span class="rtc-val" :style="{ color: viewAccent, opacity: '0.7' }">{{ activeHumidity }}%</span>
                <span :class="['badge', activeHumidity >= (selectedViewRoom ? rooms.find(r=>r.id===selectedViewRoom)?.humThreshold : 70) ? 'badge-high' : 'badge-ok']">{{ activeHumidity >= (selectedViewRoom ? rooms.find(r=>r.id===selectedViewRoom)?.humThreshold : 70) ? '⚠ High' : '✓ OK' }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Activity Logs -->
        <div class="panel logs-panel" :style="{ borderColor: viewBorder }">
          <div class="logs-panel-header">
            <div class="logs-panel-title-group">
              <span class="panel-title">Activity Logs</span>
              <span v-if="logs.length" class="logs-panel-count" :style="{ background: viewAccent, color: '#0f1117' }">{{ logs.length }}</span>
            </div>
            <div class="logs-panel-right">
              <div class="logs-panel-meta">
                <button @click="downloadLogsAsText" class="download-logs-btn" title="Download Logs as TXT">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                    <polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>
                  </svg>
                  Export TXT
                </button>
                <span class="logs-live-dot" :style="{ background: viewAccent }"></span>
                <span class="logs-live-label">Live feed</span>
              </div>
            </div>
          </div>
          <div v-if="!logs.length" class="logs-empty-state"><span>Waiting for sensor data…</span></div>
          <div v-else class="logs-table-wrap">
            <table class="logs-tbl">
              <thead><tr><th class="lt-ts">Timestamp</th><th class="lt-event">Event</th><th class="lt-details">Details</th></tr></thead>
              <tbody>
                <tr v-for="(log, i) in logs" :key="i" :class="{ 'lt-row-new': i === 0 }">
                  <td class="lt-ts">{{ log.timestamp }}</td>
                  <td class="lt-event"><span class="event-pill" :style="{ color: viewAccent, background: viewBg, borderColor: viewBorder }">{{ log.event }}</span></td>
                  <td class="lt-details">{{ log.details }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

      </div><div class="right-col">

        <!-- Room Status -->
        <div class="panel room-panel room-panel-grow">
          <div class="panel-header">
            <span class="panel-title">Room Status</span>
            <div class="room-hdr-right">
              <div class="page-dots">
                <button v-for="p in totalPages" :key="p" :class="['page-dot', { active: roomPage === p - 1 }]" @click="goToPage(p - 1, p - 1 > roomPage ? 'left' : 'right')"/>
              </div>
              <button class="add-room-btn" @click="showAddRoom = true" title="Add Room">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              </button>
              <button v-if="rooms.length > 0" class="all-rooms-btn" @click="showAllRooms = true">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
                <span>All Rooms</span>
              </button>
            </div>
          </div>
          <div v-if="rooms.length === 0" class="room-empty-state">
            <div class="res-icon">&#128421;</div>
            <div class="res-title">No Rooms Added</div>
            <div class="res-sub">Click the <b>+</b> button above to add a room and start monitoring.</div>
          </div>
          <template v-else>
            <div class="page-label">
              <span class="page-label-main">Rooms {{ roomPage * 4 + 1 }}–{{ Math.min(roomPage * 4 + 4, rooms.length) }}</span>
              <span class="page-label-sub">Auto-rotating every 5s</span>
            </div>
            <div class="carousel-outer">
              <Transition :name="'slide-' + slideDirection" mode="out-in">
                <div class="room-grid" :key="roomPage">
                  <div v-for="room in visibleRooms" :key="room.id" class="room-card"
                    :style="{ '--room-accent': getRoomColor(room.id).accent, '--room-bg': getRoomColor(room.id).bg, '--room-border': getRoomColor(room.id).border }"
                    @click="openRoomDetail(room)">
                    <button class="rc-delete-btn" @click.stop="requestDelete(room.id, room.name)">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                    <div class="rc-tap-hint">tap for details</div>
                    <div class="rc-color-bar" :style="{ background: getRoomColor(room.id).accent }"></div>
                    <div class="rc-top">
                      <span class="rc-icon" :style="{ color: getRoomColor(room.id).accent }">&#128421;</span>
                      <div><div class="rc-name">{{ room.name }}</div><div class="rc-sub">Power: {{ room.power }} W</div></div>
                    </div>
                    <div class="rc-row"><span>Power: <b :class="room.pwrStatus === 'High' ? 'text-red' : ''" :style="room.pwrStatus !== 'High' ? { color: getRoomColor(room.id).accent } : {}">{{ room.power }} W</b></span><span :class="['rc-badge', room.pwrStatus === 'High' ? 'badge-high' : 'badge-ok']">&#8595; {{ room.pwrStatus }}</span></div>
                    <div class="rc-row" style="margin-top:4px"><span>Temp: <b>{{ room.temp }}&#176;C</b></span><span :class="['rc-badge', room.tempStatus === 'High' ? 'badge-high' : 'badge-ok']">&#127777; {{ room.tempStatus }}</span></div>
                    <div class="rc-row" style="margin-top:4px"><span>Hum: <b>{{ room.humidity }}%</b></span><span :class="['rc-badge', room.humStatus === 'High' ? 'badge-high' : 'badge-ok']">&#128167; {{ room.humStatus }}</span></div>
                  </div>
                </div>
              </Transition>
            </div>
          </template>
        </div>

        <!-- IoT Controls -->
        <div class="panel iot-panel">
          <div class="panel-header"><span class="panel-title">IoT Controls</span></div>
          <div v-if="rooms.length === 0" class="iot-no-rooms">Add a room first to control its devices</div>
          <template v-else>
            <div class="iot-room-select">
              <button v-for="room in rooms" :key="room.id"
                :class="['iot-room-pill', { active: selectedIotRoom === room.id }]"
                :style="selectedIotRoom === room.id ? { background: getRoomColor(room.id).bg, borderColor: getRoomColor(room.id).accent, color: getRoomColor(room.id).accent } : {}"
                @click="selectedIotRoom = selectedIotRoom === room.id ? null : room.id">
                <span class="iot-pill-dot" :style="{ background: getRoomColor(room.id).accent }"></span>
                {{ room.name.length > 18 ? room.name.substring(0, 18) + '…' : room.name }}
              </button>
            </div>
            <div class="iot-body">
              <div v-if="!selectedIotRoom" class="iot-empty-inner">Select a room above to control its devices</div>
              <div v-else class="iot-controls">
                <div class="iot-room-title" :style="{ color: getRoomColor(selectedIotRoom).accent }">{{ rooms.find(r => r.id === selectedIotRoom)?.name }}</div>
                <div class="iot-section">
                  <div class="iot-section-label">Room Power</div>
                  <button :class="['iot-power-btn', { powered: getIot(selectedIotRoom).roomPowered }]" @click="toggleRoomPower(selectedIotRoom)">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
                    <span>{{ getIot(selectedIotRoom).roomPowered ? 'ROOM ON' : 'ROOM OFF' }}</span>
                  </button>
                </div>
                <div class="iot-section">
                  <div class="iot-section-label-row">
                    <span class="iot-section-label">Air Conditioner</span>
                    <span v-if="!getIot(selectedIotRoom).roomPowered" class="iot-device-locked">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                      Room power required
                    </span>
                  </div>
                  <div :class="['iot-ac-row', !getIot(selectedIotRoom).roomPowered ? 'iot-device-disabled' : '']">
                    <div class="iot-ac-onoff">
                      <button :class="['iot-ac-btn','ac-on-btn',{ active: getIot(selectedIotRoom).acOn }]" :disabled="!getIot(selectedIotRoom).roomPowered" @click="getIot(selectedIotRoom).acOn = true">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M19.07 4.93L4.93 19.07"/></svg> ON
                      </button>
                      <button :class="['iot-ac-btn','ac-off-btn',{ active: !getIot(selectedIotRoom).acOn }]" :disabled="!getIot(selectedIotRoom).roomPowered" @click="getIot(selectedIotRoom).acOn = false">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> OFF
                      </button>
                    </div>
                    <div class="iot-temp-ctrl">
                      <button class="iot-temp-btn" @click="adjustTemp(selectedIotRoom,-1)" :disabled="!getIot(selectedIotRoom).acOn || !getIot(selectedIotRoom).roomPowered">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      </button>
                      <div class="iot-temp-display">
                        <span :class="['iot-temp-val',(!getIot(selectedIotRoom).acOn||!getIot(selectedIotRoom).roomPowered)?'dimmed':'']">{{ getIot(selectedIotRoom).acTemp }}</span>
                        <span class="iot-temp-unit">°C</span>
                      </div>
                      <button class="iot-temp-btn" @click="adjustTemp(selectedIotRoom,1)" :disabled="!getIot(selectedIotRoom).acOn || !getIot(selectedIotRoom).roomPowered">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                      </button>
                    </div>
                  </div>
                </div>
                <div class="iot-section">
                  <div class="iot-section-label-row">
                    <span class="iot-section-label">Room Lights</span>
                    <span v-if="!getIot(selectedIotRoom).roomPowered" class="iot-device-locked">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                      Room power required
                    </span>
                  </div>
                  <button :class="['iot-lights-btn',{ lit: getIot(selectedIotRoom).lightsOn, 'lights-locked': !getIot(selectedIotRoom).roomPowered }]" :disabled="!getIot(selectedIotRoom).roomPowered" @click="toggleLights(selectedIotRoom)">
                    <span class="lights-bulb-icon">
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M15 14c.2-1 .7-1.7 1.5-2.5C17.7 10.2 18 9.1 18 8a6 6 0 0 0-12 0c0 1.1.3 2.2 1.5 3.5.8.8 1.3 1.5 1.5 2.5"/>
                        <path d="M9 18h6M10 22h4"/>
                      </svg>
                    </span>
                    <span class="lights-label">{{ getIot(selectedIotRoom).lightsOn ? 'LIGHTS ON' : 'LIGHTS OFF' }}</span>
                    <span v-if="getIot(selectedIotRoom).lightsOn" class="lights-glow"></span>
                  </button>
                </div>
              </div>
            </div>
          </template>
        </div>

        <!-- Energy Summary -->
        <div class="panel energy-panel">
          <div class="panel-header"><span class="panel-title">Energy Summary</span></div>
          <div class="energy-grid">
            <div class="energy-item"><p class="energy-label">Today's Usage</p><p class="energy-value">{{ todaysUsageKwh.toFixed(3) }} <span class="lime">kWh</span></p></div>
            <div class="energy-item"><p class="energy-label">This Week's Usage</p><p class="energy-value">{{ weeklyEnergy }} <span class="lime">kWh</span></p></div>
            <div class="energy-item full"><p class="energy-label">Estimated Monthly Cost</p><p class="energy-value">&#8369;{{ (todaysCost * 30).toFixed(2) }}</p></div>
          </div>
        </div>

      </div></div>

    <!-- ══ MODALS ══ -->

    <!-- All Rooms -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="showAllRooms" class="modal-overlay" @click.self="showAllRooms = false">
          <div class="ar-modal">
            <div class="ar-modal-hdr">
              <span class="ar-modal-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
                All Rooms <span class="ar-modal-count">{{ rooms.length }}</span>
              </span>
              <button class="ar-modal-x" @click="showAllRooms = false">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="ar-modal-body">
              <div class="ar-grid">
                <div v-for="(room, i) in rooms" :key="room.id" class="ar-card"
                  :style="{ '--ar-accent': getRoomColor(room.id).accent, '--ar-bg': getRoomColor(room.id).bg, '--ar-border': getRoomColor(room.id).border, borderColor: getRoomColor(room.id).border }"
                  @click="showAllRooms = false; openRoomDetail(room)">
                  <button class="ar-del-btn" @click.stop="requestDelete(room.id, room.name); showAllRooms=false">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                  <div class="ar-accent-bar" :style="{ background: getRoomColor(room.id).accent }"></div>
                  <div class="ar-card-top">
                    <span class="ar-room-num" :style="{ color: getRoomColor(room.id).accent }">Room {{ i + 1 }}</span>
                    <span :class="['ar-status',(room.tempStatus==='High'||room.pwrStatus==='High'||room.humStatus==='High')?'ar-alert':'ar-ok']">
                      {{ (room.tempStatus==='High'||room.pwrStatus==='High'||room.humStatus==='High') ? '⚠ Alert' : '✓ OK' }}
                    </span>
                  </div>
                  <div class="ar-room-name">{{ room.name }}</div>
                  <div class="ar-sparkline-wrap">
                    <svg viewBox="0 0 200 40" class="ar-sparkline" preserveAspectRatio="none">
                      <template v-if="(roomHistories[room.id]?.power?.length ?? 0) >= 2">
                        <defs>
                          <linearGradient :id="`sg-${room.id}`" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" :stop-color="getRoomColor(room.id).accent" stop-opacity="0.3"/>
                            <stop offset="100%" :stop-color="getRoomColor(room.id).accent" stop-opacity="0"/>
                          </linearGradient>
                        </defs>
                        <path :d="(() => { const d = roomHistories[room.id].power; const peak = Math.max(...d.map(p=>p.value), 100); const pts = d.map((p,idx) => { const x=(idx/(d.length-1))*200; const y=38-(p.value/(peak*1.15))*36; return `${x.toFixed(1)},${Math.max(2,y).toFixed(1)}` }).join(' L'); return `M${pts} L200,40 L0,40 Z` })()" :fill="`url(#sg-${room.id})`"/>
                        <path :d="(() => { const d = roomHistories[room.id].power; const peak = Math.max(...d.map(p=>p.value), 100); return d.map((p,idx) => { const x=(idx/(d.length-1))*200; const y=38-(p.value/(peak*1.15))*36; return `${idx===0?'M':'L'}${x.toFixed(1)},${Math.max(2,y).toFixed(1)}` }).join(' ') })()" fill="none" :stroke="getRoomColor(room.id).accent" stroke-width="1.5" stroke-linecap="round"/>
                        <circle :cx="200" :cy="(() => { const d = roomHistories[room.id].power; if (!d.length) return 20; const peak = Math.max(...d.map(p=>p.value), 100); return Math.max(2, 38-(d[d.length-1].value/(peak*1.15))*36) })()" r="2.5" :fill="getRoomColor(room.id).accent"/>
                      </template>
                      <text v-else x="100" y="22" text-anchor="middle" font-size="9" fill="#4a5268">Collecting data…</text>
                    </svg>
                    <div class="ar-sparkline-label" :style="{ color: getRoomColor(room.id).accent }">{{ room.power }} W</div>
                  </div>
                  <div class="ar-metrics">
                    <div class="ar-metric"><span class="ar-lbl">⚡ Power</span><span class="ar-val" :style="{ color: getRoomColor(room.id).accent }">{{ room.power }} W</span><span :class="['rc-badge',room.pwrStatus==='High'?'badge-high':'badge-ok']">{{ room.pwrStatus }}</span></div>
                    <div class="ar-metric"><span class="ar-lbl">🌡 Temp</span><span class="ar-val">{{ room.temp }}°C</span><span :class="['rc-badge',room.tempStatus==='High'?'badge-high':'badge-ok']">{{ room.tempStatus }}</span></div>
                    <div class="ar-metric"><span class="ar-lbl">💧 Hum</span><span class="ar-val" style="color:#64b5f6">{{ room.humidity }}%</span><span :class="['rc-badge',room.humStatus==='High'?'badge-high':'badge-ok']">{{ room.humStatus }}</span></div>
                  </div>
                  <div class="ar-tap">Tap to view details →</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Room Detail with Gauges -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="showRoomDetail && selectedRoom" class="modal-overlay" @click.self="closeRoomDetail">
          <div class="detail-box">
            <div class="detail-hdr" :style="{ borderBottomColor: getRoomColor(selectedRoom.id).border }">
              <div class="detail-title-wrap">
                <span class="detail-icon">&#128421;</span>
                <div>
                  <div class="detail-room-name" :style="{ color: getRoomColor(selectedRoom.id).accent }">{{ selectedRoom.name }}</div>
                  <div class="detail-subtitle">Live Sensor Data</div>
                </div>
              </div>
              <div class="detail-hdr-actions">
                <button class="rename-btn" @click="openThresholdEditor(selectedRoom)" style="color:#f0a500;border-color:#f0a50044;">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                  Edit Limits
                </button>
                <button class="rename-btn" @click="openRename(selectedRoom)">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                  Rename
                </button>
                <button class="detail-close-btn" @click="closeRoomDetail">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>

            <!-- Gauge Tiles -->
            <div class="detail-tiles">
              <div
                v-for="metric in [
                  { key: 'pwr',  label: 'Power',       value: selectedRoom.power,    max: 2000, unit: 'W',  thresh: selectedRoom.pwrThreshold  || 500, status: selectedRoom.pwrStatus,  color: '#f0a500' },
                  { key: 'temp', label: 'Temperature', value: selectedRoom.temp,     max: 60,   unit: '°C', thresh: selectedRoom.tempThreshold || 28,  status: selectedRoom.tempStatus, color: '#36d1dc' },
                  { key: 'hum',  label: 'Humidity',    value: selectedRoom.humidity, max: 100,  unit: '%',  thresh: selectedRoom.humThreshold  || 70,  status: selectedRoom.humStatus,  color: '#5b86e5' },
                ]"
                :key="metric.key"
                :class="['detail-tile', metric.status === 'High' ? 'tile-alert' : 'tile-ok']"
                style="display:flex;flex-direction:column;align-items:center;padding:14px 10px 10px;gap:4px;"
              >
                <div class="tile-label" style="font-size:12px;margin-bottom:2px;">{{ metric.label }}</div>
                <svg viewBox="0 0 130 80" width="130" height="80" style="overflow:visible;">
                  <path :d="gaugePath(0,   1,    52)" fill="none" stroke="rgba(128,128,128,0.18)" stroke-width="9" stroke-linecap="butt"/>
                  <path :d="gaugePath(0,    0.5,  52)" fill="none" stroke="#4caf50" stroke-width="9" stroke-linecap="butt" opacity="0.85"/>
                  <path :d="gaugePath(0.5,  0.75, 52)" fill="none" stroke="#ffc107" stroke-width="9" stroke-linecap="butt" opacity="0.85"/>
                  <path :d="gaugePath(0.75, 0.9,  52)" fill="none" stroke="#ff9800" stroke-width="9" stroke-linecap="butt" opacity="0.85"/>
                  <path :d="gaugePath(0.9,  1,    52)" fill="none" stroke="#ef5350" stroke-width="9" stroke-linecap="butt" opacity="0.85"/>
                  <line x1="65" y1="74" :x2="gaugeNeedleX(metric.value, metric.max)" :y2="gaugeNeedleY(metric.value, metric.max)" :stroke="metric.status === 'High' ? '#ef5350' : metric.color" stroke-width="2.5" stroke-linecap="round"/>
                  <circle cx="65" cy="74" r="5" :fill="metric.status === 'High' ? '#ef5350' : metric.color"/>
                  <circle cx="65" cy="74" r="2" fill="#12141a"/>
                  <text x="65" y="63" text-anchor="middle" font-size="13" font-weight="600" :fill="metric.status === 'High' ? '#ef5350' : metric.color" font-family="inherit">{{ metric.value }}{{ metric.unit }}</text>
                </svg>
                <span :class="['tile-badge', metric.status === 'High' ? 'badge-high' : 'badge-ok']">{{ metric.status === 'High' ? '⚠ High' : '✓ Normal' }}</span>
                <div class="tile-thresh" style="font-size:11px;opacity:0.6;margin-top:2px;">Threshold: {{ metric.thresh }}{{ metric.unit }}</div>
              </div>
            </div>

            <div class="detail-bars">
              <div class="dbar-row"><span class="dbar-label">Power</span><div class="dbar-track"><div class="dbar-fill pwr-fill" :style="{ width: Math.min(selectedRoom.power / 20, 100) + '%' }"></div></div><span class="dbar-val">{{ Math.min(selectedRoom.power / 20, 100).toFixed(0) }}%</span></div>
              <div class="dbar-row"><span class="dbar-label">Temperature</span><div class="dbar-track"><div class="dbar-fill tmp-fill" :style="{ width: Math.min((selectedRoom.temp / 60) * 100, 100) + '%' }"></div></div><span class="dbar-val">{{ selectedRoom.temp }}&#176;C</span></div>
              <div class="dbar-row"><span class="dbar-label">Humidity</span><div class="dbar-track"><div class="dbar-fill hum-fill" :style="{ width: selectedRoom.humidity + '%' }"></div></div><span class="dbar-val">{{ selectedRoom.humidity }}%</span></div>
            </div>
            <div :class="['detail-banner',(selectedRoom.tempStatus==='High'||selectedRoom.pwrStatus==='High'||selectedRoom.humStatus==='High')?'banner-alert':'banner-ok']">
              <span v-if="selectedRoom.tempStatus==='High'||selectedRoom.pwrStatus==='High'||selectedRoom.humStatus==='High'">&#9888; One or more readings exceed the threshold — attention required</span>
              <span v-else>&#10003; All readings are within normal range</span>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Threshold Modal -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="showThresholdModal" class="modal-overlay" @click.self="showThresholdModal = false">
          <div class="rm-modal" style="width:min(600px,calc(100vw - 32px))">
            <div class="rm-modal-hdr">
              <span class="rm-modal-title">Edit Room Thresholds</span>
              <button class="rm-modal-x" @click="showThresholdModal = false" :disabled="isSavingThresholds">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="rm-modal-body">
              <p class="rm-modal-hint" style="margin-bottom:12px;font-size:13px;">Set maximum allowable limits for <b>{{ editLimits.name }}</b>. The system will flag a warning if sensors exceed these values.</p>
              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:16px;">
                <div><label class="rm-modal-label" style="display:block;margin-bottom:6px;">Max Temp (°C)</label><input type="number" v-model.number="editLimits.temp" class="rm-modal-input" :disabled="isSavingThresholds"/></div>
                <div><label class="rm-modal-label" style="display:block;margin-bottom:6px;">Max Humidity (%)</label><input type="number" v-model.number="editLimits.hum" class="rm-modal-input" :disabled="isSavingThresholds"/></div>
                <div><label class="rm-modal-label" style="display:block;margin-bottom:6px;">Max Power (W)</label><input type="number" v-model.number="editLimits.pwr" class="rm-modal-input" :disabled="isSavingThresholds"/></div>
              </div>
              <div class="rm-modal-actions" style="margin-top:24px;">
                <button class="rm-modal-cancel" @click="showThresholdModal = false" :disabled="isSavingThresholds">Cancel</button>
                <button class="rm-modal-confirm" @click="saveThresholds" :disabled="isSavingThresholds" style="background:#f0a500;">{{ isSavingThresholds ? 'Saving...' : 'Apply Limits' }}</button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Add Room Modal -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="showAddRoom" class="modal-overlay" @click.self="showAddRoom = false">
          <div class="rm-modal">
            <div class="rm-modal-hdr">
              <span class="rm-modal-title">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Add New Room
              </span>
              <button class="rm-modal-x" @click="showAddRoom = false" :disabled="isAddingRoom">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="rm-modal-body">
              <label class="rm-modal-label">Room Name</label>
              <input v-model="newRoomName" class="rm-modal-input" placeholder="e.g. Computer Laboratory 1" @keyup.enter="addRoom" autofocus :disabled="isAddingRoom"/>
              <p class="rm-modal-hint">The room will be added to Room Status and IoT Controls.</p>
              <div class="rm-modal-actions">
                <button class="rm-modal-cancel" @click="showAddRoom = false" :disabled="isAddingRoom">Cancel</button>
                <button class="rm-modal-confirm" @click="addRoom" :disabled="!newRoomName.trim() || isAddingRoom">{{ isAddingRoom ? 'Saving...' : 'Add Room' }}</button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Rename Modal -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="showRenameRoom" class="modal-overlay" @click.self="showRenameRoom = false">
          <div class="rm-modal">
            <div class="rm-modal-hdr">
              <span class="rm-modal-title">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Rename Room
              </span>
              <button class="rm-modal-x" @click="showRenameRoom = false" :disabled="isRenaming">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="rm-modal-body">
              <label class="rm-modal-label">New Room Name</label>
              <input v-model="renameValue" class="rm-modal-input" placeholder="Enter new name" @keyup.enter="confirmRename" :disabled="isRenaming"/>
              <div class="rm-modal-actions">
                <button class="rm-modal-cancel" @click="showRenameRoom = false" :disabled="isRenaming">Cancel</button>
                <button class="rm-modal-confirm" @click="confirmRename" :disabled="!renameValue.trim() || isRenaming">{{ isRenaming ? 'Saving...' : 'Save Name' }}</button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Delete Confirm -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="showDeleteConfirm" class="modal-overlay" @click.self="cancelDelete">
          <div class="del-confirm-modal">
            <div class="del-confirm-icon">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#e74c3c" stroke-width="2" stroke-linecap="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
                <path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
              </svg>
            </div>
            <div class="del-confirm-text">
              <div class="del-confirm-title">Delete Room?</div>
              <div class="del-confirm-sub">Are you sure you want to delete <b>"{{ deleteTargetName }}"</b>? This action cannot be undone.</div>
            </div>
            <div class="del-confirm-actions">
              <button class="del-confirm-cancel" @click="cancelDelete" :disabled="isDeleting">Cancel</button>
              <button class="del-confirm-ok" @click="confirmDeleteRoom" :disabled="isDeleting">{{ isDeleting ? 'Deleting...' : 'Yes, Delete' }}</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- Report Modal -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="showReportModal" class="modal-overlay" @click.self="showReportModal = false">
          <div class="rm-modal" style="width:min(400px,calc(100vw - 32px))">
            <div class="rm-modal-hdr">
              <span class="rm-modal-title">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                Export Analytics
              </span>
              <button class="rm-modal-x" @click="showReportModal = false" :disabled="isDownloading">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
            <div class="rm-modal-body" style="text-align:center">
              <p style="color:var(--txt2);margin-bottom:24px;font-size:13px">Select the timeframe to generate your PDF report:</p>
              <div v-if="!isDownloading" style="display:flex;flex-direction:column;gap:12px">
                <button @click="downloadReport('daily')"   class="rm-modal-cancel" style="width:100%">Daily Report</button>
                <button @click="downloadReport('weekly')"  class="rm-modal-cancel" style="width:100%">Weekly Report</button>
                <button @click="downloadReport('monthly')" class="rm-modal-cancel" style="width:100%">Monthly Report</button>
              </div>
              <div v-else style="margin:20px 0;color:#c8e63c;font-weight:500"><p>Crunching the numbers… Please wait.</p></div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

  </div>
</template>

<style>
@import '../assets/dashboard.css';
</style>