<script setup>
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { io } from 'socket.io-client'

// ─── Live sensor values ───
const currentPower       = ref(0)
const currentTemperature = ref(0)
const currentHumidity    = ref(0)

// ─── Accumulated values ───
const todaysCost     = ref(0)
const todaysUsageKwh = ref(0)
const weeklyEnergy   = ref(58.7)

// ─── Connection status ───
const isConnected  = ref(false)
const isSimulating = ref(false)

// ─── UI state ───
const activeTab   = ref('Real-Time')

// ─── Chart history ───
const powerHistory = ref([])
const tempHistory  = ref([])

// ─── Logs ───
const logs = ref([])

// ─── Status thresholds ───
const TEMP_THRESH = 28
const HUM_THRESH  = 70
const PWR_THRESH  = 500

const getTempStatus = (v) => v >= TEMP_THRESH ? 'High' : 'Normal'
const getHumStatus  = (v) => v >= HUM_THRESH  ? 'High' : 'Normal'
const getPwrStatus  = (v) => v >= PWR_THRESH  ? 'High' : 'Normal'

// ─── Rooms: Computer Laboratory 1-8 ───
const rooms = ref([
  { id: 'comlab1', name: 'Computer Laboratory 1', power: 0, temp: 0, humidity: 0, tempStatus: 'Normal', humStatus: 'Normal', pwrStatus: 'Normal' },
  { id: 'comlab2', name: 'Computer Laboratory 2', power: 0, temp: 0, humidity: 0, tempStatus: 'Normal', humStatus: 'Normal', pwrStatus: 'Normal' },
  { id: 'comlab3', name: 'Computer Laboratory 3', power: 0, temp: 0, humidity: 0, tempStatus: 'Normal', humStatus: 'Normal', pwrStatus: 'Normal' },
  { id: 'comlab4', name: 'Computer Laboratory 4', power: 0, temp: 0, humidity: 0, tempStatus: 'Normal', humStatus: 'Normal', pwrStatus: 'Normal' },
  { id: 'comlab5', name: 'Computer Laboratory 5', power: 0, temp: 0, humidity: 0, tempStatus: 'Normal', humStatus: 'Normal', pwrStatus: 'Normal' },
  { id: 'comlab6', name: 'Computer Laboratory 6', power: 0, temp: 0, humidity: 0, tempStatus: 'Normal', humStatus: 'Normal', pwrStatus: 'Normal' },
  { id: 'comlab7', name: 'Computer Laboratory 7', power: 0, temp: 0, humidity: 0, tempStatus: 'Normal', humStatus: 'Normal', pwrStatus: 'Normal' },
  { id: 'comlab8', name: 'Computer Laboratory 8', power: 0, temp: 0, humidity: 0, tempStatus: 'Normal', humStatus: 'Normal', pwrStatus: 'Normal' },

  // ... same pattern for 3–8

])

// ─── Room carousel ───
const roomPage       = ref(0)
const roomSliding    = ref(false)
const slideDirection = ref('left')
let   roomRotateTimer = null

const visibleRooms = computed(() =>
  rooms.value.slice(roomPage.value * 4, roomPage.value * 4 + 4)
)

function goToPage(page, dir = 'left') {
  if (roomSliding.value || page === roomPage.value) return
  slideDirection.value = dir
  roomSliding.value = true
  setTimeout(() => {
    roomPage.value    = page
    roomSliding.value = false
  }, 380)
}

function startRoomRotation() {
  roomRotateTimer = setInterval(() => {
    goToPage((roomPage.value + 1) % 2, 'left')
  }, 5000)
}
function stopRoomRotation() {
  clearInterval(roomRotateTimer)
  roomRotateTimer = null
}

// ─── All-rooms modal ───
const showAllRooms = ref(false)

// ─── Room detail modal ───
const selectedRoom   = ref(null)
const showRoomDetail = ref(false)

function openRoomDetail(room) {
  selectedRoom.value   = room
  showRoomDetail.value = true
}
function closeRoomDetail() {
  showRoomDetail.value = false
  setTimeout(() => { selectedRoom.value = null }, 300)
}

// ─── Computed chart stats ───
const maxPower = computed(() =>
  powerHistory.value.length ? Math.max(...powerHistory.value.map(d => d.value)) : 0)
const minPower = computed(() =>
  powerHistory.value.length ? Math.min(...powerHistory.value.map(d => d.value)) : 0)

const CW = 720, CH = 180, TH = 120

function buildPowerPath() {
  const d = powerHistory.value
  if (d.length < 2) return ''
  const peak = Math.max(...d.map(p => p.value), 100)
  return d.map((p, i) => {
    const x = (i / (d.length - 1)) * CW
    const y = CH - (p.value / (peak * 1.15)) * CH
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${Math.max(0, y).toFixed(1)}`
  }).join(' ')
}
const buildPowerArea = () =>
  powerHistory.value.length < 2 ? '' : buildPowerPath() + ` L${CW},${CH} L0,${CH} Z`

function buildTempPath() {
  const d = tempHistory.value
  if (d.length < 2) return ''
  return d.map((p, i) => {
    const x = (i / (d.length - 1)) * CW
    const y = TH - (Math.min(p.temp, 60) / 60) * TH
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${Math.max(0, y).toFixed(1)}`
  }).join(' ')
}
const buildTempArea = () =>
  tempHistory.value.length < 2 ? '' : buildTempPath() + ` L${CW},${TH} L0,${TH} Z`

