<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { io } from 'socket.io-client'

// ══ ROOM COLOR PALETTE ══
const ROOM_COLORS = [
  { stroke: '#c8e63c', fill: 'rgba(200,230,60,0.18)' },
  { stroke: '#36d1dc', fill: 'rgba(54,209,220,0.15)' },
  { stroke: '#ff6b6b', fill: 'rgba(255,107,107,0.15)' },
  { stroke: '#f7971e', fill: 'rgba(247,151,30,0.15)' },
  { stroke: '#a78bfa', fill: 'rgba(167,139,250,0.15)' },
  { stroke: '#34d399', fill: 'rgba(52,211,153,0.15)' },
  { stroke: '#fb923c', fill: 'rgba(251,146,60,0.15)' },
  { stroke: '#f472b6', fill: 'rgba(244,114,182,0.15)' },
]

// ══ SENSOR STATE ══
const currentPower       = ref(0)
const currentTemperature = ref(0)
const currentHumidity    = ref(0)
const todaysCost         = ref(0)
const todaysUsageKwh     = ref(0)
const weeklyEnergy       = ref(58.7)
const isConnected        = ref(false)
const isSimulating       = ref(false)
const logs               = ref([])

// ══ UI STATE ══
const activeTab         = ref('Real-Time')
const selectedPowerRoom = ref('all')  // 'all' | 0-7

// ══ THRESHOLDS ══
const TEMP_THRESH = 28
const HUM_THRESH  = 70
const PWR_THRESH  = 500
const getTempStatus = v => v >= TEMP_THRESH ? 'High' : 'Normal'
const getHumStatus  = v => v >= HUM_THRESH  ? 'High' : 'Normal'
const getPwrStatus  = v => v >= PWR_THRESH  ? 'High' : 'Normal'

// ══ ROOMS 1-8 — each has its own history ══
const rooms = ref(
  Array.from({ length: 8 }, (_, i) => ({
    id:           i + 1,
    name:         `Computer Laboratory ${i + 1}`,
    color:        ROOM_COLORS[i],
    power:        0,
    temp:         0,
    humidity:     0,
    tempStatus:   'Normal',
    humStatus:    'Normal',
    pwrStatus:    'Normal',
    powerHistory: [],
    tempHistory:  [],
  }))
)

// Overall power history (all rooms same feed in single-sensor setup)
const overallPowerHistory = ref([])

// ══ CAROUSEL ══
const roomPage       = ref(0)
const slideDirection = ref('left')
const showAllRooms   = ref(false)
const selectedRoom   = ref(null)
let   rotateTimer    = null

const visibleRooms = computed(() =>
  rooms.value.slice(roomPage.value * 4, roomPage.value * 4 + 4)
)

function goToPage(page, dir = 'left') {
  if (page === roomPage.value) return
  slideDirection.value = dir
  roomPage.value = page
}
function startRotation() {
  if (rotateTimer) return
  rotateTimer = setInterval(() => goToPage((roomPage.value + 1) % 2, 'left'), 5000)
}
function stopRotation() { clearInterval(rotateTimer); rotateTimer = null }

function openRoom(room)  { selectedRoom.value = { ...room }; stopRotation() }
function closeRoom()     { selectedRoom.value = null; startRotation() }
function openAllRooms()  { showAllRooms.value = true; stopRotation() }
function closeAllRooms() { showAllRooms.value = false; startRotation() }

// ══ CHART CONFIG ══
const CW = 720, CH = 180, TH = 130

// Power chart data — either overall or one room
const powerChartData = computed(() => {
  if (selectedPowerRoom.value === 'all') {
    return [{ data: overallPowerHistory.value, color: { stroke: '#c8e63c' } }]
  }
  const r = rooms.value[selectedPowerRoom.value]
  return [{ data: r.powerHistory, color: r.color }]
})

const displayMaxPower     = computed(() => { const a = powerChartData.value.flatMap(s => s.data); return a.length ? Math.max(...a, 100) : 100 })
const displayMinPower     = computed(() => { const a = powerChartData.value.flatMap(s => s.data); return a.length ? Math.min(...a) : 0 })
const displayCurrentPower = computed(() => selectedPowerRoom.value === 'all' ? currentPower.value : (rooms.value[selectedPowerRoom.value]?.power ?? 0))

