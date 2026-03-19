<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { io } from 'socket.io-client'
import axios from 'axios'

const temperature = ref(0)
const humidity = ref(0)
const voltage = ref(0)
const current = ref(0)

let socket

// Fetch the last known data from PostgreSQL
const fetchInitialData = async () => {
  try {
    const response = await axios.get('http://localhost:3000/sensors/latest')
    if (response.data) {
      temperature.value = response.data.temperature || 0
      humidity.value = response.data.humidity || 0
      // Default to 0 until you update your database schema to save these!
      voltage.value = response.data.voltage || 0 
      current.value = response.data.current || 0
      console.log('Database history loaded successfully!')
    }
  } catch (error) {
    console.error("Dashboard couldn't reach the backend!", error)
  }
}

onMounted(async () => {
  await fetchInitialData()

  socket = io('http://localhost:3000')

  socket.on('sensor_update', (data) => {
    console.log('Live data received!', data)

    // Update cards if the data exists in the message
    if (data.temperature !== undefined) temperature.value = data.temperature
    if (data.humidity !== undefined) humidity.value = data.humidity
    if (data.voltage !== undefined) voltage.value = data.voltage
    if (data.current !== undefined) current.value = data.current
  })
})

onUnmounted(() => {
  if (socket) socket.disconnect()
})
</script>

<template>
  <div class="dashboard-wrapper">
    <div class="dashboard">
      
      <div class="header">
        <h1>Smart Room Panel</h1>
        <div class="status">
          <span class="dot"></span>
          LIVE
        </div>
      </div>

      <div class="cards">
        
        <div class="card temperature">
          <div class="icon">🌡️</div>
          <h2>Temperature</h2>
          <div class="value">{{ temperature }}°C</div>
          <p>Room Temperature</p>
        </div>

        <div class="card humidity">
          <div class="icon">💧</div>
          <h2>Humidity</h2>
          <div class="value">{{ humidity }}%</div>
          <p>Air Humidity</p>
        </div>

        <div class="card voltage">
          <div class="icon">⚡</div>
          <h2>Voltage</h2>
          <div class="value">{{ voltage }}V</div>
          <p>Mains Voltage</p>
        </div>

        <div class="card current">
          <div class="icon">🔌</div>
          <h2>Current</h2>
          <div class="value">{{ current }}A</div>
          <p>Electrical Current</p>
        </div>

      </div>
    </div>
  </div>
</template>

<style scoped>
*{
  margin:0;
  padding:0;
  box-sizing:border-box;
  font-family: 'Segoe UI', sans-serif;
}

.dashboard-wrapper{
  height:100vh;
  width:100vw;
  background: linear-gradient(135deg,#0f2027,#203a43,#2c5364);
  display:flex;
  justify-content:center;
  align-items:center;
}

.dashboard{
  width: 1000px; /* Made slightly wider to fit 4 cards beautifully */
  background: rgba(255,255,255,0.05);
  backdrop-filter: blur(15px);
  border-radius:20px;
  padding:40px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.4);
  border:1px solid rgba(255,255,255,0.1);
}

.header{
  display:flex;
  justify-content:space-between;
  align-items:center;
  margin-bottom:40px;
}

.header h1{
  color:white;
  font-weight:600;
  letter-spacing:1px;
}

.status{
  color:#00ff9f;
  font-weight:600;
  display:flex;
  align-items:center;
  gap:8px;
}

.dot{
  width:10px;
  height:10px;
  border-radius:50%;
  background:#00ff9f;
  animation:pulse 1.5s infinite;
}

@keyframes pulse{
  0%{opacity:1}
  50%{opacity:0.3}
  100%{opacity:1}
}

.cards{
  display:flex;
  gap:20px; /* Slightly reduced gap so 4 cards fit perfectly */
  justify-content:center;
}

.card{
  flex:1;
  padding:30px 20px;
  border-radius:16px;
  background:rgba(255,255,255,0.05);
  border:1px solid rgba(255,255,255,0.08);
  text-align:center;
  color:white;
  transition:0.3s;
  position:relative;
  overflow:hidden;
}

.card::before{
  content:"";
  position:absolute;
  width:200%;
  height:200%;
  background:linear-gradient(45deg, transparent, rgba(255,255,255,0.1), transparent);
  top:-50%;
  left:-50%;
  transform:rotate(25deg);
  transition:0.5s;
  opacity:0;
}

.card:hover::before{
  opacity:1;
}

.card:hover{
  transform:translateY(-8px) scale(1.02);
  box-shadow:0 15px 40px rgba(0,0,0,0.4);
}

.icon{
  font-size:40px;
  margin-bottom:10px;
}

.card h2{
  font-weight:500;
  margin-bottom:10px;
  font-size: 1.2rem;
}

.value{
  font-size:38px;
  font-weight:bold;
  margin-bottom:5px;
}

.card p{
  opacity:0.7;
  font-size:13px;
}

/* CARD COLORS */
.temperature{ border-top:3px solid #ff5f6d; }
.humidity{ border-top:3px solid #36d1dc; }
.voltage{ border-top:3px solid #ffd200; }
.current{ border-top:3px solid #b224ef; }

</style>