function buildHumidityPath() {
  const d = tempHistory.value
  if (d.length < 2) return ''
  return d.map((p, i) => {
    const x = (i / (d.length - 1)) * CW
    const y = TH - (p.humidity / 100) * TH
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${Math.max(0, y).toFixed(1)}`
  }).join(' ')
}
const buildHumidityArea = () =>
  tempHistory.value.length < 2 ? '' : buildHumidityPath() + ` L${CW},${TH} L0,${TH} Z`

function xLabel(i, total) {
  const t = new Date()
  t.setMinutes(t.getMinutes() - 25 + Math.round((i / (total - 1)) * 25))
  return `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`
}

// ─── Apply sensor packet { temperature, humidity, power } ───
function applySensorData(data) {
  const power       = Number(data.power)
  const temperature = Number(data.temperature)
  const humidity    = Number(data.humidity)

  if (isNaN(power) || isNaN(temperature) || isNaN(humidity)) {
    console.warn('Malformed sensor data:', data)
    return
  }

  currentPower.value       = power
  currentTemperature.value = temperature
  currentHumidity.value    = humidity

  powerHistory.value.push({ value: power })
  if (powerHistory.value.length > 60) powerHistory.value.shift()

  tempHistory.value.push({ temp: temperature, humidity })
  if (tempHistory.value.length > 60) tempHistory.value.shift()

  // Was: rooms.value.forEach(room => { room.power = power ... })
// Now: route by roomId if present, otherwise fall back to updating all rooms

const targetRooms = data.roomId
  ? rooms.value.filter(r => r.id === data.roomId)
  : rooms.value;  // fallback keeps old behavior if roomId is missing

targetRooms.forEach(room => {
  room.power      = power
  room.temp       = temperature
  room.humidity   = humidity
  room.tempStatus = getTempStatus(temperature)
  room.humStatus  = getHumStatus(humidity)
  room.pwrStatus  = getPwrStatus(power)
})

  const kwh = (power / 1000) * (2 / 3600)
  todaysUsageKwh.value = +(todaysUsageKwh.value + kwh).toFixed(5)
  todaysCost.value     = +(todaysCost.value + kwh * 11.8).toFixed(4)

  const ts = new Date().toLocaleString('en-PH', {
    month: '2-digit', day: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  })
  logs.value.unshift({ timestamp: ts, event: 'Sensor Update', details: `Power: ${power} W | Temp: ${temperature}°C | Humidity: ${humidity}%` })
  if (logs.value.length > 30) logs.value.pop()
}

// ─── Socket + simulation fallback ───
let socket
let simInterval = null

function stopSim() {
  if (simInterval !== null) { clearInterval(simInterval); simInterval = null; isSimulating.value = false }
}
function startSim() {
  if (simInterval !== null) return
  isSimulating.value = true
  simInterval = setInterval(() => {
    const lastP = powerHistory.value.at(-1)?.value   ?? 500
    const lastT = tempHistory.value.at(-1)?.temp     ?? 25
    const lastH = tempHistory.value.at(-1)?.humidity ?? 50
    applySensorData({
      power:       Math.max(0, Math.min(2000, Math.round(lastP + (Math.random() - 0.5) * 80))),
      temperature: +Math.max(0, Math.min(60, lastT + (Math.random() - 0.5) * 0.5)).toFixed(1),
      humidity:    +Math.max(0, Math.min(100, lastH + (Math.random() - 0.5) * 2)).toFixed(1),
    })
  }, 2000)
}

onMounted(() => {
  socket = io('http://localhost:3000', { transports: ['websocket'], reconnectionAttempts: 10, reconnectionDelay: 2000 })
  socket.on('connect',       () => { isConnected.value = true; stopSim() })
  socket.on('sensor_update', (data) => { stopSim(); applySensorData(data) })
  socket.on('disconnect',    () => { isConnected.value = false; startSim() })
  socket.on('connect_error', () => { isConnected.value = false; startSim() })
  startSim()
  startRoomRotation()
})
onUnmounted(() => {
  stopSim(); stopRoomRotation()
  if (socket) socket.disconnect()
})
</script>

<template>
  <div class="db">

    <!-- HEADER -->
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
        <div :class="['conn-pill', isConnected ? 'live' : isSimulating ? 'sim' : 'off']">
          <span class="conn-dot"></span>
          <span class="conn-label">{{ isConnected ? 'Live' : isSimulating ? 'Simulating' : 'Disconnected' }}</span>
        </div>
        <div class="icon-btn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
          </svg>
          <span class="notif-dot"></span>
        </div>
        <div class="avatar-btn">
          <div class="avatar">A</div>
          <span class="avatar-label">Admin</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
      </div>
    </header>

    <!-- STAT CARDS -->
    <section class="stat-cards">
      <div class="stat-card green">
        <div class="stat-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="white" opacity=".9"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        </div>
        <div>
          <p class="stat-label">Current Power Usage</p>
          <p class="stat-value">{{ currentPower }} <span class="stat-unit">W</span></p>
        </div>
      </div>
      <div class="stat-card orange">
        <div class="stat-peso">&#8369;</div>
        <div>
          <p class="stat-label">Today's Cost</p>
          <p class="stat-value">&#8369;{{ todaysCost.toFixed(2) }}</p>
        </div>
      </div>
      <div class="stat-card blue">
        <div class="stat-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" opacity=".9"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        </div>
        <div>
          <p class="stat-label">Weekly Energy Usage</p>
          <p class="stat-value">{{ weeklyEnergy }} <span class="stat-unit">kWh</span></p>
        </div>
      </div>
      <div class="stat-card purple clickable">
        <div class="stat-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" opacity=".9">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
        </div>
        <div>
          <p class="stat-label">&nbsp;</p>
          <p class="stat-value-sm">Generate PDF Report</p>
        </div>
      </div>
    </section>

    <!-- MAIN GRID -->
    <div class="main-grid">

      <!-- LEFT COL -->
      <div class="left-col">

        <!-- Power Chart -->
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">Power Usage Chart</span>
            <span class="dots">&#183;&#183;&#183;</span>
          </div>
          <div class="tabs">
            <button v-for="t in ['Real-Time','Daily','Weekly']" :key="t"
              :class="['tab', { active: activeTab === t }]" @click="activeTab = t">{{ t }}</button>
          </div>
          <div class="chart-wrap">
            <div class="y-labels">
              <span v-for="v in [1200,1000,800,600,400,200,0]" :key="v" :style="{ bottom: (v/1200*100)+'%' }">{{ v }}</span>
            </div>
            <div class="chart-inner">
              <svg :viewBox="`0 0 ${CW} ${CH}`" class="chart-svg" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="pwrGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stop-color="#c8e63c" stop-opacity="0.4"/>
                    <stop offset="100%" stop-color="#c8e63c" stop-opacity="0.02"/>
                  </linearGradient>
                </defs>
                <line v-for="v in [0,200,400,600,800,1000,1200]" :key="v"
                  x1="0" :y1="CH-(v/1200)*CH" :x2="CW" :y2="CH-(v/1200)*CH" stroke="#252a35" stroke-width="1"/>
                <path v-if="powerHistory.length >= 2" :d="buildPowerArea()" fill="url(#pwrGrad)"/>
                <path v-if="powerHistory.length >= 2" :d="buildPowerPath()" fill="none" stroke="#c8e63c" stroke-width="2.5" stroke-linejoin="round"/>
              </svg>
              <div class="x-labels">
                <span v-for="(_, i) in Array(6)" :key="i">{{ xLabel(i, 6) }}</span>
              </div>
            </div>
          </div>
          <div class="power-stats">
            <span>Current: <b class="lime">{{ currentPower }} W</b></span>
            <span>Max: <b class="lime">{{ maxPower }} W</b></span>
            <span>Min: <b class="lime">{{ minPower }} W</b></span>
          </div>
        </div>

        <!-- Temp & Humidity Chart -->
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">Temperature &amp; Humidity Trend</span>
            <span class="dots">&#183;&#183;&#183;</span>
          </div>
          <div class="chart-wrap" style="--chart-h:140px">
            <div class="y-labels" style="font-size:10px">
              <span style="bottom:100%">60</span>
              <span style="bottom:50%">30</span>
              <span style="bottom:0%">0</span>
            </div>
            <div class="chart-inner">
              <svg :viewBox="`0 0 ${CW} ${TH}`" class="chart-svg" preserveAspectRatio="none">
                <defs>
                  <linearGradient id="tmpGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stop-color="#c8e63c" stop-opacity="0.35"/>
                    <stop offset="100%" stop-color="#c8e63c" stop-opacity="0.02"/>
                  </linearGradient>
                  <linearGradient id="humGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%"   stop-color="#36d1dc" stop-opacity="0.3"/>
                    <stop offset="100%" stop-color="#36d1dc" stop-opacity="0.02"/>
                  </linearGradient>
                </defs>
                <path v-if="tempHistory.length >= 2" :d="buildHumidityArea()" fill="url(#humGrad)"/>
                <path v-if="tempHistory.length >= 2" :d="buildHumidityPath()" fill="none" stroke="#36d1dc" stroke-width="2" stroke-dasharray="5 3"/>
                <path v-if="tempHistory.length >= 2" :d="buildTempArea()" fill="url(#tmpGrad)"/>
                <path v-if="tempHistory.length >= 2" :d="buildTempPath()" fill="none" stroke="#c8e63c" stroke-width="2.5" stroke-linejoin="round"/>
              </svg>
              <div class="x-labels">
                <span v-for="(_, i) in Array(6)" :key="i">{{ xLabel(i, 6) }}</span>
              </div>
            </div>
          </div>
          <div class="legend">
            <span class="ldot lime-dot"></span><span>Temperature (&#176;C)</span>
            <span class="ldot cyan-dot"></span><span>Humidity (%)</span>
          </div>
          <div class="readout-cards">
            <div class="readout-card">
              <span class="rtc-icon">&#127777;</span>
              <div>
                <div class="rtc-name">Temperature</div>
                <div class="rtc-val lime">{{ currentTemperature }}&#176;C</div>
                <span :class="['badge', currentTemperature >= 28 ? 'badge-high' : 'badge-ok']">{{ currentTemperature >= 28 ? 'High' : 'Normal' }}</span>
              </div>
            </div>
            <div class="readout-card">
              <span class="rtc-icon">&#128167;</span>
              <div>
                <div class="rtc-name">Humidity</div>
                <div class="rtc-val cyan">{{ currentHumidity }}%</div>
                <span :class="['badge', currentHumidity >= 70 ? 'badge-high' : 'badge-ok']">{{ currentHumidity >= 70 ? 'High' : 'Normal' }}</span>
              </div>
            </div>
            <div class="readout-card">
              <span class="rtc-icon">&#9889;</span>
              <div>
                <div class="rtc-name">Power</div>
                <div class="rtc-val lime">{{ currentPower }} W</div>
                <span :class="['badge', currentPower >= 900 ? 'badge-high' : 'badge-ok']">{{ currentPower >= 900 ? 'High' : 'Normal' }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Recent Logs -->
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">Recent Logs</span>
            <span class="dots">&#183;&#183;&#183;</span>
          </div>
          <div class="table-scroll">
            <table class="logs-table">
              <thead><tr><th>Timestamp</th><th>Event</th><th>Details</th></tr></thead>
              <tbody>
                <tr v-for="(log, i) in logs.slice(0, 8)" :key="i">
                  <td data-label="Timestamp">{{ log.timestamp }}</td>
                  <td data-label="Event">{{ log.event }}</td>
                  <td data-label="Details">{{ log.details }}</td>
                </tr>
                <tr v-if="logs.length === 0">
                  <td colspan="3" class="empty-log">Waiting for sensor data&#8230;</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

      </div><!-- /left-col -->

      <!-- RIGHT COL -->
      <div class="right-col">

        <!-- ROOM STATUS PANEL -->
        <div class="panel room-panel">
          <div class="panel-header">
            <span class="panel-title">Room Status</span>
            <div class="room-hdr-right">
              <div class="page-dots">
                <button v-for="p in 2" :key="p"
                  :class="['page-dot', { active: roomPage === p - 1 }]"
                  @click="goToPage(p - 1, p - 1 > roomPage ? 'left' : 'right')">
                </button>
              </div>
              <button class="all-rooms-btn" @click="showAllRooms = true">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <rect x="3" y="3" width="7" height="7" rx="1"/>
                  <rect x="14" y="3" width="7" height="7" rx="1"/>
                  <rect x="3" y="14" width="7" height="7" rx="1"/>
                  <rect x="14" y="14" width="7" height="7" rx="1"/>
                </svg>
                <span>All Rooms</span>
              </button>
            </div>
          </div>

          <!-- Fixed-height sublabel — never causes layout shift -->
          <div class="page-label">
            <span class="page-label-main">Labs {{ roomPage === 0 ? '1–4' : '5–8' }}</span>
            <span class="page-label-sub">Auto-rotating every 5s</span>
          </div>

          <!--
            carousel-outer has a fixed pixel height.
            The room-grid inside is position:absolute so it
            never stretches this container, meaning the IoT
            and Energy panels below never shift position.
          -->
          <div class="carousel-outer">
            <Transition :name="'slide-' + slideDirection" mode="out-in">
              <div class="room-grid" :key="roomPage">
                <div
                  v-for="room in visibleRooms"
                  :key="room.name"
                  class="room-card"
                  @click="openRoomDetail(room)"
                >
                  <div class="rc-tap-hint">tap for details</div>
                  <div class="rc-top">
                    <span class="rc-icon">&#128421;</span>
                    <div>
                      <div class="rc-name">{{ room.name }}</div>
                      <div class="rc-sub">Power: {{ room.power }} W</div>
                    </div>
                  </div>
                  <div class="rc-row">
                    <span>Power: <b :class="room.pwrStatus === 'High' ? 'text-red' : 'lime'">{{ room.power }} W</b></span>
                    <span :class="['rc-badge', room.pwrStatus === 'High' ? 'badge-high' : 'badge-ok']">&#8595; {{ room.pwrStatus }}</span>
                  </div>
                  <div class="rc-row" style="margin-top:4px">
                    <span>Temp: <b>{{ room.temp }}&#176;C</b></span>
                    <span :class="['rc-badge', room.tempStatus === 'High' ? 'badge-high' : 'badge-ok']">&#127777; {{ room.tempStatus }}</span>
                  </div>
                  <div class="rc-row" style="margin-top:4px">
                    <span>Hum: <b>{{ room.humidity }}%</b></span>
                    <span :class="['rc-badge', room.humStatus === 'High' ? 'badge-high' : 'badge-ok']">&#128167; {{ room.humStatus }}</span>
                  </div>
                </div>
              </div>
            </Transition>
          </div>
        </div>

        <!-- Energy Summary -->
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">Energy Summary</span>
            <span class="dots">&#183;&#183;&#183;</span>
          </div>
          <div class="energy-grid">
            <div class="energy-item">
              <p class="energy-label">Today's Usage</p>
              <p class="energy-value">{{ todaysUsageKwh.toFixed(3) }} <span class="lime">kWh</span></p>
            </div>
            <div class="energy-item">
              <p class="energy-label">This Week's Usage</p>
              <p class="energy-value">{{ weeklyEnergy }} <span class="lime">kWh</span></p>
            </div>
            <div class="energy-item full">
              <p class="energy-label">Estimated Monthly Cost</p>
              <p class="energy-value">&#8369;{{ (todaysCost * 30).toFixed(2) }}</p>
            </div>
          </div>
        </div>

      </div><!-- /right-col -->
    </div><!-- /main-grid -->

    <!-- ALL ROOMS MODAL -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="showAllRooms" class="modal-overlay" @click.self="showAllRooms = false">
          <div class="modal-box">
            <div class="modal-header">
              <span class="modal-title">&#128421; All Computer Laboratories</span>
              <button class="modal-close" @click="showAllRooms = false">&#10005;</button>
            </div>
            <div class="all-rooms-grid">
              <div v-for="(room, i) in rooms" :key="i" class="ar-card"
                @click="showAllRooms = false; openRoomDetail(room)">
                <div class="ar-header">
                  <span class="ar-num">Lab {{ i + 1 }}</span>
                  <span :class="['ar-overall', (room.tempStatus==='High'||room.pwrStatus==='High'||room.humStatus==='High') ? 'badge-high' : 'badge-ok']">
                    {{ (room.tempStatus==='High'||room.pwrStatus==='High'||room.humStatus==='High') ? '&#9888; Alert' : '&#10003; OK' }}
                  </span>
                </div>
                <div class="ar-name">{{ room.name }}</div>
                <div class="ar-rows">
                  <div class="ar-row">
                    <span class="ar-lbl">&#9889; Power</span>
                    <b :class="room.pwrStatus==='High' ? 'text-red' : 'lime'">{{ room.power }} W</b>
                    <span :class="['rc-badge', room.pwrStatus==='High' ? 'badge-high' : 'badge-ok']">{{ room.pwrStatus }}</span>
                  </div>
                  <div class="ar-row">
                    <span class="ar-lbl">&#127777; Temp</span>
                    <b>{{ room.temp }}&#176;C</b>
                    <span :class="['rc-badge', room.tempStatus==='High' ? 'badge-high' : 'badge-ok']">{{ room.tempStatus }}</span>
                  </div>
                  <div class="ar-row">
                    <span class="ar-lbl">&#128167; Hum</span>
                    <b>{{ room.humidity }}%</b>
                    <span :class="['rc-badge', room.humStatus==='High' ? 'badge-high' : 'badge-ok']">{{ room.humStatus }}</span>
                  </div>
                </div>
                <div class="ar-tap">Tap to view details &#8594;</div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ROOM DETAIL MODAL -->
    <Teleport to="body">
      <Transition name="modal-fade">
        <div v-if="showRoomDetail && selectedRoom" class="modal-overlay" @click.self="closeRoomDetail">
          <div class="detail-box">
            <div class="modal-header">
              <div class="detail-title-wrap">
                <span class="detail-icon">&#128421;</span>
                <div>
                  <div class="modal-title">{{ selectedRoom.name }}</div>
                  <div class="detail-subtitle">Live Sensor Data</div>
                </div>
              </div>
              <button class="modal-close" @click="closeRoomDetail">&#10005;</button>
            </div>

            <!-- Big metric tiles -->
            <div class="detail-tiles">
              <div :class="['detail-tile', selectedRoom.pwrStatus === 'High' ? 'tile-alert' : 'tile-ok']">
                <div class="tile-icon">&#9889;</div>
                <div class="tile-label">Power</div>
                <div class="tile-val">{{ selectedRoom.power }}<span class="tile-unit"> W</span></div>
                <span :class="['tile-badge', selectedRoom.pwrStatus === 'High' ? 'badge-high' : 'badge-ok']">{{ selectedRoom.pwrStatus }}</span>
                <div class="tile-thresh">Threshold: {{ PWR_THRESH }} W</div>
              </div>
              <div :class="['detail-tile', selectedRoom.tempStatus === 'High' ? 'tile-alert' : 'tile-ok']">
                <div class="tile-icon">&#127777;</div>
                <div class="tile-label">Temperature</div>
                <div class="tile-val">{{ selectedRoom.temp }}<span class="tile-unit">&#176;C</span></div>
                <span :class="['tile-badge', selectedRoom.tempStatus === 'High' ? 'badge-high' : 'badge-ok']">{{ selectedRoom.tempStatus }}</span>
                <div class="tile-thresh">Threshold: {{ TEMP_THRESH }}&#176;C</div>
              </div>
              <div :class="['detail-tile', selectedRoom.humStatus === 'High' ? 'tile-alert' : 'tile-ok']">
                <div class="tile-icon">&#128167;</div>
                <div class="tile-label">Humidity</div>
                <div class="tile-val">{{ selectedRoom.humidity }}<span class="tile-unit">%</span></div>
                <span :class="['tile-badge', selectedRoom.humStatus === 'High' ? 'badge-high' : 'badge-ok']">{{ selectedRoom.humStatus }}</span>
                <div class="tile-thresh">Threshold: {{ HUM_THRESH }}%</div>
              </div>
            </div>

            <!-- Progress bars -->
            <div class="detail-bars">
              <div class="dbar-row">
                <span class="dbar-label">Power</span>
                <div class="dbar-track">
                  <div class="dbar-fill pwr-fill" :style="{ width: Math.min(selectedRoom.power / 20, 100) + '%' }"></div>
                </div>
                <span class="dbar-val">{{ Math.min(selectedRoom.power / 20, 100).toFixed(0) }}%</span>
              </div>
              <div class="dbar-row">
                <span class="dbar-label">Temperature</span>
                <div class="dbar-track">
                  <div class="dbar-fill tmp-fill" :style="{ width: Math.min((selectedRoom.temp / 60) * 100, 100) + '%' }"></div>
                </div>
                <span class="dbar-val">{{ selectedRoom.temp }}&#176;C</span>
              </div>
              <div class="dbar-row">
                <span class="dbar-label">Humidity</span>
                <div class="dbar-track">
                  <div class="dbar-fill hum-fill" :style="{ width: selectedRoom.humidity + '%' }"></div>
                </div>
                <span class="dbar-val">{{ selectedRoom.humidity }}%</span>
              </div>
            </div>

            <!-- Status banner -->
            <div :class="['detail-banner', (selectedRoom.tempStatus==='High'||selectedRoom.pwrStatus==='High'||selectedRoom.humStatus==='High') ? 'banner-alert' : 'banner-ok']">
              <span v-if="selectedRoom.tempStatus==='High'||selectedRoom.pwrStatus==='High'||selectedRoom.humStatus==='High'">
                &#9888; One or more readings exceed the threshold — attention required
              </span>
              <span v-else>&#10003; All readings are within normal range</span>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

  </div><!-- /db -->
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=Inter:wght@400;500;600&display=swap');
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

.db { background:#0f1117; min-height:100vh; color:#e0e0e0; font-family:'Inter',sans-serif; font-size:14px; overflow-x:hidden; }

/* HEADER */
.header { background:#161922; border-bottom:1px solid #252a35; padding:12px 20px; display:flex; align-items:center; justify-content:space-between; gap:12px; position:sticky; top:0; z-index:100; }
.header-left { display:flex; align-items:center; gap:12px; min-width:0; }
.header-titles { min-width:0; }
.title    { font-family:'Rajdhani',sans-serif; font-size:clamp(14px,2.5vw,22px); font-weight:700; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.subtitle { font-size:clamp(10px,1.5vw,12px); color:#888; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.header-right { display:flex; align-items:center; gap:12px; flex-shrink:0; }
.conn-pill { display:flex; align-items:center; gap:6px; font-size:11px; font-weight:600; padding:4px 10px; border-radius:20px; white-space:nowrap; }
.conn-pill.live { background:#1a3a1a; color:#4caf50; border:1px solid #2a5a2a; }
.conn-pill.sim  { background:#3a3010; color:#f0b429; border:1px solid #5a4a10; }
.conn-pill.off  { background:#3a1010; color:#e74c3c; border:1px solid #5a1a1a; }
.conn-dot { width:7px; height:7px; border-radius:50%; background:currentColor; animation:pulse 1.5s infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
.icon-btn { position:relative; color:#aaa; cursor:pointer; display:flex; align-items:center; }
.notif-dot { position:absolute; top:-3px; right:-3px; width:8px; height:8px; border-radius:50%; background:#e74c3c; border:1.5px solid #161922; }
.avatar-btn { display:flex; align-items:center; gap:6px; cursor:pointer; color:#ccc; font-size:13px; }
.avatar { width:30px; height:30px; border-radius:50%; background:#3a4a6b; display:flex; align-items:center; justify-content:center; font-weight:700; color:#fff; font-size:12px; flex-shrink:0; }
.avatar-label { display:none; }

/* STAT CARDS */
.stat-cards { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; padding:16px 20px 0; }
.stat-card { border-radius:10px; padding:16px 18px; display:flex; align-items:center; gap:14px; min-height:76px; }
.stat-card.green  { background:linear-gradient(135deg,#2d5a1b,#3a7022); }
.stat-card.orange { background:linear-gradient(135deg,#7a3c00,#9e5200); }
.stat-card.blue   { background:linear-gradient(135deg,#1a3a6b,#1e4a88); }
.stat-card.purple { background:linear-gradient(135deg,#3b1f6a,#4e2a8e); }
.stat-card.clickable { cursor:pointer; transition:opacity .2s; }
.stat-card.clickable:hover { opacity:.85; }
.stat-icon  { font-size:26px; flex-shrink:0; }
.stat-peso  { font-size:26px; font-weight:700; color:#fff; opacity:.9; flex-shrink:0; }
.stat-label { font-size:11px; color:rgba(255,255,255,.75); margin-bottom:3px; }
.stat-value { font-family:'Rajdhani',sans-serif; font-size:clamp(18px,2.5vw,26px); font-weight:700; color:#fff; line-height:1.1; }
.stat-unit  { font-size:14px; font-weight:500; opacity:.8; }
.stat-value-sm { font-family:'Rajdhani',sans-serif; font-size:clamp(14px,1.8vw,18px); font-weight:700; color:#fff; }

/* MAIN GRID */
.main-grid { display:grid; grid-template-columns:1fr 360px; gap:14px; padding:14px 20px 20px; }
.left-col, .right-col { display:flex; flex-direction:column; gap:14px; min-width:0; }

/* PANEL */
.panel { background:#161922; border-radius:10px; padding:16px 18px; border:1px solid #252a35; }
.panel-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }
.panel-title { font-family:'Rajdhani',sans-serif; font-size:clamp(13px,1.8vw,16px); font-weight:600; color:#e0e0e0; }
.dots { color:#555; font-size:16px; cursor:pointer; letter-spacing:2px; }

/* TABS */
.tabs { display:flex; margin-bottom:10px; }
.tab  { background:transparent; border:1px solid #333; color:#888; font-size:12px; padding:5px 12px; cursor:pointer; transition:.15s; white-space:nowrap; }
.tab:first-child { border-radius:6px 0 0 6px; }
.tab:last-child  { border-radius:0 6px 6px 0; }
.tab.active { background:#c8e63c; color:#0f1117; border-color:#c8e63c; font-weight:600; }

/* CHARTS */
.chart-wrap  { display:flex; gap:8px; margin-bottom:20px; height:var(--chart-h,200px); }
.y-labels    { position:relative; width:32px; flex-shrink:0; font-size:10px; color:#555; }
.y-labels span { position:absolute; right:0; transform:translateY(50%); line-height:1; }
.chart-inner { flex:1; display:flex; flex-direction:column; min-width:0; gap:4px; }
.chart-svg   { flex:1; width:100%; display:block; min-height:0; }
.x-labels    { display:flex; justify-content:space-between; font-size:10px; color:#555; flex-shrink:0; }
.power-stats { display:flex; gap:16px; font-size:12px; color:#aaa; flex-wrap:wrap; }

/* LEGEND + READOUT */
.legend { display:flex; align-items:center; gap:8px; font-size:12px; color:#888; margin-bottom:10px; flex-wrap:wrap; }
.ldot     { width:10px; height:10px; border-radius:50%; display:inline-block; flex-shrink:0; }
.lime-dot { background:#c8e63c; }
.cyan-dot { background:#36d1dc; }
.readout-cards { display:flex; gap:8px; flex-wrap:wrap; }
.readout-card { background:#1f2430; border:1px solid #2a3040; border-radius:8px; padding:10px 12px; display:flex; align-items:flex-start; gap:8px; flex:1; min-width:100px; }
.rtc-icon { font-size:18px; flex-shrink:0; }
.rtc-name { font-size:11px; color:#888; margin-bottom:2px; }
.rtc-val  { font-family:'Rajdhani',sans-serif; font-size:18px; font-weight:700; line-height:1.1; }
.badge     { font-size:10px; padding:2px 7px; border-radius:4px; font-weight:600; display:inline-block; margin-top:3px; }
.badge-ok  { background:#1a3a1a; color:#4caf50; }
.badge-high{ background:#3a1a1a; color:#e74c3c; }

/* LOGS */
.table-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; }
.logs-table { width:100%; border-collapse:collapse; font-size:12px; min-width:380px; }
.logs-table th { text-align:left; color:#666; font-weight:500; padding:6px 10px; border-bottom:1px solid #252a35; white-space:nowrap; }
.logs-table td { padding:7px 10px; border-bottom:1px solid #1c2030; color:#bbb; }
.logs-table tr:last-child td { border-bottom:none; }
.logs-table tbody tr:hover { background:#1c2133; }
.empty-log { text-align:center; color:#555; font-style:italic; padding:20px !important; }

/* ROOM PANEL — key rule: fixed-height carousel so panels below never move */
.room-panel { overflow:hidden; }
.room-hdr-right { display:flex; align-items:center; gap:10px; }
.page-dots { display:flex; gap:5px; align-items:center; }
.page-dot  { width:8px; height:8px; border-radius:50%; background:#3a4050; border:none; cursor:pointer; padding:0; transition:.2s; }
.page-dot.active { background:#c8e63c; transform:scale(1.25); }
.all-rooms-btn { display:inline-flex; align-items:center; gap:5px; background:#252a35; border:1px solid #3a4050; color:#c8e63c; font-size:11px; font-weight:600; padding:4px 10px; border-radius:6px; cursor:pointer; transition:.15s; }
.all-rooms-btn:hover { background:#2e3a50; border-color:#c8e63c; }
.page-label { display:flex; align-items:center; gap:8px; height:18px; flex-shrink:0; margin-bottom:10px; }
.page-label-main { font-size:11px; color:#666; }
.page-label-sub  { font-size:10px; color:#444; }

/*
  CRITICAL: fixed-height outer box.
  The carousel slides happen inside this box (overflow:hidden).
  Nothing outside this box ever moves — IoT + Energy stay put.
*/
.carousel-outer {
  position: relative;
  height: 300px;
  overflow: hidden;
}

/* room-grid is absolutely positioned so it doesn't resize carousel-outer */
.room-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  position: absolute;
  inset: 0;
}

/* Tappable room card */
.room-card {
  background:#1f2430; border:1px solid #2a3040; border-radius:8px;
  padding:12px; cursor:pointer; position:relative; overflow:hidden;
  transition:border-color .2s, transform .15s, background .15s;
}
.room-card:hover { border-color:#c8e63c55; background:#1e2538; transform:translateY(-1px); }
.room-card:active { transform:translateY(0); }
.rc-tap-hint {
  position:absolute; bottom:0; left:0; right:0;
  background:linear-gradient(transparent, rgba(31,36,48,.9));
  color:#c8e63c99; font-size:9px; text-align:center;
  padding:8px 4px 4px; letter-spacing:.5px; text-transform:uppercase;
  opacity:0; transition:opacity .2s; pointer-events:none;
}
.room-card:hover .rc-tap-hint { opacity:1; }
.rc-top  { display:flex; align-items:flex-start; gap:8px; margin-bottom:8px; }
.rc-icon { font-size:20px; flex-shrink:0; color:#c8e63c; }
.rc-name { font-size:11px; font-weight:700; color:#ddd; line-height:1.3; }
.rc-sub  { font-size:10px; color:#666; margin-top:2px; }
.rc-row  { display:flex; justify-content:space-between; align-items:center; font-size:11px; color:#aaa; flex-wrap:wrap; gap:3px; }
.rc-badge{ display:inline-flex; align-items:center; gap:3px; font-size:10px; font-weight:600; padding:2px 7px; border-radius:4px; white-space:nowrap; }

/* Slide transitions — absolute so they never affect document height */
.slide-left-enter-active, .slide-left-leave-active,
.slide-right-enter-active,.slide-right-leave-active {
  transition: transform .38s cubic-bezier(.4,0,.2,1), opacity .3s;
  position: absolute; width: 100%; top: 0; left: 0;
}
.slide-left-enter-from   { transform:translateX(100%);  opacity:0; }
.slide-left-leave-to     { transform:translateX(-100%); opacity:0; }
.slide-right-enter-from  { transform:translateX(-100%); opacity:0; }
.slide-right-leave-to    { transform:translateX(100%);  opacity:0; }
.slide-left-enter-to, .slide-left-leave-from,
.slide-right-enter-to,.slide-right-leave-from { transform:translateX(0); opacity:1; }



/* Energy */
.energy-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.energy-item { background:#1f2430; border-radius:8px; padding:12px 14px; }
.energy-item.full { grid-column:1/-1; }
.energy-label { font-size:11px; color:#888; margin-bottom:4px; }
.energy-value { font-family:'Rajdhani',sans-serif; font-size:clamp(20px,2.5vw,26px); font-weight:700; color:#fff; }

/* Color utils */
.lime       { color:#c8e63c; }
.cyan       { color:#36d1dc; }
.text-green { color:#4caf50; }
.text-red   { color:#e74c3c; }

/* MODAL SHARED */
.modal-overlay { position:fixed; inset:0; z-index:1000; background:rgba(0,0,0,.72); backdrop-filter:blur(4px); display:flex; align-items:center; justify-content:center; padding:20px; }
.modal-header  { display:flex; justify-content:space-between; align-items:center; padding:18px 22px 14px; border-bottom:1px solid #252a35; position:sticky; top:0; background:#161922; z-index:1; border-radius:14px 14px 0 0; }
.modal-title   { font-family:'Rajdhani',sans-serif; font-size:18px; font-weight:700; color:#e0e0e0; }
.modal-close   { background:#252a35; border:1px solid #3a4050; color:#aaa; width:30px; height:30px; border-radius:50%; cursor:pointer; font-size:13px; display:flex; align-items:center; justify-content:center; transition:.15s; flex-shrink:0; }
.modal-close:hover { background:#e74c3c; color:#fff; border-color:#e74c3c; }

/* All-rooms modal */
.modal-box { background:#161922; border:1px solid #2a3040; border-radius:14px; width:100%; max-width:800px; max-height:88vh; overflow-y:auto; box-shadow:0 24px 60px rgba(0,0,0,.6); }
.all-rooms-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; padding:18px 22px 22px; }
.ar-card { background:#1f2430; border:1px solid #2a3040; border-radius:10px; padding:14px; cursor:pointer; transition:border-color .2s, background .15s; }
.ar-card:hover { border-color:#c8e63c44; background:#1e2538; }
.ar-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:4px; }
.ar-num    { font-size:10px; color:#555; font-weight:600; }
.ar-overall{ font-size:10px; font-weight:700; padding:2px 6px; border-radius:4px; }
.ar-name   { font-size:11px; font-weight:700; color:#ddd; margin-bottom:10px; line-height:1.3; }
.ar-rows   { display:flex; flex-direction:column; gap:5px; }
.ar-row    { display:flex; align-items:center; gap:5px; font-size:11px; color:#aaa; }
.ar-lbl    { width:52px; flex-shrink:0; color:#666; }
.ar-tap    { font-size:9px; color:#c8e63c66; text-align:right; margin-top:8px; letter-spacing:.3px; }

/* Room detail modal */
.detail-box { background:#161922; border:1px solid #2a3040; border-radius:14px; width:100%; max-width:520px; max-height:90vh; overflow-y:auto; box-shadow:0 24px 60px rgba(0,0,0,.6); }
.detail-title-wrap { display:flex; align-items:center; gap:12px; }
.detail-icon       { font-size:24px; }
.detail-subtitle   { font-size:11px; color:#888; margin-top:2px; }
.detail-tiles { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; padding:18px 22px 0; }
.detail-tile  { border-radius:10px; padding:16px 14px; text-align:center; border:1px solid #2a3040; background:#1f2430; }
.detail-tile.tile-alert { border-color:#e74c3c44; background:#1f1e28; }
.detail-tile.tile-ok    { border-color:#4caf5044; }
.tile-icon   { font-size:22px; margin-bottom:6px; }
.tile-label  { font-size:11px; color:#888; margin-bottom:4px; }
.tile-val    { font-family:'Rajdhani',sans-serif; font-size:28px; font-weight:700; color:#fff; line-height:1.1; }
.tile-unit   { font-size:14px; font-weight:500; opacity:.7; }
.tile-badge  { font-size:10px; font-weight:600; padding:2px 8px; border-radius:4px; display:inline-block; margin:6px 0 4px; }
.tile-thresh { font-size:10px; color:#555; }
.detail-bars { padding:16px 22px 0; display:flex; flex-direction:column; gap:10px; }
.dbar-row    { display:flex; align-items:center; gap:10px; }
.dbar-label  { width:90px; flex-shrink:0; font-size:12px; color:#888; }
.dbar-track  { flex:1; height:8px; background:#252a35; border-radius:4px; overflow:hidden; }
.dbar-fill   { height:100%; border-radius:4px; transition:width .5s ease; }
.pwr-fill    { background:linear-gradient(90deg,#c8e63c,#f0b429); }
.tmp-fill    { background:linear-gradient(90deg,#36d1dc,#c8e63c); }
.hum-fill    { background:linear-gradient(90deg,#5b86e5,#36d1dc); }
.dbar-val    { width:46px; flex-shrink:0; font-size:12px; color:#ccc; text-align:right; }
.detail-banner { margin:16px 22px 20px; padding:10px 14px; border-radius:8px; font-size:12px; font-weight:500; }
.banner-ok    { background:#1a3a1a; color:#4caf50; border:1px solid #2a5a2a; }
.banner-alert { background:#3a1a1a; color:#e74c3c; border:1px solid #5a2a2a; }

/* Modal transitions */
.modal-fade-enter-active, .modal-fade-leave-active { transition:opacity .25s, transform .25s; }
.modal-fade-enter-from, .modal-fade-leave-to       { opacity:0; transform:scale(.97); }

/* RESPONSIVE */
@media (max-width: 1100px) {
  .main-grid { grid-template-columns:1fr 300px; }
  .all-rooms-grid { grid-template-columns:repeat(4,1fr); }
}
@media (max-width: 900px) {
  .main-grid { grid-template-columns:1fr; }
  .right-col { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
  .right-col .panel:last-child { grid-column:1/-1; }
  .stat-cards { grid-template-columns:repeat(2,1fr); }
  .conn-label { display:none; }
  .all-rooms-grid { grid-template-columns:repeat(2,1fr); }
  .detail-tiles { grid-template-columns:repeat(3,1fr); }
}
@media (max-width: 600px) {
  .header { padding:10px 14px; }
  .subtitle { display:none; }
  .stat-cards { grid-template-columns:1fr 1fr; gap:8px; padding:12px 14px 0; }
  .stat-card  { padding:12px 14px; gap:10px; min-height:64px; }
  .main-grid  { padding:12px 14px 16px; gap:12px; }
  .right-col  { grid-template-columns:1fr; }
  .carousel-outer { height:280px; }
  .all-rooms-grid { grid-template-columns:1fr 1fr; }
  .detail-tiles   { grid-template-columns:repeat(3,1fr); }
  .detail-tiles .tile-val { font-size:22px; }
  .energy-grid { grid-template-columns:1fr; }
  .energy-item.full { grid-column:unset; }
  .chart-wrap { height:var(--chart-h,160px); }
  .readout-cards { gap:6px; }
  .power-stats { gap:10px; font-size:11px; }
  .logs-table thead { display:none; }
  .logs-table tbody tr { display:block; border:1px solid #252a35; border-radius:6px; margin-bottom:8px; padding:8px 10px; }
  .logs-table tbody tr td { display:block; border:none; padding:2px 0; font-size:11px; }
  .logs-table tbody tr td::before { content:attr(data-label) ': '; font-weight:600; color:#888; }
}
@media (max-width: 380px) {
  .stat-cards { grid-template-columns:1fr; }
  .title { font-size:13px; }
  .all-rooms-grid { grid-template-columns:1fr; }
  .detail-tiles   { grid-template-columns:1fr; }
}
</style>