function buildLinePath(data, maxV, height) {
  if (data.length < 2) return ''
  const peak = Math.max(maxV * 1.15, 1)
  return data.map((v, i) => {
    const x = (i / (data.length - 1)) * CW
    const y = height - (v / peak) * height
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${Math.max(0, y).toFixed(1)}`
  }).join(' ')
}
function buildAreaPath(data, maxV, height) {
  return data.length < 2 ? '' : buildLinePath(data, maxV, height) + ` L${CW},${height} L0,${height} Z`
}

function buildRoomTempPath(idx) {
  const d = rooms.value[idx].tempHistory
  if (d.length < 2) return ''
  return d.map((p, i) => {
    const x = (i / (d.length - 1)) * CW
    const y = TH - (Math.min(p.temp, 60) / 60) * TH
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${Math.max(0, y).toFixed(1)}`
  }).join(' ')
}
function buildRoomHumPath(idx) {
  const d = rooms.value[idx].tempHistory
  if (d.length < 2) return ''
  return d.map((p, i) => {
    const x = (i / (d.length - 1)) * CW
    const y = TH - (p.humidity / 100) * TH
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${Math.max(0, y).toFixed(1)}`
  }).join(' ')
}

function xLabel(i, total) {
  const t = new Date()
  t.setMinutes(t.getMinutes() - 25 + Math.round((i / (total - 1)) * 25))
  return `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`
}

// ══ SENSOR DATA HANDLER ══
function applySensorData(data) {
  const power       = Number(data.power)
  const temperature = Number(data.temperature)
  const humidity    = Number(data.humidity)
  if (isNaN(power) || isNaN(temperature) || isNaN(humidity)) return

  currentPower.value       = power
  currentTemperature.value = temperature
  currentHumidity.value    = humidity

  rooms.value.forEach(r => {
    r.power      = power
    r.temp       = temperature
    r.humidity   = humidity
    r.tempStatus = getTempStatus(temperature)
    r.humStatus  = getHumStatus(humidity)
    r.pwrStatus  = getPwrStatus(power)
    r.powerHistory.push(power)
    if (r.powerHistory.length > 60) r.powerHistory.shift()
    r.tempHistory.push({ temp: temperature, humidity })
    if (r.tempHistory.length > 60) r.tempHistory.shift()
  })

  overallPowerHistory.value.push(power)
  if (overallPowerHistory.value.length > 60) overallPowerHistory.value.shift()

  if (selectedRoom.value) {
    const live = rooms.value.find(r => r.id === selectedRoom.value.id)
    if (live) selectedRoom.value = { ...live }
  }

  const kwh = (power / 1000) * (2 / 3600)
  todaysUsageKwh.value = +(todaysUsageKwh.value + kwh).toFixed(5)
  todaysCost.value     = +(todaysCost.value + kwh * 11.8).toFixed(4)

  const ts = new Date().toLocaleString('en-PH', { month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })
  logs.value.unshift({ timestamp: ts, event: 'Sensor Update', details: `Power: ${power} W | Temp: ${temperature}C | Hum: ${humidity}%` })
  if (logs.value.length > 30) logs.value.pop()
}

const hasAlert = r => r.tempStatus === 'High' || r.pwrStatus === 'High' || r.humStatus === 'High'

// ══ SOCKET + SIM ══
let socket, simInterval = null

function stopSim()  { if (simInterval !== null) { clearInterval(simInterval); simInterval = null; isSimulating.value = false } }
function startSim() {
  if (simInterval !== null) return
  isSimulating.value = true
  simInterval = setInterval(() => {
    const lastP = overallPowerHistory.value.at(-1) ?? 500
    const lastT = rooms.value[0].tempHistory.at(-1)?.temp ?? 25
    const lastH = rooms.value[0].tempHistory.at(-1)?.humidity ?? 50
    applySensorData({
      power:       Math.max(0, Math.min(2000, Math.round(lastP + (Math.random() - 0.5) * 80))),
      temperature: +Math.max(0, Math.min(60,  lastT + (Math.random() - 0.5) * 0.5)).toFixed(1),
      humidity:    +Math.max(0, Math.min(100, lastH + (Math.random() - 0.5) * 2)).toFixed(1),
    })
  }, 2000)
}

onMounted(() => {
  socket = io('http://localhost:3000', { transports: ['websocket'], reconnectionAttempts: 10, reconnectionDelay: 2000 })
  socket.on('connect',       () => { isConnected.value = true;  stopSim() })
  socket.on('sensor_update', d  => { stopSim(); applySensorData(d) })
  socket.on('disconnect',    () => { isConnected.value = false; startSim() })
  socket.on('connect_error', () => { isConnected.value = false; startSim() })
  startSim()
  startRotation()
})
onUnmounted(() => { stopSim(); stopRotation(); if (socket) socket.disconnect() })
</script>

<template>
  <div class="db">

    <!-- HEADER -->
    <header class="header">
      <div class="header-left">
        <svg viewBox="0 0 40 40" width="36" height="36" style="flex-shrink:0">
          <circle cx="20" cy="20" r="19" fill="#1a3a1a" stroke="#4caf50" stroke-width="1.5"/>
          <text x="20" y="26" text-anchor="middle" font-size="10" font-weight="bold" fill="#4caf50" font-family="Arial">CCIS</text>
        </svg>
        <div>
          <h1 class="title">CCIS Power Monitoring Dashboard</h1>
          <p class="subtitle">College of Computing and Information Sciences — Caraga State University</p>
        </div>
      </div>
      <div class="header-right">
        <div :class="['conn-pill', isConnected ? 'live' : isSimulating ? 'sim' : 'off']">
          <span class="conn-dot"></span>
          <span class="conn-lbl">{{ isConnected ? 'Live' : isSimulating ? 'Simulating' : 'Offline' }}</span>
        </div>
        <div class="icon-btn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          <span class="notif-dot"></span>
        </div>
        <div class="avatar-btn">
          <div class="avatar">A</div>
          <span class="av-lbl">Admin</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </div>
    </header>

    <!-- STAT CARDS -->
    <section class="stat-cards">
      <div class="stat-card green">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="white" opacity=".9"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        <div><p class="stat-label">Current Power Usage</p><p class="stat-value">{{ currentPower }} <span class="stat-unit">W</span></p></div>
      </div>
      <div class="stat-card orange">
        <span class="stat-peso">&#8369;</span>
        <div><p class="stat-label">Today's Cost</p><p class="stat-value">&#8369;{{ todaysCost.toFixed(2) }}</p></div>
      </div>
      <div class="stat-card blue">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" opacity=".9"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        <div><p class="stat-label">Weekly Energy Usage</p><p class="stat-value">{{ weeklyEnergy }} <span class="stat-unit">kWh</span></p></div>
      </div>
      <div class="stat-card purple clickable">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" opacity=".9">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
        <div><p class="stat-label">&nbsp;</p><p class="stat-value-sm">Generate PDF Report</p></div>
      </div>
    </section>

    <!-- MAIN GRID -->
    <div class="main-grid">
      <div class="left-col">

        <!-- ══ POWER USAGE CHART ══ -->
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">Power Usage Chart</span>
            <span class="dots">···</span>
          </div>
          <div class="tabs">
            <button v-for="t in ['Real-Time','Daily','Weekly']" :key="t"
              :class="['tab', { active: activeTab === t }]" @click="activeTab = t">{{ t }}</button>
          </div>

          <!-- Room selector pills -->
          <div class="room-selector">
            <button :class="['rs-pill', { active: selectedPowerRoom === 'all' }]" @click="selectedPowerRoom = 'all'">
              <span class="rs-dot" style="background:#e0e0e0"></span> All Rooms
            </button>
            <button v-for="(room, idx) in rooms" :key="idx"
              :class="['rs-pill', { active: selectedPowerRoom === idx }]"
              :style="selectedPowerRoom === idx ? { borderColor: room.color.stroke, background: `rgba(${room.color.stroke.replace('#','').match(/../g).map(h=>parseInt(h,16)).join(',')},0.12)` } : {}"
              @click="selectedPowerRoom = idx">
              <span class="rs-dot" :style="{ background: room.color.stroke }"></span>
              Lab {{ idx + 1 }}
            </button>
          </div>

          <!-- Selected label -->
          <div class="chart-ctx-label">
            <span v-if="selectedPowerRoom === 'all'" class="ctx-all">&#9646; Overall — all 8 laboratories</span>
            <span v-else class="ctx-room" :style="{ color: rooms[selectedPowerRoom].color.stroke }">
              ● {{ rooms[selectedPowerRoom].name }}
            </span>
          </div>

          <div class="chart-wrap">
            <div class="y-labels">
              <span v-for="v in [2000,1500,1000,500,0]" :key="v" :style="{ bottom: (v/2000*100)+'%' }">{{ v }}</span>
            </div>
            <div class="chart-inner">
              <svg :viewBox="`0 0 ${CW} ${CH}`" class="chart-svg" preserveAspectRatio="none">
                <defs>
                  <linearGradient v-for="(s,si) in powerChartData" :key="'pg'+si" :id="'pg'+si" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   :stop-color="s.color.stroke" stop-opacity="0.35"/>
                    <stop offset="100%" :stop-color="s.color.stroke" stop-opacity="0.02"/>
                  </linearGradient>
                </defs>
                <line v-for="v in [0,500,1000,1500,2000]" :key="v"
                  x1="0" :y1="CH-(v/2000)*CH" :x2="CW" :y2="CH-(v/2000)*CH" stroke="#252a35" stroke-width="1"/>
                <template v-for="(s,si) in powerChartData" :key="'ps'+si">
                  <path v-if="s.data.length>=2" :d="buildAreaPath(s.data,displayMaxPower,CH)" :fill="`url(#pg${si})`"/>
                  <path v-if="s.data.length>=2" :d="buildLinePath(s.data,displayMaxPower,CH)"
                    fill="none" :stroke="s.color.stroke" stroke-width="2.5" stroke-linejoin="round"/>
                </template>
              </svg>
              <div class="x-labels">
                <span v-for="(_,i) in Array(6)" :key="i">{{ xLabel(i,6) }}</span>
              </div>
            </div>
          </div>
          <div class="power-stats">
            <span>Current: <b :style="{ color: selectedPowerRoom==='all' ? '#c8e63c' : rooms[selectedPowerRoom]?.color.stroke }">{{ displayCurrentPower }} W</b></span>
            <span>Max: <b :style="{ color: selectedPowerRoom==='all' ? '#c8e63c' : rooms[selectedPowerRoom]?.color.stroke }">{{ displayMaxPower }} W</b></span>
            <span>Min: <b :style="{ color: selectedPowerRoom==='all' ? '#c8e63c' : rooms[selectedPowerRoom]?.color.stroke }">{{ displayMinPower }} W</b></span>
          </div>
        </div>

        <!-- ══ TEMPERATURE & HUMIDITY TREND ══ -->
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">Temperature &amp; Humidity Trend</span>
            <span class="dots">···</span>
          </div>

          <!-- Color legend — one per room -->
          <div class="room-legend">
            <div v-for="(room,idx) in rooms" :key="idx" class="rl-item">
              <span class="rl-dot" :style="{ background: room.color.stroke }"></span>
              <span class="rl-name" :style="{ color: room.color.stroke }">Lab {{ idx+1 }}</span>
            </div>
          </div>

          <!-- Temperature lines chart -->
          <p class="chart-sublabel">Temperature (°C) — solid lines</p>
          <div class="chart-wrap" style="--ch:150px">
            <div class="y-labels" style="font-size:10px">
              <span style="bottom:100%">60°</span><span style="bottom:50%">30°</span><span style="bottom:0%">0°</span>
            </div>
            <div class="chart-inner">
              <svg :viewBox="`0 0 ${CW} ${TH}`" class="chart-svg" preserveAspectRatio="none">
                <line v-for="v in [0,20,40,60]" :key="v"
                  x1="0" :y1="TH-(v/60)*TH" :x2="CW" :y2="TH-(v/60)*TH" stroke="#252a35" stroke-width="1"/>
                <template v-for="(_,idx) in rooms" :key="'tr'+idx">
                  <path v-if="rooms[idx].tempHistory.length>=2"
                    :d="buildRoomTempPath(idx)"
                    fill="none" :stroke="rooms[idx].color.stroke"
                    stroke-width="1.8" stroke-linejoin="round" opacity="0.9"/>
                </template>
              </svg>
              <div class="x-labels">
                <span v-for="(_,i) in Array(6)" :key="i">{{ xLabel(i,6) }}</span>
              </div>
            </div>
          </div>

          <!-- Humidity lines chart -->
          <p class="chart-sublabel" style="margin-top:12px">Humidity (%) — dashed lines</p>
          <div class="chart-wrap" style="--ch:110px; margin-bottom:14px">
            <div class="y-labels" style="font-size:10px">
              <span style="bottom:100%">100</span><span style="bottom:50%">50</span><span style="bottom:0%">0</span>
            </div>
            <div class="chart-inner">
              <svg :viewBox="`0 0 ${CW} ${TH}`" class="chart-svg" preserveAspectRatio="none">
                <line v-for="v in [0,25,50,75,100]" :key="v"
                  x1="0" :y1="TH-(v/100)*TH" :x2="CW" :y2="TH-(v/100)*TH" stroke="#252a35" stroke-width="1"/>
                <template v-for="(_,idx) in rooms" :key="'hr'+idx">
                  <path v-if="rooms[idx].tempHistory.length>=2"
                    :d="buildRoomHumPath(idx)"
                    fill="none" :stroke="rooms[idx].color.stroke"
                    stroke-width="1.8" stroke-dasharray="5 3" opacity="0.7"/>
                </template>
              </svg>
              <div class="x-labels">
                <span v-for="(_,i) in Array(6)" :key="i">{{ xLabel(i,6) }}</span>
              </div>
            </div>
          </div>

          <!-- Readout chips -->
          <div class="readout-cards">
            <div class="readout-card">
              <span class="rtc-icon">&#127777;</span>
              <div>
                <div class="rtc-name">Temperature</div>
                <div class="rtc-val" style="color:#c8e63c">{{ currentTemperature }}°C</div>
                <span :class="['badge', currentTemperature>=TEMP_THRESH ? 'badge-high' : 'badge-ok']">{{ getTempStatus(currentTemperature) }}</span>
              </div>
            </div>
            <div class="readout-card">
              <span class="rtc-icon">&#128167;</span>
              <div>
                <div class="rtc-name">Humidity</div>
                <div class="rtc-val" style="color:#36d1dc">{{ currentHumidity }}%</div>
                <span :class="['badge', currentHumidity>=HUM_THRESH ? 'badge-high' : 'badge-ok']">{{ getHumStatus(currentHumidity) }}</span>
              </div>
            </div>
            <div class="readout-card">
              <span class="rtc-icon">&#9889;</span>
              <div>
                <div class="rtc-name">Power</div>
                <div class="rtc-val" style="color:#c8e63c">{{ currentPower }} W</div>
                <span :class="['badge', currentPower>=PWR_THRESH ? 'badge-high' : 'badge-ok']">{{ getPwrStatus(currentPower) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- LOGS -->
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Recent Logs</span><span class="dots">···</span></div>
          <div class="table-scroll">
            <table class="logs-table">
              <thead><tr><th>Timestamp</th><th>Event</th><th>Details</th></tr></thead>
              <tbody>
                <tr v-for="(log,i) in logs.slice(0,8)" :key="i">
                  <td data-label="Timestamp">{{ log.timestamp }}</td>
                  <td data-label="Event">{{ log.event }}</td>
                  <td data-label="Details">{{ log.details }}</td>
                </tr>
                <tr v-if="!logs.length"><td colspan="3" class="empty-log">Waiting for sensor data…</td></tr>
              </tbody>
            </table>
          </div>
        </div>

      </div><!-- /left-col -->

      <div class="right-col">

        <!-- ROOM STATUS -->
        <div class="panel room-panel">
          <div class="panel-header">
            <span class="panel-title">Room Status</span>
            <div class="room-actions">
              <div class="page-dots">
                <button v-for="p in 2" :key="p"
                  :class="['pdot', { active: roomPage===p-1 }]"
                  @click="goToPage(p-1, p-1>roomPage?'left':'right')"></button>
              </div>
              <button class="all-btn" @click="openAllRooms">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
                  <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
                </svg>
                <span class="all-btn-lbl">All Rooms</span>
              </button>
            </div>
          </div>
          <div class="page-indicator">
            <span class="page-range">Labs {{ roomPage===0 ? '1–4' : '5–8' }}</span>
            <span class="page-hint">auto-rotates every 5s</span>
          </div>
          <!-- Fixed viewport — panels below never shift -->
          <div class="carousel-viewport">
            <Transition :name="'slide-'+slideDirection" mode="out-in">
              <div class="room-grid" :key="roomPage">
                <div v-for="room in visibleRooms" :key="room.id"
                  class="room-card" :class="{ 'card-alert': hasAlert(room) }"
                  :style="{ '--rc': room.color.stroke }"
                  role="button" tabindex="0"
                  @click="openRoom(room)" @keyup.enter="openRoom(room)">
                  <div class="rc-bar" :style="{ background: room.color.stroke }"></div>
                  <div class="rc-top">
                    <span class="rc-icon" :style="{ color: room.color.stroke }">&#128421;</span>
                    <div>
                      <div class="rc-name">{{ room.name }}</div>
                      <div class="rc-sub">Power: {{ room.power }} W</div>
                    </div>
                  </div>
                  <div class="rc-row">
                    <span>Power: <b :style="{ color: room.pwrStatus==='High'?'#e74c3c':room.color.stroke }">{{ room.power }} W</b></span>
                    <span :class="['stbadge', room.pwrStatus==='High'?'badge-high':'badge-ok']">&#8595; {{ room.pwrStatus }}</span>
                  </div>
                  <div class="rc-row mt4">
                    <span>Temp: <b>{{ room.temp }}°C</b></span>
                    <span :class="['stbadge', room.tempStatus==='High'?'badge-high':'badge-ok']">&#127777; {{ room.tempStatus }}</span>
                  </div>
                  <div class="rc-row mt4">
                    <span>Hum: <b>{{ room.humidity }}%</b></span>
                    <span :class="['stbadge', room.humStatus==='High'?'badge-high':'badge-ok']">&#128167; {{ room.humStatus }}</span>
                  </div>
                  <div class="rc-tap-hint">Tap for details ›</div>
                </div>
              </div>
            </Transition>
          </div>
        </div>

        <!-- ENERGY SUMMARY -->
        <div class="panel">
          <div class="panel-header"><span class="panel-title">Energy Summary</span><span class="dots">···</span></div>
          <div class="energy-grid">
            <div class="energy-item"><p class="energy-label">Today's Usage</p><p class="energy-value">{{ todaysUsageKwh.toFixed(3) }} <span class="lime">kWh</span></p></div>
            <div class="energy-item"><p class="energy-label">This Week's Usage</p><p class="energy-value">{{ weeklyEnergy }} <span class="lime">kWh</span></p></div>
            <div class="energy-item full"><p class="energy-label">Estimated Monthly Cost</p><p class="energy-value">&#8369;{{ (todaysCost*30).toFixed(2) }}</p></div>
          </div>
        </div>

      </div><!-- /right-col -->
    </div><!-- /main-grid -->

    <!-- ROOM DETAIL MODAL -->
    <Teleport to="body">
      <Transition name="mfade">
        <div v-if="selectedRoom" class="modal-overlay" @click.self="closeRoom">
          <div class="modal-box detail-box" :style="{ borderTop: `3px solid ${selectedRoom.color.stroke}` }">
            <div class="modal-header">
              <div>
                <div class="modal-title">
                  <span :style="{ color: selectedRoom.color.stroke }">&#128421;</span> {{ selectedRoom.name }}
                </div>
                <div class="modal-sub">Live sensor reading — updates every 2s</div>
              </div>
              <button class="modal-close" @click="closeRoom">&#10005;</button>
            </div>
            <div :class="['detail-banner', hasAlert(selectedRoom)?'banner-alert':'banner-ok']">
              <span v-if="hasAlert(selectedRoom)">&#9888; One or more readings above threshold</span>
              <span v-else>&#10003; All readings within normal range</span>
            </div>
            <div class="detail-stats">
              <div class="dstat" :class="{ 'dstat-alert': selectedRoom.pwrStatus==='High' }">
                <div class="dstat-icon">&#9889;</div>
                <div class="dstat-label">Power</div>
                <div class="dstat-val" :style="{ color: selectedRoom.pwrStatus==='High'?'#e74c3c':selectedRoom.color.stroke }">{{ selectedRoom.power }}<span class="dstat-unit"> W</span></div>
                <span :class="['badge', selectedRoom.pwrStatus==='High'?'badge-high':'badge-ok']">{{ selectedRoom.pwrStatus }}</span>
                <div class="dstat-thresh">Threshold: {{ PWR_THRESH }} W</div>
              </div>
              <div class="dstat" :class="{ 'dstat-alert': selectedRoom.tempStatus==='High' }">
                <div class="dstat-icon">&#127777;</div>
                <div class="dstat-label">Temperature</div>
                <div class="dstat-val" :style="{ color: selectedRoom.color.stroke }">{{ selectedRoom.temp }}<span class="dstat-unit"> °C</span></div>
                <span :class="['badge', selectedRoom.tempStatus==='High'?'badge-high':'badge-ok']">{{ selectedRoom.tempStatus }}</span>
                <div class="dstat-thresh">Threshold: {{ TEMP_THRESH }}°C</div>
              </div>
              <div class="dstat" :class="{ 'dstat-alert': selectedRoom.humStatus==='High' }">
                <div class="dstat-icon">&#128167;</div>
                <div class="dstat-label">Humidity</div>
                <div class="dstat-val" :style="{ color: selectedRoom.color.stroke }">{{ selectedRoom.humidity }}<span class="dstat-unit"> %</span></div>
                <span :class="['badge', selectedRoom.humStatus==='High'?'badge-high':'badge-ok']">{{ selectedRoom.humStatus }}</span>
                <div class="dstat-thresh">Threshold: {{ HUM_THRESH }}%</div>
              </div>
            </div>
            <div class="detail-bars">
              <div class="dbar-row">
                <span class="dbar-label">Power</span>
                <div class="dbar-track"><div class="dbar-fill" :style="{ width: Math.min(100,(selectedRoom.power/2000)*100)+'%', background: selectedRoom.pwrStatus==='High'?'#e74c3c':selectedRoom.color.stroke }"></div></div>
                <span class="dbar-val">{{ Math.round((selectedRoom.power/2000)*100) }}%</span>
              </div>
              <div class="dbar-row">
                <span class="dbar-label">Temperature</span>
                <div class="dbar-track"><div class="dbar-fill" :style="{ width: Math.min(100,(selectedRoom.temp/60)*100)+'%', background: selectedRoom.tempStatus==='High'?'#e74c3c':selectedRoom.color.stroke }"></div></div>
                <span class="dbar-val">{{ Math.round((selectedRoom.temp/60)*100) }}%</span>
              </div>
              <div class="dbar-row">
                <span class="dbar-label">Humidity</span>
                <div class="dbar-track"><div class="dbar-fill" :style="{ width: Math.min(100,selectedRoom.humidity)+'%', background: selectedRoom.humStatus==='High'?'#e74c3c':selectedRoom.color.stroke }"></div></div>
                <span class="dbar-val">{{ selectedRoom.humidity }}%</span>
              </div>
            </div>
            <div class="detail-footer">
              <span class="detail-note">&#128225; Data synced live from sensor</span>
              <button class="close-btn" @click="closeRoom">Close</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ALL ROOMS MODAL -->
    <Teleport to="body">
      <Transition name="mfade">
        <div v-if="showAllRooms" class="modal-overlay" @click.self="closeAllRooms">
          <div class="modal-box">
            <div class="modal-header">
              <div class="modal-title">&#128421; All Computer Laboratories</div>
              <button class="modal-close" @click="closeAllRooms">&#10005;</button>
            </div>
            <div class="all-rooms-grid">
              <div v-for="room in rooms" :key="room.id"
                class="arc" :class="{ 'arc-alert': hasAlert(room) }"
                :style="{ '--arc': room.color.stroke }"
                @click="() => { closeAllRooms(); openRoom(room) }">
                <div class="arc-cbar" :style="{ background: room.color.stroke }"></div>
                <div class="arc-head">
                  <span class="arc-num" :style="{ color: room.color.stroke }">Lab {{ room.id }}</span>
                  <span :class="['badge', hasAlert(room)?'badge-high':'badge-ok']">{{ hasAlert(room)?'&#9888; Alert':'&#10003; OK' }}</span>
                </div>
                <div class="arc-name">{{ room.name }}</div>
                <div class="arc-rows">
                  <div class="arc-row"><span class="arc-lbl">&#9889; Power</span><b :style="{ color: room.pwrStatus==='High'?'#e74c3c':room.color.stroke }">{{ room.power }} W</b></div>
                  <div class="arc-row"><span class="arc-lbl">&#127777; Temp</span><b>{{ room.temp }}°C</b></div>
                  <div class="arc-row"><span class="arc-lbl">&#128167; Hum</span><b>{{ room.humidity }}%</b></div>
                </div>
                <div class="arc-hint">Tap to view details ›</div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
.db{background:#0f1117;min-height:100vh;color:#e0e0e0;font-family:'Inter',sans-serif;font-size:14px;padding-bottom:28px;overflow-x:hidden}
.header{background:#161922;border-bottom:1px solid #252a35;padding:12px 24px;display:flex;align-items:center;justify-content:space-between;gap:12px;position:sticky;top:0;z-index:50}
.header-left{display:flex;align-items:center;gap:12px;min-width:0}
.header-right{display:flex;align-items:center;gap:12px;flex-shrink:0}
.title{font-family:'Rajdhani',sans-serif;font-size:clamp(13px,2.2vw,21px);font-weight:700;color:#fff;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.subtitle{font-size:clamp(10px,1.3vw,12px);color:#777;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.conn-pill{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;padding:4px 10px;border-radius:20px}
.conn-pill.live{background:#1a3a1a;color:#4caf50;border:1px solid #2a5a2a}
.conn-pill.sim{background:#3a3010;color:#f0b429;border:1px solid #5a4a10}
.conn-pill.off{background:#3a1010;color:#e74c3c;border:1px solid #5a1a1a}
.conn-dot{width:7px;height:7px;border-radius:50%;background:currentColor;animation:blink 1.5s infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.25}}
.icon-btn{position:relative;cursor:pointer;color:#aaa;display:flex;align-items:center}
.notif-dot{position:absolute;top:-3px;right:-3px;width:8px;height:8px;border-radius:50%;background:#e74c3c;border:1.5px solid #161922}
.avatar-btn{display:flex;align-items:center;gap:6px;cursor:pointer;color:#ccc;font-size:13px}
.avatar{width:30px;height:30px;border-radius:50%;background:#3a4a6b;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;font-size:12px}
.stat-cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:16px 24px 0}
.stat-card{border-radius:10px;padding:16px 18px;display:flex;align-items:center;gap:14px;min-height:76px}
.stat-card.green{background:linear-gradient(135deg,#2d5a1b,#3a7022)}
.stat-card.orange{background:linear-gradient(135deg,#7a3c00,#9e5200)}
.stat-card.blue{background:linear-gradient(135deg,#1a3a6b,#1e4a88)}
.stat-card.purple{background:linear-gradient(135deg,#3b1f6a,#4e2a8e)}
.stat-card.clickable{cursor:pointer;transition:filter .2s}
.stat-card.clickable:hover{filter:brightness(1.1)}
.stat-peso{font-size:26px;font-weight:700;color:#fff;flex-shrink:0}
.stat-label{font-size:11px;color:rgba(255,255,255,.75);margin-bottom:3px}
.stat-value{font-family:'Rajdhani',sans-serif;font-size:clamp(18px,2.5vw,24px);font-weight:700;color:#fff}
.stat-unit{font-size:13px;opacity:.8}
.stat-value-sm{font-family:'Rajdhani',sans-serif;font-size:clamp(13px,1.8vw,17px);font-weight:700;color:#fff}
.main-grid{display:grid;grid-template-columns:1fr 370px;gap:14px;padding:14px 24px 0}
.left-col,.right-col{display:flex;flex-direction:column;gap:14px;min-width:0}
.panel{background:#161922;border-radius:10px;padding:16px 18px;border:1px solid #252a35}
.panel-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.panel-title{font-family:'Rajdhani',sans-serif;font-size:clamp(13px,1.8vw,16px);font-weight:600;color:#e0e0e0}
.dots{color:#555;font-size:16px;letter-spacing:2px;cursor:pointer}
.tabs{display:flex;margin-bottom:10px}
.tab{background:transparent;border:1px solid #333;color:#888;font-size:12px;padding:5px 12px;cursor:pointer;transition:.15s}
.tab:first-child{border-radius:6px 0 0 6px}.tab:last-child{border-radius:0 6px 6px 0}
.tab.active{background:#c8e63c;color:#0f1117;border-color:#c8e63c;font-weight:600}

/* Room selector */
.room-selector{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.rs-pill{display:inline-flex;align-items:center;gap:5px;background:#1c2130;border:1px solid #2a3040;color:#aaa;font-size:11px;font-weight:500;padding:4px 10px;border-radius:20px;cursor:pointer;transition:border-color .15s,background .15s,color .15s;white-space:nowrap}
.rs-pill:hover{border-color:#4a5a70;color:#ddd}
.rs-pill.active{color:#fff;font-weight:600}
.rs-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.chart-ctx-label{font-size:11px;margin-bottom:8px;min-height:16px}
.ctx-all{color:#666;font-weight:500}
.ctx-room{font-weight:700}
.chart-sublabel{font-size:11px;font-weight:600;color:#555;margin-bottom:4px}

/* Charts */
.chart-wrap{display:flex;gap:8px;height:var(--ch,210px);margin-bottom:20px}
.y-labels{position:relative;width:32px;flex-shrink:0;font-size:10px;color:#555}
.y-labels span{position:absolute;right:0;transform:translateY(50%);line-height:1}
.chart-inner{flex:1;display:flex;flex-direction:column;min-width:0;gap:4px}
.chart-svg{flex:1;width:100%;display:block;min-height:0}
.x-labels{display:flex;justify-content:space-between;font-size:10px;color:#555;flex-shrink:0}
.power-stats{display:flex;gap:16px;font-size:12px;color:#aaa;flex-wrap:wrap}

/* Room legend */
.room-legend{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}
.rl-item{display:flex;align-items:center;gap:5px;font-size:11px}
.rl-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}

/* Readout */
.readout-cards{display:flex;gap:8px;flex-wrap:wrap}
.readout-card{background:#1f2430;border:1px solid #2a3040;border-radius:8px;padding:10px 12px;display:flex;align-items:flex-start;gap:8px;flex:1;min-width:100px}
.rtc-icon{font-size:18px;flex-shrink:0}
.rtc-name{font-size:11px;color:#888;margin-bottom:2px}
.rtc-val{font-family:'Rajdhani',sans-serif;font-size:18px;font-weight:700;line-height:1.1}
.badge{font-size:10px;padding:2px 7px;border-radius:4px;font-weight:600;display:inline-block}
.badge-ok{background:#1a3a1a;color:#4caf50}
.badge-high{background:#3a1a1a;color:#e74c3c}

/* Logs */
.table-scroll{overflow-x:auto}
.logs-table{width:100%;border-collapse:collapse;font-size:12px;min-width:380px}
.logs-table th{text-align:left;color:#666;font-weight:500;padding:6px 10px;border-bottom:1px solid #252a35}
.logs-table td{padding:7px 10px;border-bottom:1px solid #1c2030;color:#bbb}
.logs-table tr:last-child td{border-bottom:none}
.logs-table tbody tr:hover{background:#1c2133}
.empty-log{text-align:center;color:#555;font-style:italic;padding:20px !important}

/* Room panel */
.room-actions{display:flex;align-items:center;gap:10px}
.page-dots{display:flex;gap:5px;align-items:center}
.pdot{width:8px;height:8px;border-radius:50%;background:#3a4050;border:none;cursor:pointer;transition:.2s;padding:0}
.pdot.active{background:#c8e63c;transform:scale(1.25)}
.all-btn{display:inline-flex;align-items:center;gap:5px;background:#252a35;border:1px solid #3a4050;color:#c8e63c;font-size:11px;font-weight:600;padding:4px 10px;border-radius:6px;cursor:pointer;transition:.15s}
.all-btn:hover{background:#2e3a50;border-color:#c8e63c}
.page-indicator{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.page-range{font-size:12px;font-weight:600;color:#c8e63c}
.page-hint{font-size:10px;color:#444}

/* Carousel — FIXED height stops layout shift */
.carousel-viewport{position:relative;height:360px;overflow:hidden}
.room-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;position:absolute;inset:0}
.room-card{position:relative;background:#1f2430;border:1px solid #2a3040;border-radius:8px;padding:10px;cursor:pointer;user-select:none;transition:border-color .2s,transform .15s,box-shadow .15s;overflow:hidden}
.room-card:hover{transform:translateY(-2px);box-shadow:0 6px 20px rgba(0,0,0,.3);border-color:var(--rc) !important}
.room-card:active{transform:translateY(0)}
.card-alert{border-color:#5a2a2a !important}
.rc-bar{position:absolute;top:0;left:0;right:0;height:3px;border-radius:8px 8px 0 0}
.rc-top{display:flex;align-items:flex-start;gap:6px;margin-bottom:6px}
.rc-icon{font-size:16px;flex-shrink:0}
.rc-name{font-size:10px;font-weight:700;color:#ddd;line-height:1.2}
.rc-sub{font-size:9px;color:#555;margin-top:1px}
.rc-row{display:flex;justify-content:space-between;align-items:center;font-size:10px;color:#aaa}
.mt4{margin-top:3px}
.stbadge{font-size:10px;font-weight:600;padding:2px 6px;border-radius:4px}
.rc-tap-hint{font-size:9px;color:#333;margin-top:4px;text-align:right;transition:color .2s}
.room-card:hover .rc-tap-hint{color:#666}

/* Slide */
.slide-left-enter-active,.slide-left-leave-active,.slide-right-enter-active,.slide-right-leave-active{transition:transform .32s cubic-bezier(.4,0,.2,1),opacity .32s}
.slide-left-enter-from{transform:translateX(50px);opacity:0}
.slide-left-leave-to{transform:translateX(-50px);opacity:0}
.slide-right-enter-from{transform:translateX(-50px);opacity:0}
.slide-right-leave-to{transform:translateX(50px);opacity:0}

/* Energy */
.energy-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.energy-item{background:#1f2430;border-radius:8px;padding:12px 14px}
.energy-item.full{grid-column:1 / -1}
.energy-label{font-size:11px;color:#888;margin-bottom:4px}
.energy-value{font-family:'Rajdhani',sans-serif;font-size:clamp(18px,2.2vw,24px);font-weight:700;color:#fff}
.lime{color:#c8e63c}

/* Modals */
.modal-overlay{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.72);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:16px}
.modal-box{background:#161922;border:1px solid #2a3040;border-radius:14px;width:100%;max-width:800px;max-height:90vh;overflow-y:auto;box-shadow:0 24px 60px rgba(0,0,0,.6)}
.modal-header{display:flex;justify-content:space-between;align-items:flex-start;padding:18px 22px 14px;border-bottom:1px solid #252a35;position:sticky;top:0;background:#161922;z-index:2;border-radius:14px 14px 0 0}
.modal-title{font-family:'Rajdhani',sans-serif;font-size:18px;font-weight:700;color:#e0e0e0;display:flex;align-items:center;gap:8px}
.modal-sub{font-size:11px;color:#555;margin-top:3px}
.modal-close{background:#252a35;border:1px solid #3a4050;color:#aaa;width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:13px;display:flex;align-items:center;justify-content:center;transition:.15s;flex-shrink:0}
.modal-close:hover{background:#e74c3c;color:#fff;border-color:#e74c3c}
.mfade-enter-active,.mfade-leave-active{transition:opacity .22s,transform .22s}
.mfade-enter-from,.mfade-leave-to{opacity:0;transform:scale(.97)}

/* Detail modal */
.detail-box{max-width:460px}
.detail-banner{margin:16px 22px 0;padding:10px 14px;border-radius:8px;font-size:12px;font-weight:600}
.banner-ok{background:#1a3a1a;color:#4caf50;border:1px solid #2a5a2a}
.banner-alert{background:#3a1a1a;color:#e74c3c;border:1px solid #5a2a2a}
.detail-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:16px 22px}
.dstat{background:#1f2430;border:1px solid #2a3040;border-radius:10px;padding:16px 12px;display:flex;flex-direction:column;align-items:center;text-align:center;gap:4px}
.dstat-alert{border-color:#5a2a2a}
.dstat-icon{font-size:22px}
.dstat-label{font-size:11px;color:#888}
.dstat-val{font-family:'Rajdhani',sans-serif;font-size:26px;font-weight:700;line-height:1}
.dstat-unit{font-size:13px;font-weight:400;opacity:.7}
.dstat-thresh{font-size:10px;color:#444;margin-top:2px}
.detail-bars{padding:0 22px 16px;display:flex;flex-direction:column;gap:12px}
.dbar-row{display:flex;align-items:center;gap:10px}
.dbar-label{width:86px;flex-shrink:0;font-size:11px;color:#888}
.dbar-track{flex:1;height:6px;background:#252a35;border-radius:3px;overflow:hidden}
.dbar-fill{height:100%;border-radius:3px;transition:width .5s ease,background .3s}
.dbar-val{width:34px;text-align:right;font-size:11px;color:#888;flex-shrink:0}
.detail-footer{display:flex;justify-content:space-between;align-items:center;padding:12px 22px 18px;border-top:1px solid #1c2030;gap:12px}
.detail-note{font-size:11px;color:#444}
.close-btn{background:#252a35;border:1px solid #3a4050;color:#ccc;font-size:12px;padding:6px 18px;border-radius:6px;cursor:pointer;transition:.15s}
.close-btn:hover{background:#2e3445}

/* All rooms modal */
.all-rooms-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:18px 22px 22px}
.arc{position:relative;background:#1f2430;border:1px solid #2a3040;border-radius:10px;padding:14px;cursor:pointer;transition:border-color .2s,transform .15s;overflow:hidden}
.arc:hover{transform:translateY(-2px);border-color:var(--arc) !important}
.arc-alert{border-color:#5a2a2a}
.arc-cbar{position:absolute;top:0;left:0;right:0;height:3px;border-radius:10px 10px 0 0}
.arc-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;margin-top:4px}
.arc-num{font-size:11px;font-weight:700}
.arc-name{font-size:10px;color:#777;margin-bottom:10px;line-height:1.3}
.arc-rows{display:flex;flex-direction:column;gap:5px}
.arc-row{display:flex;align-items:center;gap:6px;font-size:11px;color:#aaa}
.arc-lbl{width:56px;flex-shrink:0;color:#555}
.arc-hint{font-size:9px;color:#333;margin-top:8px}

/* Responsive */
@media(max-width:1100px){.main-grid{grid-template-columns:1fr 310px}.all-rooms-grid{grid-template-columns:repeat(4,1fr)}}
@media(max-width:900px){.main-grid{grid-template-columns:1fr}.right-col{display:grid;grid-template-columns:1fr 1fr;gap:14px}.right-col>div:last-child{grid-column:1 / -1}.stat-cards{grid-template-columns:repeat(2,1fr)}.conn-lbl{display:none}.av-lbl{display:none}.all-rooms-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:600px){.header{padding:10px 14px}.subtitle{display:none}.stat-cards{grid-template-columns:1fr 1fr;gap:8px;padding:12px 14px 0}.stat-card{padding:12px 14px;gap:10px;min-height:64px}.main-grid{padding:12px 14px 16px;gap:12px}.right-col{grid-template-columns:1fr !important}.carousel-viewport{height:340px}.all-rooms-grid{grid-template-columns:1fr 1fr}.detail-stats{grid-template-columns:repeat(3,1fr)}.energy-grid{grid-template-columns:1fr}.energy-item.full{grid-column:unset}.all-btn-lbl{display:none}.room-legend{gap:6px}.rl-name{font-size:9px}.room-selector{gap:4px}.rs-pill{font-size:10px;padding:3px 8px}.logs-table{min-width:unset}.logs-table thead{display:none}.logs-table tbody tr{display:block;border:1px solid #252a35;border-radius:6px;margin-bottom:8px;padding:8px 10px}.logs-table tbody tr td{display:block;border:none;padding:2px 0;font-size:11px}.logs-table tbody tr td::before{content:attr(data-label) ': ';font-weight:600;color:#888}}
@media(max-width:380px){.stat-cards{grid-template-columns:1fr}.detail-stats{grid-template-columns:1fr}.all-rooms-grid{grid-template-columns:1fr}}
</style>