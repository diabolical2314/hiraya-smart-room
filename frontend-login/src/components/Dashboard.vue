<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { io } from 'socket.io-client'

const temperature = ref(0)
const humidity = ref(0)
const power = ref(0)
let socket;

onMounted(() => {
  // Connect to the NestJS server when the dashboard loads
  socket = io('http://localhost:3000')

  // Listen for the exact event name we used in NestJS
  socket.on('sensor_update', (data) => {
    console.log('Live data received from server!', data)
    
    // Update the reactive variables instantly
    temperature.value = data.temperature
    humidity.value = data.humidity
    power.value = data.power || 0
  })
})

// Clean up the connection if the user logs out or leaves the page
onUnmounted(() => {
  if (socket) {
    socket.disconnect()
  }
})
</script>

<template>
  <div class="dashboard-wrapper">
    <div class="dashboard">
      <h1>CCIS Room Monitor</h1>
      
      <div class="cards">
        <div class="card temperature">
          <h2>Temperature</h2>
          <div class="value">{{ temperature }}°C</div>
          <p>Current Room Temperature</p>
        </div>

        <div class="card humidity">
          <h2>Humidity</h2>
          <div class="value">{{ humidity }}%</div>
          <p>Current Air Humidity</p>
        </div>

        <div class="card power">
          <h2>Power</h2>
          <div class="value">{{ power }}W</div>
          <p>Current Power Consumption</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  font-family: Arial, Helvetica, sans-serif;
}

.dashboard-wrapper {
  background: #f4f7fb;
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  width: 100vw;
}

.dashboard {
  text-align: center;
}

.dashboard h1 {
  margin-bottom: 40px;
  color: #333;
}

.cards {
  display: flex;
  gap: 30px;
}

.card {
  width: 220px;
  padding: 25px;
  border-radius: 15px;
  color: white;
  box-shadow: 0 10px 20px rgba(0,0,0,0.1);
  transition: 0.3s;
}

.card:hover {
  transform: translateY(-5px);
}

.temperature {
  background: linear-gradient(135deg, #ff7e5f, #ff3e3e);
}

.humidity {
  background: linear-gradient(135deg, #36d1dc, #5b86e5);
}
.power {  
  background: linear-gradient(135deg, #f7971e, #ffd200);
}


.card h2 {
  margin-bottom: 15px;
}

.value {
  font-size: 40px;
  font-weight: bold;
  margin-bottom: 10px;
}

.card p {
  font-size: 14px;
  opacity: 0.9;
}
</style>