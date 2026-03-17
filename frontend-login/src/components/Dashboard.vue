<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { io } from 'socket.io-client'

const temperature = ref(0)
const humidity = ref(0)
const power = ref(0)

let socket

onMounted(() => {
  socket = io('http://localhost:3000')

  socket.on('sensor_update', (data) => {
    console.log('Live data received!', data)

    temperature.value = data.temperature
    humidity.value = data.humidity
    power.value = data.power || 0
  })
})

onUnmounted(() => {
  if (socket) {
    socket.disconnect()
  }
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

        <div class="card power">
          <div class="icon">⚡</div>
          <h2>Power</h2>
          <div class="value">{{ power }}W</div>
          <p>Energy Consumption</p>
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

background:
linear-gradient(135deg,#0f2027,#203a43,#2c5364);

display:flex;
justify-content:center;
align-items:center;
}

/* PANEL */

.dashboard{
width:900px;

background: rgba(255,255,255,0.05);
backdrop-filter: blur(15px);

border-radius:20px;
padding:40px;

box-shadow:
0 10px 30px rgba(0,0,0,0.4);

border:1px solid rgba(255,255,255,0.1);
}

/* HEADER */

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

/* LIVE STATUS */

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

/* CARDS */

.cards{
display:flex;
gap:30px;
justify-content:center;
}

/* CARD */

.card{

flex:1;

padding:30px;

border-radius:16px;

background:rgba(255,255,255,0.05);

border:1px solid rgba(255,255,255,0.08);

text-align:center;

color:white;

transition:0.3s;

position:relative;

overflow:hidden;

}

/* Glow animation */

.card::before{

content:"";

position:absolute;

width:200%;
height:200%;

background:linear-gradient(
45deg,
transparent,
rgba(255,255,255,0.1),
transparent
);

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

/* ICON */

.icon{
font-size:40px;
margin-bottom:10px;
}

/* TEXT */

.card h2{
font-weight:500;
margin-bottom:10px;
}

.value{

font-size:44px;
font-weight:bold;

margin-bottom:5px;

}

.card p{
opacity:0.7;
font-size:14px;
}

/* COLORS */

.temperature{
border-top:3px solid #ff5f6d;
}

.humidity{
border-top:3px solid #36d1dc;
}

.power{
border-top:3px solid #ffd200;
}

</style>